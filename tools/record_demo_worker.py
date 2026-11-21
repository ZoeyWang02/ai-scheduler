"""Record a scripted ~2 minute PlanTriz walkthrough against the Cloudflare Worker build.

The video shows a persistent "www.plantriz.com" banner. It is recorded against a local copy of the same code
(`wrangler dev`), with a throw-away demo account created through the API, so the live site and its data are not
touched. The AI answers are real (the key in worker/.dev.vars) and vary a little, so each take is checked and a take
that does not look right is thrown away and recorded again. The waits for the AI are sped up in the final video.

Prerequisites:
    pip install playwright imageio-ffmpeg reportlab      (uses the system Edge, no browser download)
    cd worker && npm run migrate:local && npm run dev    (http://localhost:8787, with LLM_API_KEY in .dev.vars)

Usage:
    python tools/record_demo_worker.py                   # -> demo/plantriz-demo-worker-en.mp4
    python tools/record_demo_worker.py --base http://localhost:8787 --out some.mp4
"""
import argparse
import json
import random
import re
import string
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import imageio_ffmpeg
from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
W, H = 1440, 810
URL_BANNER = "www.plantriz.com"
SPEEDUP = 7.0  # the waits for the AI are shown this many times faster

try:
    from zoneinfo import ZoneInfo
    CHICAGO = ZoneInfo("America/Chicago")
except Exception:  # no tz database on this machine: November is CST, UTC-6
    CHICAGO = None


def chicago_now():
    if CHICAGO is not None:
        return datetime.now(CHICAGO).replace(tzinfo=None)
    return datetime.utcnow() - timedelta(hours=6)


TEXT = {
    "slide1_a": "When an AI can read your course documents and edit your calendar,",
    "slide1_b": "how much control should you keep?",
    "import_pick": "Import a syllabus: the AI reads it, you review it",
    "import_preview": "Each item shows where it came from, how sure the AI is, and whether it's new",
    "import_done": "Nothing is saved until you confirm",
    "chat_open": "Ask the assistant to plan",
    "plan1": "It only proposes a plan",
    "plan2": "It remembers the conversation",
    "apply": "Nothing changes until you press Apply",
    "move": "It can change what's already on the calendar",
    "drag": "Tasks are deadlines, events have a start and an end",
    "confirm": "Moving or stretching an event asks first",
    "xp": "Finishing a task earns XP for Buddy",
    "rhythm": "The rhythm panel learns when you work",
    "night": "Night mode for late sessions",
    "settings": "Bring your own API key: it never reaches the server",
    "lang": "Titles are saved in two languages",
    "q_title": "Questions I want to study",
    "q1": "How should an assistant show its uncertainty when it edits a schedule?",
    "q2": "What do students understand about where their documents go?",
    "q3": "How should AI handle two languages for bilingual users?",
    "end_a": "PlanTriz",
    "end_b": "The AI proposes. You decide.",
}

