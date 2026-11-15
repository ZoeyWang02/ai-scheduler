"""Record a scripted PlanTriz walkthrough video.

Prerequisites: backend on :8081, frontend on :8099, Docker Postgres up, and
    pip install playwright imageio-ffmpeg        (uses the system Edge, no browser download)

Usage:
    python tools/record_demo.py                  # English UI -> demo/plantriz-demo-en.mp4
    python tools/record_demo.py --lang zh        # Chinese UI -> demo/plantriz-demo-zh.mp4
    python tools/record_demo.py --gif            # also writes a .gif next to the .mp4

The script resets/seeds the demo account (tools/seed_demo.py) before every take so Buddy starts at
Lv.1 and the calendar is identical each time. The AI answers are real and vary a little, so each
take is checked (a sensible first plan, a second plan that really moved to the evening); a take
that fails the check is thrown away and recorded again.
"""
import argparse
import re
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import imageio_ffmpeg
from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import make_demo_import  # noqa: E402  (random .ics / Canvas .json files for the import scenes)
FRONTEND = "http://localhost:8099/"
# ~1440 CSS px wide, close to a 2560x1600 laptop at 175% scaling (so text looks the size users see).
W, H = 1440, 810
USER, PASSWORD = "demo_student", "demo1234"

TEXT = {
    "en": {
        "intro": "PlanTriz · a pixel-art study planner",
        "signin": "Sign in with the demo account",
        "glance": "Your week at a glance: calendar and what's next",
        "tell": "Tell your Study Buddy what's coming up",
        "q1": "I have a STAT 400 midterm next Friday at 3pm. Can you plan three study sessions for me before it, one per day?",
        "plan1": "It finds the date and drafts a plan",
        "q2": "I have class until 5pm on weekdays, can you move them all to after 7pm?",
        "plan2": "It remembers the conversation and re-plans for the evening",
        "q3": "Is two hours per session enough for this midterm?",
        "answer3": "Ask follow-up questions, get a plain answer",
        "apply": "Happy with it? Apply the plan in one click",
        "calendar": "The sessions are on your calendar",
        "task": "Open any task: the description remembers which chat it came from",
        "ics_pick": "Import your class schedule: choose a calendar file (.ics)",
        "ics_preview": "Class sessions are detected and shown for review first",
        "ics_done": "Your classes are now on the calendar",
        "json_pick": "Assignments too: choose a Canvas export (.json)",
        "json_preview": "New, already added, changed deadline, past: every item is labelled",
        "json_done": "Only what you tick is imported, and the moved deadline is updated",
        "xp": "Finish a task and your Study Buddy earns XP",
        "buddy": "Buddy status: level, growth stage, mood",
        "night": "Night mode",
        "lang_zh": "Switch the whole interface to Chinese in one click",
        "lang_en": "...and back to English",
        "saved": "Every conversation is saved",
        "outro": "PlanTriz · let AI fit your studying into your calendar",
    },
    "zh": {
        "intro": "PlanTriz · 像素风学习日程助手",
        "signin": "登录演示账号",
        "glance": "日历和「接下来」一眼看清本周安排",
        "tell": "告诉学习伙伴你接下来的安排",
        "q1": "下周五下午 3 点我有一个 STAT 400 期中考试，帮我在考试之前安排三次复习，每天一次",
        "plan1": "AI 识别日期，先给出一版计划",
        "q2": "我工作日 5 点前都有课，能把它们都挪到晚上 7 点以后吗？",
        "plan2": "AI 记得上文，按晚上重新排",
        "q3": "每次两个小时，对这场期中考试够吗？",
        "answer3": "继续追问，AI 用文字直接回答",
        "apply": "满意就一键应用计划",
        "calendar": "复习安排已经在日历里",
        "task": "点开任意任务，描述里记着它来自哪次对话",
        "ics_pick": "导入课程表：选择日历文件 (.ics)",
        "ics_preview": "先预览识别出的课程节次，再决定是否导入",
        "ics_done": "课程已经出现在日历里",
        "json_pick": "作业也可以：选择 Canvas 导出的 .json",
        "json_preview": "新增、已存在、截止时间变更、已过期，每一项都有标注",
        "json_done": "只导入你勾选的内容，变更的截止时间会被更新",
        "xp": "完成任务，学习伙伴就会获得经验值",
        "buddy": "Buddy 状态：等级、成长阶段、心情",
        "night": "夜间模式",
        "lang_zh": "一键切换成英文界面",
        "lang_en": "……再切回中文",
        "saved": "每一次对话都会保存",
        "outro": "PlanTriz · AI 帮你把学习排进日历",
    },
}

