"""Create (or reuse) the demo account and fill next week with a few tasks.

Usage: python tools/seed_demo.py [--api http://localhost:8081] [--lang en|zh] [--reset]
The demo account is demo_student / demo1234 (email demo@example.com).
Re-running wipes the account's existing tasks first so the calendar is always the same.
--reset deletes the account itself (local Docker Postgres) so Buddy XP/level start from zero.
"""
import argparse
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

USERNAME, EMAIL, PASSWORD = "demo_student", "demo@example.com", "demo1234"

# (days after Monday, hour, title, description, colour). Nothing sits after 19:00 on Tue/Wed, so
# an evening study plan has room, and nothing collides with "class until 5pm" except the quiz.
PLANS = {
    "en": [
        (0, 10, "CS 225 Homework 7", "Finish the linked list and tree problems and submit on Gradescope.", "#e8b84b"),
        (1, 12, "Study group: data structures", "Go through the approach for homework 7 with the group.", "#7aa95c"),
        (2, 22, "Reading response due", "Submit the chapter 6 reading response (800 words).", "#c8704a"),
        (3, 15, "PHYS 211 quiz", "Mechanics unit quiz, bring a calculator.", "#6a8fb5"),
        (5, 11, "Library shift", "Front desk, 11:00 to 15:00.", "#9b7bb0"),
    ],
    "zh": [
        (0, 10, "CS 225 作业 7", "完成链表与树的编程题并提交到 Gradescope。", "#e8b84b"),
        (1, 12, "小组讨论：数据结构", "和组员一起过一遍作业 7 的思路。", "#7aa95c"),
        (2, 22, "阅读报告截止", "提交第 6 章阅读报告（800 字）。", "#c8704a"),
        (3, 15, "PHYS 211 小测", "力学单元小测，带计算器。", "#6a8fb5"),
        (5, 11, "图书馆值班", "前台值班，11:00 到 15:00。", "#9b7bb0"),
    ],
}


def call(api, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(api + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def post_file(api, path, filename, content, content_type="application/json"):
    """multipart/form-data upload with a single 'file' field (urllib has no built-in helper)."""
    boundary = "----plantrizdemo7d3c1f"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n").encode() + content.encode() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(api + path, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def import_earlier_export(api, uid, token, monday):
    """Import last week's Canvas export through the real import API so the lab report carries a Canvas
    key; the demo's new export then moves its deadline and the preview shows an "update"."""
    import make_demo_import
    q = f"userId={uid}&authToken={urllib.parse.quote(token)}"
    preview = post_file(api, f"/api/import/preview?{q}&timezone=America/Chicago", "canvas-earlier.json",
                        make_demo_import.earlier_export(monday))
    ids = [item["id"] for item in preview["items"]]
    status, result = call(api, "POST", f"/api/import/confirm?{q}", {"importId": preview["importId"], "itemIds": ids})
    print(status, "earlier Canvas export:", result)


def reset_demo_user():
    """Delete the demo account and its rows so Buddy XP/level start from zero (local Docker DB only)."""
    sql = (
        "delete from tasks where user_id in (select id from users where username='%(u)s');"
        "delete from course_events where user_id in (select id from users where username='%(u)s');"
        "delete from users where username='%(u)s';" % {"u": USERNAME}
    )
    r = subprocess.run(["docker", "exec", "ai-scheduler-db", "psql", "-U", "postgres", "-d", "aischeduler",
                        "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("reset failed: " + (r.stderr or r.stdout).strip())
    print("reset:", r.stdout.strip().replace("\n", " "))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8081")
    ap.add_argument("--lang", choices=sorted(PLANS), default="en")
    ap.add_argument("--reset", action="store_true", help="delete the demo account first (fresh Buddy)")
    args = ap.parse_args()
    api = args.api
    if args.reset:
        reset_demo_user()

    call(api, "POST", "/api/auth/signup", {"username": USERNAME, "email": EMAIL, "password": PASSWORD})
    status, user = call(api, "POST", "/api/auth/signin", {"identifier": USERNAME, "password": PASSWORD})
    if status != 200 or not isinstance(user, dict):
        raise SystemExit(f"sign-in failed: {status} {user}")
    uid, token = user["id"], user["token"]
    q = f"userId={uid}&authToken={urllib.parse.quote(token)}"

    status, existing = call(api, "GET", f"/api/tasks?{q}")
    if status == 200 and isinstance(existing, list):
        for t in existing:
            call(api, "DELETE", f"/api/tasks/{t['id']}?authToken={urllib.parse.quote(token)}")

    # Monday of the upcoming week (or today if it is Monday).
    today = date.today()
    monday = today + timedelta(days=(7 - today.weekday()) % 7)
    for offset, hour, title, desc, color in PLANS[args.lang]:
        due = datetime.combine(monday + timedelta(days=offset), datetime.min.time()).replace(hour=hour)
        s, r = call(api, "POST", f"/api/tasks?{q}&timezone=America/Chicago",
                    {"title": title, "description": desc, "dueDate": due.isoformat(), "color": color})
        print(s, title, due.isoformat())
    import_earlier_export(api, uid, token, monday)
    print(f"demo user id={uid}; week of {monday}")


if __name__ == "__main__":
    main()