OVERLAY_JS = r"""
(() => {
  const css = `
    #demo-cursor{position:fixed;left:-40px;top:-40px;width:22px;height:28px;z-index:2147483647;pointer-events:none;
      image-rendering:pixelated;transition:none;
      background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='28' shape-rendering='crispEdges'><path d='M2 2h4v2h2v2h2v2h2v2h2v2h2v2h-6v2h2v4h-4v-4h-2v-2h-2v2h-2z' fill='%234d3319'/><path d='M4 6h2v2h2v2h2v2h2v2h-4v2h-2v-2h-2z' fill='%23fffdf6'/></svg>") no-repeat;}
    .demo-ring{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border:3px solid #e8b84b;border-radius:50%;
      z-index:2147483646;pointer-events:none;animation:demoring .55s ease-out forwards}
    @keyframes demoring{to{transform:scale(3.2);opacity:0}}
    #demo-caption{position:fixed;left:84px;bottom:18px;max-width:760px;z-index:2147483645;pointer-events:none;
      font-size:18px;line-height:1.45;font-family:inherit;color:#fff8e1;background:#4d3319;border:2px solid #e8b84b;
      padding:8px 16px;box-shadow:4px 4px 0 rgba(0,0,0,.35);opacity:0;transform:translateY(6px);
      transition:opacity .25s,transform .25s}
    #demo-caption.on{opacity:1;transform:none}
    #demo-url{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483644;pointer-events:none;
      font-size:16px;font-family:inherit;letter-spacing:.5px;color:#fff8e1;background:#4d3319;border:2px solid #e8b84b;
      padding:3px 16px;box-shadow:3px 3px 0 rgba(0,0,0,.35)}
    #demo-slide{position:fixed;inset:0;z-index:2147483643;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:26px;text-align:center;padding:60px 120px;background:#2b2e4a;color:#fff8e1;
      font-family:inherit;opacity:0;pointer-events:none;transition:opacity .45s}
    #demo-slide.on{opacity:1;pointer-events:auto}
    #demo-slide .s-big{font-size:34px;line-height:1.35;max-width:1100px}
    #demo-slide .s-mid{font-size:26px;line-height:1.4;max-width:1100px;color:#f3dfa6}
    #demo-slide .s-list{display:flex;flex-direction:column;gap:22px;align-items:flex-start;max-width:1100px}
    #demo-slide .s-item{font-size:27px;line-height:1.4;text-align:left;padding-left:34px;position:relative;opacity:0;
      transform:translateY(8px);transition:opacity .5s,transform .5s}
    #demo-slide .s-item::before{content:'';position:absolute;left:0;top:11px;width:14px;height:14px;background:#e8b84b}
    #demo-slide .s-item.on{opacity:1;transform:none}
    #demo-slide .s-url{position:absolute;bottom:46px;font-size:24px;color:#e8b84b;letter-spacing:.5px}`;
  const mk = () => {
    if (!document.body || document.getElementById('demo-cursor')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'demo-cursor'; document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'demo-caption'; document.body.appendChild(cap);
    const url = document.createElement('div'); url.id = 'demo-url'; url.textContent = '__URL__'; document.body.appendChild(url);
    const slide = document.createElement('div'); slide.id = 'demo-slide'; document.body.appendChild(slide);
  };
  document.addEventListener('DOMContentLoaded', mk);
  document.addEventListener('mousemove', e => {
    mk(); const c = document.getElementById('demo-cursor'); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px';
  }, true);
  document.addEventListener('mousedown', e => {
    const r = document.createElement('div'); r.className = 'demo-ring'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  window.__stalls = [];
  window.addEventListener('load', () => {
    let last = performance.now();
    const tick = t => { if (t - last > 1000) window.__stalls.push(Math.round(t - last)); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
})();
"""


class TakeRejected(Exception):
    """The take was not good enough to show; record it again."""


def api(base, method, path, body=None, query=None):
    url = base + path + (("?" + "&".join(f"{k}={v}" for k, v in query.items())) if query else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode()
    return json.loads(raw) if raw.strip().startswith(("{", "[")) else raw


def make_demo_user(base):
    """A throw-away account (test credentials) on the local stack, with a few tasks already on the calendar."""
    tag = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    password = "".join(random.choices(string.ascii_letters + string.digits, k=14))
    user = api(base, "POST", "/api/auth/signup", {"username": f"demo_{tag}", "email": f"demo_{tag}@example.com", "password": password})
    q = {"userId": user["id"], "authToken": user["token"], "timezone": "America/Chicago"}
    today = chicago_now().date()
    monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)

    def pair(zh_title, en_title, zh_desc="", en_desc=""):
        return {"zh": {"title": zh_title, "description": zh_desc}, "en": {"title": en_title, "description": en_desc}}

    seeds = [
        {"title": "Study group", "description": "Review problem set 8", "dueDate": f"{monday}T18:00:00", "endDate": f"{monday}T19:30:00",
         "i18n": pair("学习小组", "Study group", "复习第 8 次习题", "Review problem set 8")},
        {"title": "Submit reading notes", "description": "", "dueDate": f"{today}T23:30:00",
         "i18n": pair("提交阅读笔记", "Submit reading notes")},
        {"title": "Reading response 5", "description": "", "dueDate": f"{today + timedelta(days=4)}T21:00:00",
         "i18n": pair("阅读回应 5", "Reading response 5")},
    ]
    for seed in seeds:
        api(base, "POST", "/api/tasks", seed, q)
    return user