# Fake cursor + click ring + caption bar. Headless video has no OS cursor, so draw our own.
OVERLAY_JS = r"""
(() => {
  const css = `
    #demo-cursor{position:fixed;left:-40px;top:-40px;width:22px;height:28px;z-index:2147483647;pointer-events:none;
      image-rendering:pixelated;transition:none;
      background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='28' shape-rendering='crispEdges'><path d='M2 2h4v2h2v2h2v2h2v2h2v2h2v2h-6v2h2v4h-4v-4h-2v-2h-2v2h-2z' fill='%234d3319'/><path d='M4 6h2v2h2v2h2v2h2v2h-4v2h-2v-2h-2z' fill='%23fffdf6'/></svg>") no-repeat;}
    .demo-ring{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border:3px solid #e8b84b;border-radius:50%;
      z-index:2147483646;pointer-events:none;animation:demoring .55s ease-out forwards}
    @keyframes demoring{to{transform:scale(3.2);opacity:0}}
    #demo-caption{position:fixed;left:84px;bottom:18px;max-width:700px;z-index:2147483645;pointer-events:none;
      font-size:18px;line-height:1.45;font-family:inherit;color:#fff8e1;background:#4d3319;border:2px solid #e8b84b;
      padding:8px 16px;box-shadow:4px 4px 0 rgba(0,0,0,.35);opacity:0;transform:translateY(6px);
      transition:opacity .25s,transform .25s}
    #demo-caption.on{opacity:1;transform:none}`;
  const mk = () => {
    if (!document.body || document.getElementById('demo-cursor')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'demo-cursor'; document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'demo-caption'; document.body.appendChild(cap);
  };
  document.addEventListener('DOMContentLoaded', mk);
  document.addEventListener('mousemove', e => {
    mk(); const c = document.getElementById('demo-cursor'); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px';
  }, true);
  document.addEventListener('mousedown', e => {
    const r = document.createElement('div'); r.className = 'demo-ring'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  // Frame-gap monitor: when other programs starve the browser, the page freezes for seconds and the
  // video shows a frozen picture. Record every gap over 1 s so the take can be rejected.
  window.__stalls = [];
  window.addEventListener('load', () => {
    let last = performance.now();
    const tick = t => { if (t - last > 1000) window.__stalls.push(Math.round(t - last)); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
})();
"""


class TakeRejected(Exception):
    """The AI's answers were not good enough to show; record the take again."""


