"""Generate random but valid import files for the demo.

    python tools/make_demo_import.py [--out demo/import] [--seed 7]

Writes two files that the "Import coursework" dialog accepts:
  * term-timetable.ics     class sessions (weekly lectures for the coming week) -> "course" items
  * canvas-assignments.json  a Canvas-style assignment export                    -> "task" items
Courses, weekdays, times, rooms and assignment names are drawn at random; the same --seed gives the
same files. The Canvas file is built to show every preview state next to the demo account's seeded
tasks (see tools/seed_demo.py): new items, one already in the calendar, one whose deadline moved
(an "update") and one that is already past.
"""
import argparse
import json
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")

# The assignment the demo account "imported earlier" (seed_demo.py); the new export moves its deadline.
LAB_TITLE = "PHYS 211 Lab Report 3"
LAB_URL = "https://canvas.illinois.example/courses/48213/assignments/771204"
# Seeded by seed_demo.py as a plain task; the export lists it again so the preview shows "already added".
KNOWN_TITLE = "CS 225 Homework 7"

COURSES = [
    ("CS 225", "Data Structures", "Siebel 1404"),
    ("STAT 400", "Statistics and Probability I", "Everitt 2205"),
    ("PHYS 211", "University Physics: Mechanics", "Loomis 141"),
    ("MATH 241", "Calculus III", "Altgeld 314"),
    ("ECE 110", "Introduction to Electronics", "ECEB 1002"),
    ("CHEM 102", "General Chemistry I", "Noyes 100"),
    ("RHET 105", "Writing and Research", "English Building 109"),
]
PATTERNS = [("MO,WE,FR", (0, 2, 4), 50), ("TU,TH", (1, 3), 75)]

ASSIGNMENTS = [
    "Problem Set 8", "Discussion Post 5", "Project Proposal", "Reading Quiz 9", "Lab 6 Pre-lab",
    "Peer Review Draft", "Practice Exam Upload", "Worksheet 12", "Case Study Reflection",
]


def monday_of_next_week(today=None):
    today = today or date.today()
    return today + timedelta(days=(7 - today.weekday()) % 7)


def local(day, hour, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=CT)


def utc_iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def earlier_export(monday):
    """A one-assignment Canvas export, imported by seed_demo.py to create the keyed task."""
    due = local(monday + timedelta(days=5), 18)
    return json.dumps([{"name": "Assignments", "assignments": [
        {"id": 771204, "name": LAB_TITLE, "due_at": utc_iso(due), "html_url": LAB_URL}]}], indent=2)


def make_ics(rng, monday):
    """Three or four courses with weekly sessions, none overlapping, all over by 17:00."""
    taken = {}  # weekday -> list of (start_minute, end_minute)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PlanTriz demo//Term timetable//EN", "CALSCALE:GREGORIAN"]
    summary = []
    until = (monday + timedelta(days=4)).strftime("%Y%m%d")  # the Friday of that week
    for code, name, room in rng.sample(COURSES, rng.choice([3, 4])):
        for _ in range(60):
            byday, weekdays, minutes = rng.choice(PATTERNS)
            start_h = rng.choice([8, 9, 10, 11, 12, 13, 14, 15])
            start = start_h * 60 + rng.choice([0, 30])
            end = start + minutes
            if end > 17 * 60:
                continue
            if all(end <= s or start >= e for wd in weekdays for s, e in taken.get(wd, [])):
                break
        else:
            continue
        for wd in weekdays:
            taken.setdefault(wd, []).append((start, end))
        first = monday + timedelta(days=weekdays[0])
        dtstart = local(first, start // 60, start % 60).strftime("%Y%m%dT%H%M%S")
        dtend = local(first, end // 60, end % 60).strftime("%Y%m%dT%H%M%S")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{code.replace(' ', '').lower()}-{rng.randrange(10**6):06d}@plantriz.demo",
            f"SUMMARY:{code} {name}",
            f"LOCATION:{room}",
            f"DTSTART;TZID=America/Chicago:{dtstart}",
            f"DTEND;TZID=America/Chicago:{dtend}",
            f"RRULE:FREQ=WEEKLY;BYDAY={byday};UNTIL={until}",
            "END:VEVENT",
        ]
        summary.append(f"{code} {byday} {start // 60:02d}:{start % 60:02d}-{end // 60:02d}:{end % 60:02d} {room}")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n", summary


def make_canvas(rng, monday):
    """Canvas export: 3 new upcoming items, 1 already added, 1 with a moved deadline, 1 past."""
    course = rng.choice(COURSES)[0]

    def assignment(name, due, url=None, ident=None):
        ident = ident or rng.randrange(780000, 790000)
        return {"id": ident, "name": name, "due_at": utc_iso(due),
                "html_url": url or f"https://canvas.illinois.example/courses/{rng.randrange(40000, 50000)}/assignments/{ident}"}

    names = rng.sample(ASSIGNMENTS, 4)
    homework = [
        assignment(f"{course} {names[0]}", local(monday + timedelta(days=rng.choice([1, 2])), 23, 59)),
        assignment(f"{course} {names[1]}", local(monday + timedelta(days=rng.choice([3, 4])), 17, 0)),
        assignment(KNOWN_TITLE, local(monday, 10, 0)),
        assignment(f"{course} {names[2]}", local(monday - timedelta(days=9), 23, 59)),  # already past
    ]
    other = [
        assignment(f"{rng.choice(COURSES)[0]} {names[3]}", local(monday + timedelta(days=rng.choice([8, 9, 10])), 23, 59)),
        # Same URL as the demo account's earlier import, new deadline -> "Update".
        assignment(LAB_TITLE, local(monday + timedelta(days=7), 23, 59), url=LAB_URL, ident=771204),
    ]
    data = [{"name": "Homework", "assignments": homework}, {"name": "Labs and projects", "assignments": other}]
    return json.dumps(data, indent=2), [a["name"] for g in data for a in g["assignments"]]


def generate(out_dir, seed=None, today=None):
    rng = random.Random(seed)
    monday = monday_of_next_week(today)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ics_text, ics_summary = make_ics(rng, monday)
    canvas_text, canvas_summary = make_canvas(rng, monday)
    ics_path = out / "term-timetable.ics"
    canvas_path = out / "canvas-assignments.json"
    ics_path.write_text(ics_text, encoding="utf-8", newline="")
    canvas_path.write_text(canvas_text, encoding="utf-8")
    return {"ics": ics_path, "canvas": canvas_path, "ics_summary": ics_summary, "canvas_summary": canvas_summary,
            "monday": monday}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "demo" / "import"))
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    result = generate(args.out, args.seed)
    print("week of", result["monday"])
    print(result["ics"], *result["ics_summary"], sep="\n  ")
    print(result["canvas"], *result["canvas_summary"], sep="\n  ")


if __name__ == "__main__":
    main()