def make_syllabus(out_dir):
    """A made-up syllabus (PDF) whose dates are relative to today. Returns (path, midterm datetime)."""
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    today = chicago_now().date()
    fmt = lambda d: f"{d:%A, %B} {d.day}"
    midterm = today + timedelta(days=11)
    lines = [
        ("STAT 400: Statistics and Probability I (sample syllabus)", 16),
        ("Fall term. Instructor and room are fictional.", 11),
        ("", 11),
        ("Class meetings", 13),
        ("Lecture: Mondays and Wednesdays, 10:00-10:50 AM, Room 1404.", 11),
        ("", 11),
        ("Assessments", 13),
        (f"Homework 9 is due {fmt(today + timedelta(days=6))} at 11:59 PM.", 11),
        (f"The project proposal is due {fmt(today + timedelta(days=9))} at 11:59 PM.", 11),
        (f"Midterm exam: {fmt(midterm)}, 3:00-4:30 PM, Room 1404.", 11),
        (f"Final exam: {fmt(today + timedelta(days=30))}, 1:30-4:30 PM, Room 1404.", 11),
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "STAT400-syllabus.pdf"
    c = canvas.Canvas(str(path), pagesize=letter)
    y = 720
    for text, size in lines:
        c.setFont("Helvetica-Bold" if size >= 13 else "Helvetica", size)
        c.drawString(72, y, text)
        y -= size + 12
    c.save()
    return path, datetime.combine(midterm, datetime.min.time()).replace(hour=15)


class Director:
    def __init__(self, page, started):
        self.page = page
        self.started = started
        self.fast = []  # (start, end) in video seconds: the waits that get sped up

    def now(self):
        return time.time() - self.started

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    def caption(self, text):
        self.page.evaluate(
            """t => { const c = document.getElementById('demo-caption'); if (!c) return;
                      if (t) { c.textContent = t; c.classList.add('on'); } else c.classList.remove('on'); }""", text)

    def glide(self, locator, steps=26):
        locator.scroll_into_view_if_needed()
        box = locator.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=steps)
        self.wait(160)

    def click(self, selector, **kw):
        loc = self.page.locator(selector).first
        self.glide(loc)
        loc.click(**kw)

    def type(self, selector, text, delay=35):
        self.click(selector)
        self.page.keyboard.type(text, delay=delay)

    def slide(self, html):
        self.page.evaluate("h => { const s = document.getElementById('demo-slide'); if (h === null) { s.classList.remove('on'); return; } s.innerHTML = h; s.classList.add('on'); }", html)

    def reveal_items(self, gap_ms=900):
        n = self.page.locator("#demo-slide .s-item").count()
        for i in range(n):
            self.page.evaluate("i => document.querySelectorAll('#demo-slide .s-item')[i].classList.add('on')", i)
            self.wait(gap_ms)

    def speed_wait(self, fn):
        """Run `fn` (which waits for the AI) and mark that stretch of the video to be sped up."""
        a = self.now()
        fn()
        self.fast.append((a + 0.6, self.now() - 0.3))

    def show_turn(self, hold_top=2200, hold_bottom=2400):
        self.page.evaluate(
            """() => { const rows = [...document.querySelectorAll('#messages .message-row.user')];
                      if (rows.length) rows[rows.length - 1].scrollIntoView({behavior: 'smooth', block: 'start'}); }""")
        self.wait(hold_top)
        self.page.evaluate("() => { const m = document.querySelector('#messages'); m.scrollTo({top: m.scrollHeight, behavior: 'smooth'}); }")
        self.wait(hold_bottom)

    def ask(self, text):
        self.type("#userInput", text, delay=28)
        self.wait(350)
        self.page.keyboard.press("Enter")

        def waiting():
            self.page.wait_for_selector("#ai-loading-placeholder", state="attached", timeout=8000)
            self.page.wait_for_selector("#ai-loading-placeholder", state="detached", timeout=60000)

        self.speed_wait(waiting)
        self.wait(700)
        if self.page.locator("#messages .message.ai.error").count():
            raise TakeRejected("the AI returned an error message")

    def plan_times(self):
        texts = self.page.locator(".ai-planner-box").last.locator(".planner-item label span").all_inner_texts()
        found = [re.search(r"(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})", t) for t in texts]
        return [datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}:{m.group(3)}:00") for m in found if m]