class Director:
    def __init__(self, page):
        self.page = page

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    def caption(self, text):
        self.page.evaluate(
            """t => { const c = document.getElementById('demo-caption'); if (!c) return;
                      if (t) { c.textContent = t; c.classList.add('on'); } else c.classList.remove('on'); }""",
            text,
        )

    def glide(self, locator, steps=28):
        locator.scroll_into_view_if_needed()
        box = locator.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=steps)
        self.wait(180)

    def click(self, selector, **kw):
        loc = self.page.locator(selector).first
        self.glide(loc)
        loc.click(**kw)

    def type(self, selector, text, delay=70):
        self.click(selector)
        self.page.keyboard.type(text, delay=delay)

    def smooth_scroll(self, selector, to_top=None):
        self.page.evaluate(
            """([sel, top]) => { const m = document.querySelector(sel);
                 m.scrollTo({top: top === null ? m.scrollHeight : top, behavior: 'smooth'}); }""",
            [selector, to_top],
        )

    def show_turn(self, hold_top=2200, hold_bottom=2400):
        """Pause on the start of the latest turn (the user's message and the AI's opening words), then
        scroll down to the end of the reply. The chat window is small, so by default only the tail of a
        long plan would be visible."""
        self.page.evaluate(
            """() => { const rows = [...document.querySelectorAll('#messages .message-row.user')];
                      if (rows.length) rows[rows.length - 1].scrollIntoView({behavior: 'smooth', block: 'start'}); }""")
        self.wait(hold_top)
        self.smooth_scroll("#messages", None)
        self.wait(hold_bottom)

    def ask(self, selector_input, text):
        """Type a message, send it, and wait until the AI's reply has arrived."""
        self.type(selector_input, text, delay=55)
        self.wait(500)
        self.page.keyboard.press("Enter")
        self.page.wait_for_selector("#ai-loading-placeholder", state="attached", timeout=8000)
        self.page.wait_for_selector("#ai-loading-placeholder", state="detached", timeout=60000)
        self.wait(900)
        if self.page.locator("#messages .message.ai.error").count():
            raise TakeRejected("AI returned an error message")

    def last_plan_times(self):
        """Suggested start time of every step in the newest plan box."""
        texts = self.page.locator(".ai-planner-box").last.locator(".planner-item label span").all_inner_texts()
        found = [re.search(r"(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})", t) for t in texts]
        return [datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}:{m.group(3)}:00") for m in found if m]


def exam_time():
    """The midterm the demo user mentions: the first Friday after today, 15:00."""
    today = date.today()
    days = (4 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days), datetime.min.time()).replace(hour=15)


def check_plan(times, label, evening):
    exam = exam_time()
    # The plan may list the exam itself (exactly at exam time); study sessions are everything else.
    sessions = [t for t in times if t != exam]
    if not 2 <= len(sessions) <= 5:
        raise TakeRejected(f"{label}: {len(sessions)} study sessions")
    late = [t.isoformat() for t in times if t > exam]
    if late:
        raise TakeRejected(f"{label}: steps after the exam ({exam:%a %H:%M}): {late}")
    if evening and min(t.hour for t in sessions) < 19:
        raise TakeRejected(f"{label}: not moved to the evening: {[t.strftime('%a %H:%M') for t in sessions]}")


def take(ctx_factory, lang, files):
    t = TEXT[lang]
    ctx, started = ctx_factory()
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        d = Director(page)
        page.goto(FRONTEND)
        page.wait_for_selector("#todayBand")
        d.wait(1200)
        t_ready = time.time() - started  # video seconds before the page is actually painted

        d.caption(t["intro"])
        d.wait(2600)

        # 1. sign in
        d.caption(t["signin"])
        d.click("#authGuestNav button")
        d.wait(500)
        d.type("#authIdentifier", USER, delay=60)
        d.type("#authPassword", PASSWORD, delay=60)
        d.wait(300)
        d.click("#authSubmitBtn")
        page.wait_for_selector("#todayBandAgenda .tb-check")
        d.wait(600)
        d.caption(t["glance"])
        d.wait(3200)

        # 2. a real conversation: plan -> "move it to the evening" -> a follow-up question -> apply
        d.caption(t["tell"])
        d.click("#chatToggleBtn")
        d.wait(1400)
        d.click(".chat-new-btn")
        d.wait(800)

        d.ask("#userInput", t["q1"])
        d.caption(t["plan1"])
        page.wait_for_selector(".ai-planner-box .sync-btn", timeout=10000)
        check_plan(d.last_plan_times(), "first plan", evening=False)
        d.show_turn()

        d.ask("#userInput", t["q2"])
        d.caption(t["plan2"])
        try:
            page.wait_for_function("document.querySelectorAll('.ai-planner-box').length >= 2", timeout=10000)
        except PWTimeout:
            raise TakeRejected("the AI did not return a revised plan")
        check_plan(d.last_plan_times(), "second plan", evening=True)
        d.show_turn(hold_bottom=2800)

        d.ask("#userInput", t["q3"])
        d.caption(t["answer3"])
        if page.locator(".ai-planner-box").count() != 2:
            raise TakeRejected("the follow-up question produced another plan instead of an answer")
        d.show_turn(hold_top=1500, hold_bottom=2600)

        # Back to the evening plan (it sits above the follow-up answer) and apply it.
        d.caption(t["apply"])
        page.evaluate("""() => { const boxes = document.querySelectorAll('.ai-planner-box');
                                 boxes[boxes.length - 1].scrollIntoView({behavior: 'smooth', block: 'center'}); }""")
        d.wait(1100)
        sync = page.locator(".ai-planner-box .sync-btn").last
        d.glide(sync)
        sync.click()
        d.wait(2200)
        d.click("#chatDrawer .close-btn")
        d.wait(600)
        d.caption(t["calendar"])
        page.mouse.move(700, 600, steps=20)
        d.wait(3600)

        # 2b. open a task: its description says which chat it came from
        d.caption(t["task"])
        d.click(".fc-event:has-text('[AI]')")
        page.wait_for_selector("#taskModal", state="visible", timeout=5000)
        d.wait(4800)
        d.click("#taskModal .close-btn")
        d.wait(700)

        # 2c. import a class timetable (.ics) and a Canvas export (.json), both randomly generated
        def run_import(path, pick, preview, done, min_rows, need_badges=()):
            d.caption(t[pick])
            d.click('#iconRail button[onclick="openImportModal()"]')
            page.wait_for_selector("#importModal", state="visible", timeout=5000)
            d.wait(900)
            d.glide(page.locator("#unifiedImportFile"))
            page.set_input_files("#unifiedImportFile", str(path))
            d.wait(1100)
            d.caption(t[preview])
            d.click('#importModal button[onclick="previewUnifiedImport()"]')
            page.wait_for_selector("#importPreviewList .import-preview-item", timeout=15000)
            d.wait(1200)
            if page.locator("#importPreviewList .import-preview-item").count() < min_rows:
                raise TakeRejected(f"{path.name}: fewer than {min_rows} rows in the preview")
            for badge in need_badges:
                if not page.locator(f".import-badge-{badge}").count():
                    raise TakeRejected(f"{path.name}: no '{badge}' row in the preview")
            d.smooth_scroll("#importPreviewList", None)  # no-op when the list already fits
            d.wait(2600)
            d.smooth_scroll("#importPreviewList", 0)
            d.wait(1400)
            d.caption(t[done])
            d.click("#confirmImportBtn")
            page.wait_for_selector("#importModal", state="hidden", timeout=15000)
            d.wait(3200)

        run_import(files["ics"], "ics_pick", "ics_preview", "ics_done", min_rows=4)
        run_import(files["canvas"], "json_pick", "json_preview", "json_done", min_rows=5,
                   need_badges=("update", "past", "exists"))

        # 3. complete a task -> buddy
        d.caption(t["xp"])
        d.click("#todayBandAgenda .tb-check")
        d.wait(2600)
        d.click("#buddyWidget")
        d.wait(900)
        d.caption(t["buddy"])
        d.click('#buddyWidget [data-action="status"]')
        d.wait(3800)
        d.click("#buddyStatusModal .close-btn")
        d.wait(700)

        # 4. night mode, language, saved chats
        d.caption(t["night"])
        d.click("#nightToggleBtn")
        d.wait(2800)
        d.caption(t["lang_zh"])
        d.click("#langToggleBtn")
        d.wait(2600)
        d.caption(t["lang_en"])
        d.click("#langToggleBtn")
        d.wait(1800)
        d.caption(t["saved"])
        d.click("#chatToggleBtn")
        d.wait(3000)
        d.click("#chatDrawer .close-btn")
        d.wait(500)
        d.caption(t["outro"])
        d.wait(2400)

        stalls = page.evaluate("window.__stalls")
        if stalls:
            raise TakeRejected(f"the browser froze during the take (frame gaps in ms: {stalls})")

        video = page.video
        return video, t_ready, errors, ctx
    except BaseException:
        ctx.close()
        raise