def take(ctx_factory, base, files, midterm):
    t = TEXT
    ctx, started, user = ctx_factory()
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        d = Director(page, started)
        page.goto(base + "/")
        page.wait_for_selector("#todayBandAgenda .tb-check", timeout=20000)
        d.wait(900)
        t_ready = d.now()

        # 1. the question
        d.slide(f'<div class="s-big">{t["slide1_a"]}<br>{t["slide1_b"]}</div><div class="s-mid">PlanTriz</div><div class="s-url">{URL_BANNER}</div>')
        d.wait(5200)
        d.slide(None)
        d.wait(700)

        # 2. import a syllabus
        d.caption(t["import_pick"])
        d.click('#iconRail [data-click="openImportModal"]')
        page.wait_for_selector("#importModal", state="visible", timeout=5000)
        d.wait(600)
        d.glide(page.locator("#unifiedImportFile"))
        page.set_input_files("#unifiedImportFile", str(files["syllabus"]))
        d.wait(700)
        d.click('#importModal [data-click="previewUnifiedImport"]')
        d.speed_wait(lambda: page.wait_for_selector("#importPreviewList .import-preview-item", timeout=45000))
        d.wait(500)
        rows = page.locator("#importPreviewList .import-preview-item")
        if rows.count() < 6:
            raise TakeRejected(f"only {rows.count()} rows in the preview")
        meta = " ".join(page.locator("#importPreviewList .import-preview-meta").all_inner_texts())
        if "Event" not in meta or "Class" not in meta or "Task" not in meta:
            raise TakeRejected("the preview does not have an event, a class and a task")
        d.caption(t["import_preview"])
        page.evaluate("() => { const l = document.querySelector('#importPreviewList'); l.scrollTo({top: 0}); }")
        d.wait(2600)
        page.evaluate("() => { const l = document.querySelector('#importPreviewList'); l.scrollTo({top: l.scrollHeight, behavior: 'smooth'}); }")
        d.wait(2700)
        page.evaluate("() => { const l = document.querySelector('#importPreviewList'); l.scrollTo({top: 0, behavior: 'smooth'}); }")
        d.wait(1200)
        d.caption(t["import_done"])
        d.click("#confirmImportBtn")
        page.wait_for_selector("#importModal", state="hidden", timeout=15000)
        d.wait(2400)

        # 3. plan with the assistant
        d.caption(t["chat_open"])
        d.click("#chatToggleBtn")
        d.wait(900)
        d.click(".chat-new-btn")
        d.wait(500)
        d.ask("Plan three one-hour study sessions for my midterm, one per day.")
        d.caption(t["plan1"])
        page.wait_for_selector(".ai-planner-box .sync-btn", timeout=10000)
        sessions = d.plan_times()
        if not 2 <= len(sessions) <= 5 or any(s >= midterm for s in sessions):
            raise TakeRejected(f"first plan looks wrong: {[s.isoformat() for s in sessions]}")
        d.show_turn()

        d.ask("Move them all to after 7pm.")
        d.caption(t["plan2"])
        try:
            page.wait_for_function("document.querySelectorAll('.ai-planner-box').length >= 2", timeout=10000)
        except PWTimeout:
            raise TakeRejected("no revised plan")
        evening = d.plan_times()
        if not evening or min(s.hour for s in evening) < 19 or any(s >= midterm for s in evening):
            raise TakeRejected(f"second plan is not in the evening before the midterm: {[s.isoformat() for s in evening]}")
        d.show_turn()

        d.caption(t["apply"])
        sync = page.locator(".ai-planner-box .sync-btn").last
        d.glide(sync)
        sync.click()
        d.speed_wait(lambda: page.wait_for_function(
            "document.querySelectorAll('.ai-planner-box .sync-btn')[document.querySelectorAll('.ai-planner-box .sync-btn').length-1].disabled", timeout=60000))
        d.wait(900)

        d.caption(t["move"])
        d.ask("Move the study group to Tuesday at 6pm.")
        try:
            page.wait_for_function("document.querySelectorAll('.ai-planner-box').length >= 3", timeout=10000)
        except PWTimeout:
            raise TakeRejected("no change proposed for the study group")
        box_text = page.locator(".ai-planner-box").last.inner_text()
        if "Change" not in box_text or "Study group" not in box_text:
            raise TakeRejected(f"the study group change is not an update: {box_text!r}")
        d.show_turn(hold_top=1800, hold_bottom=2000)
        sync = page.locator(".ai-planner-box .sync-btn").last
        d.glide(sync)
        sync.click()
        d.speed_wait(lambda: page.wait_for_function(
            "document.querySelectorAll('.ai-planner-box .sync-btn')[document.querySelectorAll('.ai-planner-box .sync-btn').length-1].disabled", timeout=60000))
        d.wait(700)
        d.click("#chatDrawer .close-btn")
        d.wait(500)

        # 4. the calendar: tasks vs events, drag with a confirmation
        d.caption(t["drag"])
        page.evaluate("""async () => { const { state } = await import('/js/state.js');
            const tasks = state.lastLoadedTasks || []; const g = tasks.find(x => x.title === 'Study group');
            state.calendar.changeView('timeGridWeek', g ? g.dueDate.slice(0, 10) : undefined); state.calendar.scrollToTime('15:30:00'); }""")
        d.wait(1800)
        event = page.locator(".fc-event:has-text('Study group')").first
        if not event.count():
            raise TakeRejected("the study group is not on the calendar")
        box = event.bounding_box()
        slot = page.locator(".fc-timegrid-slot-lane").first.bounding_box()["height"]
        d.glide(event)
        d.wait(500)
        d.caption(t["confirm"])
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2 + slot * 2, steps=22)
        page.mouse.up()
        page.wait_for_selector(".confirm-dialog", state="visible", timeout=5000)
        d.wait(3200)
        d.click(".confirm-dialog .confirm-dialog-yes")
        page.wait_for_selector(".confirm-dialog", state="detached", timeout=5000)
        d.wait(1500)
        event = page.locator(".fc-event:has-text('Study group')").first
        d.glide(event)
        d.wait(400)
        resizer = event.locator(".fc-event-resizer-end")
        rb = resizer.bounding_box()
        page.mouse.move(rb["x"] + rb["width"] / 2, rb["y"] + rb["height"] / 2, steps=8)
        page.mouse.down()
        page.mouse.move(rb["x"] + rb["width"] / 2, rb["y"] + rb["height"] / 2 + slot * 2, steps=18)
        page.mouse.up()
        page.wait_for_selector(".confirm-dialog", state="visible", timeout=5000)
        d.wait(2000)
        d.click(".confirm-dialog .confirm-dialog-yes")
        page.wait_for_selector(".confirm-dialog", state="detached", timeout=5000)
        d.wait(1200)

        # 5. Buddy, the rhythm panel, night mode
        d.caption(t["xp"])
        page.evaluate("async () => { const { state } = await import('/js/state.js'); state.calendar.changeView('dayGridMonth'); }")
        d.click("#todayBandAgenda .tb-check")
        d.wait(1800)
        d.click("#buddyWidget")
        d.wait(500)
        d.click('#buddyWidget [data-action="status"]')
        d.wait(3000)
        d.click("#buddyStatusModal .close-btn")
        d.wait(500)
        d.caption(t["rhythm"])
        d.click('[data-click="openLifePanelModal"]')
        d.wait(3800)
        d.click("#lifePanelModal .close-btn")
        d.wait(400)
        d.caption(t["night"])
        d.click("#nightToggleBtn")
        d.wait(2800)
        d.click("#nightToggleBtn")
        d.wait(800)

        # 6. own key + two languages
        d.caption(t["settings"])
        d.click('[data-click="openSettingsModal"]')
        page.wait_for_selector("#settingsModal", state="visible", timeout=5000)
        d.wait(600)
        page.locator("#aiKeySection").scroll_into_view_if_needed()
        d.wait(3800)
        d.click("#settingsModal .close-btn")
        d.wait(500)
        d.caption(t["lang"])
        d.click("#langToggleBtn")
        d.wait(3300)
        d.click("#langToggleBtn")
        d.wait(900)
        d.caption(None)

        # 7. what I want to study, then the end card
        d.slide(f'<div class="s-big">{t["q_title"]}</div><div class="s-list">'
                f'<div class="s-item">{t["q1"]}</div><div class="s-item">{t["q2"]}</div><div class="s-item">{t["q3"]}</div></div>'
                f'<div class="s-url">{URL_BANNER}</div>')
        d.wait(900)
        d.reveal_items(2300)
        d.wait(3000)
        d.slide(f'<div class="s-big">{t["end_a"]}</div><div class="s-mid">{t["end_b"]}</div><div class="s-url">{URL_BANNER}</div>')
        d.wait(6000)

        stalls = page.evaluate("window.__stalls")
        if stalls:
            raise TakeRejected(f"the browser froze during the take (frame gaps in ms: {stalls})")
        return page.video, t_ready, d.fast, d.now(), errors, ctx
    except BaseException:
        ctx.close()
        raise