def encode(webm, trim, out_mp4, gif):
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    ss = f"{max(trim - 0.25, 0):.2f}"
    subprocess.run(
        [ff, "-y", "-loglevel", "error", "-ss", ss, "-i", str(webm), "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "18", "-r", "30", "-movflags", "+faststart", str(out_mp4)], check=True)
    if gif:
        palette = out_mp4.with_suffix(".palette.png")
        vf = "fps=10,scale=960:-1:flags=neighbor"
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(out_mp4), "-vf", vf + ",palettegen=max_colors=96",
                        str(palette)], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(out_mp4), "-i", str(palette), "-lavfi",
                        vf + "[x];[x][1:v]paletteuse=dither=none", str(out_mp4.with_suffix(".gif"))], check=True)
        palette.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=sorted(TEXT), default="en")
    ap.add_argument("--out", default=None)
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--attempts", type=int, default=5)
    args = ap.parse_args()
    out = Path(args.out) if args.out else ROOT / "demo" / f"plantriz-demo-{args.lang}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.parent / "_raw"
    tmp.mkdir(exist_ok=True)

    with sync_playwright() as p:
        # --lang sets the browser's own UI language (the native "Choose file" button follows it).
        browser = p.chromium.launch(channel="msedge", headless=True,
                                    args=[f"--lang={'en-US' if args.lang == 'en' else 'zh-CN'}"])

        def ctx_factory():
            ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1,
                                      timezone_id="America/Chicago",
                                      locale="en-US" if args.lang == "en" else "zh-CN",
                                      record_video_dir=str(tmp), record_video_size={"width": W, "height": H})
            ctx.add_init_script(OVERLAY_JS)
            ctx.add_init_script(f"if (!localStorage.getItem('appLang')) localStorage.setItem('appLang', '{args.lang}');")
            return ctx, time.time()

        done = False
        for attempt in range(1, args.attempts + 1):
            subprocess.run([sys.executable, str(ROOT / "tools" / "seed_demo.py"), "--reset", "--lang", args.lang],
                           check=True, stdout=subprocess.DEVNULL)
            # A fresh random timetable and assignment export for every take.
            files = make_demo_import.generate(out.parent / "import")
            print(f"take {attempt}/{args.attempts} ...", flush=True)
            print("  timetable:", "; ".join(files["ics_summary"]), flush=True)
            try:
                video, trim, errors, ctx = take(ctx_factory, args.lang, files)
            except (TakeRejected, PWTimeout) as e:
                print("  rejected:", str(e).splitlines()[0])
                continue
            ctx.close()  # flushes the video file
            webm = Path(video.path())
            if errors:
                print("  page errors during take:", *errors, sep="\n   ")
            encode(webm, trim, out, args.gif)
            print("saved", out, f"({out.stat().st_size / 1e6:.1f} MB)")
            if args.gif:
                g = out.with_suffix(".gif")
                print("saved", g, f"({g.stat().st_size / 1e6:.1f} MB)")
            done = True
            break
        browser.close()
    for f in tmp.glob("*.webm"):
        f.unlink(missing_ok=True)
    tmp.rmdir()
    if not done:
        raise SystemExit("all takes were rejected")


if __name__ == "__main__":
    main()