def encode(webm, trim, fast, total, out_mp4):
    """Cut the video at `trim`, speed up the AI waits, and write an mp4."""
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cuts = [(a, b) for a, b in sorted(fast) if b - a > 1.2 and a > trim]
    segments, cursor = [], max(trim - 0.2, 0)
    for a, b in cuts:
        segments.append((cursor, a, 1.0))
        segments.append((a, b, SPEEDUP))
        cursor = b
    segments.append((cursor, total + 1.0, 1.0))
    parts = [f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{s}[v{i}]" for i, (a, b, s) in enumerate(segments)]
    graph = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=1:a=0[out]"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(webm), "-filter_complex", graph, "-map", "[out]",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "30", "-movflags", "+faststart", str(out_mp4)], check=True)
    seconds = sum((b - a) / s for a, b, s in segments)
    return seconds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8787")
    ap.add_argument("--out", default=None)
    ap.add_argument("--attempts", type=int, default=6)
    args = ap.parse_args()
    out = Path(args.out) if args.out else ROOT / "demo" / "plantriz-demo-worker-en.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.parent / "_raw_worker"
    tmp.mkdir(exist_ok=True)
    overlay = OVERLAY_JS.replace("__URL__", URL_BANNER)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True, args=["--lang=en-US"])

        def ctx_factory_for(user):
            def factory():
                ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1, timezone_id="America/Chicago",
                                          locale="en-US", record_video_dir=str(tmp), record_video_size={"width": W, "height": H})
                ctx.add_init_script(overlay)
                stored = json.dumps({"id": user["id"], "username": user["username"], "email": user["email"], "name": user["username"],
                                     "timezone": "America/Chicago", "token": user["token"], "preferences": None})
                ctx.add_init_script(f"localStorage.setItem('nexusUser', {json.dumps(stored)}); localStorage.setItem('appLang', 'en');")
                return ctx, time.time(), user
            return factory

        done = False
        for attempt in range(1, args.attempts + 1):
            user = make_demo_user(args.base)
            syllabus, midterm = make_syllabus(out.parent / "import")
            print(f"take {attempt}/{args.attempts} (midterm {midterm:%a %b %d}) ...", flush=True)
            try:
                video, trim, fast, total, errors, ctx = take(ctx_factory_for(user), args.base, {"syllabus": syllabus}, midterm)
            except (TakeRejected, PWTimeout) as e:
                print("  rejected:", str(e).splitlines()[0], flush=True)
                continue
            ctx.close()
            webm = Path(video.path())
            if errors:
                print("  page errors during take:", *errors, sep="\n   ")
            seconds = encode(webm, trim, fast, total, out)
            print(f"saved {out} ({out.stat().st_size / 1e6:.1f} MB, about {seconds:.0f} s)")
            done = True
            break
        browser.close()
    for f in tmp.glob("*.webm"):
        f.unlink(missing_ok=True)
    try:
        tmp.rmdir()
    except OSError:
        pass
    if not done:
        raise SystemExit("all takes were rejected")


if __name__ == "__main__":
    main()
