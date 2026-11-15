// End-to-end smoke test against a running Worker (`npm run dev`), default http://localhost:8787.
// Usage: node scripts/smoke.mjs [baseUrl]
// Creates throw-away users with random names, so it can be re-run on the same local database.

const BASE = process.argv[2] ?? "http://localhost:8787";
const run = Math.random().toString(36).slice(2, 8);

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function call(method, path, { json, query = {} } = {}) {
  const qs = new URLSearchParams(query).toString();
  const started = performance.now();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: json === undefined ? {} : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* plain text */ }
  return { status: res.status, body, ms: performance.now() - started };
}

async function signUp(tag) {
  const res = await call("POST", "/api/auth/signup", {
    json: { username: `${tag}_${run}`, email: `${tag}_${run}@example.com`, password: "secret123", timezone: "America/Chicago" },
  });
  return res;
}

console.log(`Smoke test against ${BASE}\n`);

console.log("auth");
{
  let r = await call("POST", "/api/auth/signup", { json: { username: "x", email: "x@example.com", password: "123" } });
  check("sign-up rejects a short password (400)", r.status === 400, JSON.stringify(r));

  r = await signUp("alice");
  check("sign-up returns the user and a token (200)", r.status === 200 && r.body.token && r.body.id && r.body.username === `alice_${run}`, JSON.stringify(r));
  check("sign-up keeps the requested timezone", r.body.timezone === "America/Chicago");
  const alice = r.body;
  console.log(`       (password hashing took ${r.ms.toFixed(0)} ms locally)`);

  r = await call("POST", "/api/auth/signup", { json: { username: `alice_${run}`, email: `different_${run}@example.com`, password: "secret123" } });
  check("duplicate username is a conflict (409)", r.status === 409 && /Username already exists/.test(r.body.message), JSON.stringify(r));

  r = await signUp("alice");
  check("signing up twice with the same name and e-mail reports the e-mail (409, as the Java backend does)", r.status === 409 && /Email already exists/.test(r.body.message), JSON.stringify(r));

  r = await call("POST", "/api/auth/signup", { json: { username: `other_${run}`, email: `alice_${run}@example.com`, password: "secret123" } });
  check("duplicate email is a conflict (409)", r.status === 409 && /Email already exists/.test(r.body.message), JSON.stringify(r));

  r = await call("POST", "/api/auth/signin", { json: { identifier: `alice_${run}`, password: "wrong-password" } });
  check("wrong password is rejected (401)", r.status === 401);

  r = await call("POST", "/api/auth/signin", { json: { identifier: `ALICE_${run}@Example.com`, password: "secret123" } });
  check("sign-in by e-mail, case-insensitive (200)", r.status === 200 && r.body.id === alice.id, JSON.stringify(r));
  check("a new sign-in issues a new token", r.body.token && r.body.token !== alice.token);
  const aliceToken = r.body.token;

  r = await call("GET", "/api/tasks", { query: { userId: alice.id, authToken: alice.token, timezone: "America/Chicago" } });
  check("the previous token stops working (401)", r.status === 401, JSON.stringify(r));

  alice.token = aliceToken;
  r = await call("PUT", "/api/auth/preferences", { query: { userId: alice.id, authToken: alice.token }, json: { studyBuddy: "duck", theme: "stardew" } });
  check("preferences can be saved", r.status === 200);
  r = await call("GET", "/api/auth/preferences", { query: { userId: alice.id, authToken: alice.token } });
  check("preferences can be read back", r.body.studyBuddy === "duck" && r.body.theme === "stardew", JSON.stringify(r));
  r = await call("PUT", "/api/auth/timezone", { query: { userId: alice.id, authToken: alice.token }, json: { timezone: "Asia/Shanghai" } });
  check("timezone can be changed", r.status === 200 && r.body.timezone === "Asia/Shanghai");
  r = await call("PUT", "/api/auth/timezone", { query: { userId: alice.id, authToken: alice.token }, json: { timezone: "Mars/Olympus" } });
  check("an unknown timezone is rejected (400)", r.status === 400);

  globalThis.alice = alice;
}

const alice = globalThis.alice;
const auth = { userId: alice.id, authToken: alice.token };

console.log("\ntasks");
let taskId;
{
  let r = await call("GET", "/api/tasks", { query: { timezone: "America/Chicago", userId: alice.id, authToken: "nope" } });
  check("a bad token is rejected (401)", r.status === 401);

  r = await call("POST", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" }, json: { title: "CS 225 Homework 7", description: "Linked lists\nFrom chat: test", dueDate: "2026-11-16T10:00:00" } });
  check("create a task (200)", r.status === 200 && r.body.id, JSON.stringify(r));
  taskId = r.body.id;

  r = await call("POST", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" }, json: { title: "No deadline task" } });
  check("create a task without a date", r.status === 200);
  const undatedId = r.body.id;

  r = await call("GET", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" } });
  const t = r.body.find((x) => x.id === taskId);
  check("a task reads back in the same zone", t && t.dueDate === "2026-11-16T10:00" && t.localDueDate === "2026-11-16 10:00", JSON.stringify(t));
  check("description keeps its line breaks", t && t.description === "Linked lists\nFrom chat: test");
  const undated = r.body.find((x) => x.id === undatedId);
  check("a task with no date says 'No Deadline'", undated && undated.localDueDate === "No Deadline" && undated.dueDate === null, JSON.stringify(undated));

  r = await call("GET", "/api/tasks", { query: { ...auth, timezone: "Asia/Shanghai" } });
  const shanghai = r.body.find((x) => x.id === taskId);
  check("the same task shown in Shanghai time", shanghai && shanghai.dueDate === "2026-11-17T00:00", JSON.stringify(shanghai));

  r = await call("POST", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" }, json: { title: "Sync from chat", dueDate: new Date("2026-11-20T15:00:00Z").toISOString() } });
  check("an ISO date with a trailing Z is accepted (chat sync sends one)", r.status === 200, JSON.stringify(r));

  r = await call("PATCH", `/api/tasks/${taskId}/color`, { query: { authToken: alice.token }, json: { color: "#e8b84b" } });
  check("change the colour", r.status === 200 && r.body === "Color updated.");
  r = await call("PATCH", `/api/tasks/${taskId}/color`, { query: { authToken: alice.token }, json: { color: "  " } });
  check("an empty colour is rejected (400)", r.status === 400);

  r = await call("PUT", `/api/tasks/${taskId}`, { query: { authToken: alice.token, timezone: "America/Chicago" }, json: { title: "CS 225 Homework 7 (edited)", description: "new text", dueDate: "2026-11-17T09:30" } });
  check("edit a task", r.status === 200 && r.body === "Task updated.");
  r = await call("GET", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" } });
  const edited = r.body.find((x) => x.id === taskId);
  check("the edit is stored (title, description, new time, colour kept)", edited.title.endsWith("(edited)") && edited.description === "new text" && edited.dueDate === "2026-11-17T09:30" && edited.color === "#e8b84b", JSON.stringify(edited));

  const bob = (await signUp("bob")).body;
  r = await call("DELETE", `/api/tasks/${taskId}`, { query: { authToken: bob.token } });
  check("another user cannot delete it (403)", r.status === 403, JSON.stringify(r));
  r = await call("GET", "/api/tasks", { query: { userId: bob.id, authToken: bob.token, timezone: "America/Chicago" } });
  check("another user does not see it", Array.isArray(r.body) && r.body.length === 0);

  console.log("\ncompletion and the study buddy");
  r = await call("GET", "/api/buddy/state", { query: auth });
  check("a fresh buddy is a calm hatchling using the saved buddy id", r.body.xp === 0 && r.body.stage === "hatchling" && r.body.mood === "calm" && r.body.buddyId === "duck", JSON.stringify(r));

  r = await call("PATCH", `/api/tasks/${taskId}/complete`, { query: { authToken: alice.token }, json: { completed: true } });
  check("complete a task", r.status === 200 && r.body.buddyState && r.body.buddyState.totalTasksCompleted === 1, JSON.stringify(r));
  check("a completion earns XP and makes the buddy excited", r.body.buddyState.xp >= 10 && r.body.buddyState.mood === "excited", JSON.stringify(r.body.buddyState));
  check("it reports level-up flags as booleans", r.body.buddyState.justLeveledUp === false && r.body.buddyState.justAdvancedStage === false);

  r = await call("GET", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" } });
  check("the task now reads as completed", r.body.find((x) => x.id === taskId).completed === true);

  r = await call("PATCH", `/api/tasks/${taskId}/complete`, { query: { authToken: alice.token }, json: { completed: false } });
  check("un-completing drops the XP again", r.body.buddyState.xp === 0 && r.body.buddyState.totalTasksCompleted === 0, JSON.stringify(r.body.buddyState));

  r = await call("DELETE", `/api/tasks/${taskId}`, { query: { authToken: alice.token } });
  check("delete a task", r.status === 200 && r.body === "Task deleted.");
  r = await call("GET", "/api/tasks", { query: { ...auth, timezone: "America/Chicago" } });
  check("the deleted task is gone", !r.body.some((x) => x.id === taskId));
}

console.log("\ncourses and other endpoints");
{
  let r = await call("GET", "/api/courses", { query: { ...auth, timezone: "America/Chicago" } });
  check("no course sessions yet", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, JSON.stringify(r));
  r = await call("GET", "/api/courses", { query: { userId: -1, authToken: "guest" } });
  check("a guest gets an empty list (userId=-1)", r.status === 200 && r.body.length === 0);
  r = await call("DELETE", "/api/courses/999999", { query: { authToken: alice.token } });
  check("deleting a missing course is 404", r.status === 404);

  r = await call("GET", "/api/timezones");
  check("time zone list has continent/city ids only", Array.isArray(r.body) && r.body.includes("America/Chicago") && !r.body.some((z) => z.startsWith("Etc/") || !z.includes("/")));

  // (the chat itself is covered by smoke-ai.mjs, with a fake LLM; here only what needs no model)
  r = await call("POST", "/api/ai/chat", { json: { message: "   " } });
  check("a chat message must not be empty (400)", r.status === 400 && /non-empty 'message'/.test(r.body), JSON.stringify(r));
  r = await call("POST", "/api/ai/chat", { json: { message: "hi", userId: String(alice.id), authToken: "wrong-token" } });
  check("chat with a bad token is rejected (401)", r.status === 401 && /Authentication failed/.test(r.body), JSON.stringify(r));
  r = await call("POST", "/api/ai/translate", { json: { text: "hello", targetLang: "zh", authToken: "wrong-token" } });
  check("translate needs a valid token (401)", r.status === 401);
  r = await call("POST", "/api/ai/translate", { json: { text: "", authToken: alice.token } });
  check("translate needs some text (400)", r.status === 400);

  // study-rhythm analysis: tasks created above ran out, so make a few at known local hours
  const rhythm = (await signUp("rhythm")).body;
  const rq = { userId: rhythm.id, authToken: rhythm.token };
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  for (const [title, time, desc] of [["Morning A", "09:00", "Estimated: 2 h"], ["Morning B", "10:30", ""], ["Evening", "21:00", ""]]) {
    await call("POST", "/api/tasks", { query: { ...rq, timezone: "America/Chicago" }, json: { title, description: desc, dueDate: `${soon}T${time}:00` } });
  }
  r = await call("GET", "/api/analytics/lifestyle", { query: { ...rq, timezone: "America/Chicago", period: "week", lang: "en" } });
  check("the rhythm analysis counts the tasks by local hour", r.status === 200 && r.body.totalTasks === 3 && r.body.timeBuckets[0].count === 2 && r.body.timeBuckets[2].count === 1, JSON.stringify(r.body).slice(0, 300));
  check("it finds the peak window, the rhythm and the focus style", r.body.peakWindow === "Morning 5-12" && r.body.rhythmLabel === "Morning Bird" && r.body.focusStyle === "Steady Rhythm", JSON.stringify([r.body.peakWindow, r.body.rhythmLabel, r.body.focusStyle]));
  check("hours come from the estimate in the description", r.body.hourlyStudy.length === 24 && r.body.hourlyStudy[9].hours === 2 && r.body.hourlyStudy[10].hours === 1, JSON.stringify(r.body.hourlyStudy.slice(9, 11)));
  r = await call("GET", "/api/analytics/lifestyle", { query: { ...rq, timezone: "America/Chicago", period: "day", lang: "zh" } });
  check("the Chinese analysis uses Chinese labels", r.status === 200 && r.body.timeBuckets[0].label === "早晨 5-12", JSON.stringify(r.body).slice(0, 200));
  r = await call("GET", "/api/analytics/lifestyle", { query: { timezone: "America/Chicago", lang: "en" } });
  check("a guest gets an empty analysis", r.status === 200 && r.body.totalTasks === 0 && r.body.peakWindow === "No Data", JSON.stringify(r.body).slice(0, 200));
  r = await call("GET", "/api/analytics/lifestyle", { query: { userId: rhythm.id, authToken: "bad" } });
  check("the analysis of someone's tasks needs their token (401)", r.status === 401);
  r = await call("GET", "/api/analytics/lifestyle", { query: { ...rq, timezone: "Mars/Olympus" } });
  check("an unknown time zone is a 400", r.status === 400);
  r = await call("GET", "/api/does-not-exist");
  check("an unknown API path is a JSON 404", r.status === 404 && r.body.message === "Not found");
}

console.log("\nsign-in options (these checks expect a dev server without Google or e-mail settings; smoke:ai covers the configured case)");
{
  const unconfigured = (await fetch(`${BASE}/api/auth/oauth/google/start`, { redirect: "manual" })).status === 501;
  if (!unconfigured) {
    console.log("  skip Google / password reset: this server has them configured");
  } else {
    let r = await call("POST", "/api/auth/password-reset/request", { json: { email: "someone@example.com" } });
    check("password reset without an e-mail service says so (501)", r.status === 501 && /not set up/.test(r.body.message), JSON.stringify(r));
    r = await call("POST", "/api/auth/oauth/google/start");
    check("Google sign-in without credentials says so (501)", r.status === 501 && /not configured/.test(r.body.message), JSON.stringify(r));
    const callback = await fetch(`${BASE}/api/auth/oauth/google/callback?code=x&state=y`, { redirect: "manual" });
    check("a Google callback without credentials returns to the app with an error", callback.status === 302 && /#oauthError=/.test(callback.headers.get("location") ?? ""), String(callback.status));
  }
  let r = await call("POST", "/api/auth/password-reset/confirm", { json: { email: "someone@example.com", code: "123456", password: "abcdef" } });
  check("a reset code nobody asked for is refused (400)", r.status === 400 && /Invalid or expired/.test(r.body.message), JSON.stringify(r));
  r = await call("POST", "/api/auth/password-reset/confirm", { json: { email: "someone@example.com" } });
  check("a reset needs the code and a new password (400)", r.status === 400);
  r = await call("GET", "/api/tasks", { query: { timezone: "", userId: -1 } });
  check("an empty time zone falls back to the default instead of failing", r.status === 200 || r.status === 401, JSON.stringify(r));
}

console.log("\nimport");
{
  const carol = (await signUp("carol")).body;
  const q = { userId: carol.id, authToken: carol.token, timezone: "America/Chicago" };

  async function upload(name, content, type, query = q) {
    const form = new FormData();
    form.append("file", new Blob([content], { type }), name);
    const qs = new URLSearchParams(query).toString();
    const res = await fetch(`${BASE}/api/import/preview?${qs}`, { method: "POST", body: form });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body };
  }
  const confirm = (importId, itemIds) => call("POST", "/api/import/confirm", { query: { userId: carol.id, authToken: carol.token }, json: { importId, itemIds } });

  // a timetable: CS 225 on Mon/Wed/Fri at 10:00 Chicago, one week
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "SUMMARY:CS 225 Data Structures", "LOCATION:Siebel 1404",
    "DTSTART;TZID=America/Chicago:20271115T100000", "DTEND;TZID=America/Chicago:20271115T105000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20271119", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  let r = await upload("term.ics", ics, "text/calendar");
  check("a timetable previews as course sessions (200)", r.status === 200 && r.body.parser === "ics-calendar" && r.body.items.length === 3, JSON.stringify(r.body).slice(0, 300));
  check("each session is new, with UTC start/end and the location", r.body.items.every((i) => i.kind === "course" && i.status === "new" && i.location === "Siebel 1404") && r.body.items[0].start === "2027-11-15T16:00" && r.body.items[0].end === "2027-11-15T16:50", JSON.stringify(r.body.items[0]));
  check("server-only fields are not sent to the browser", r.body.items.every((i) => !("importKey" in i)));
  const icsPreview = r.body;

  r = await confirm(icsPreview.importId, icsPreview.items.slice(0, 2).map((i) => i.id));
  check("confirming two of three imports exactly two", r.status === 200 && r.body.coursesCreated === 2 && r.body.skipped === 1, JSON.stringify(r));

  r = await call("GET", "/api/courses", { query: q });
  check("the sessions appear in the course list in local time", r.body.length === 2 && r.body[0].start === "2027-11-15T10:00" && r.body[0].end === "2027-11-15T10:50", JSON.stringify(r.body));

  r = await confirm(icsPreview.importId, []);
  check("a preview can only be confirmed once (400, expired)", r.status === 400 && /expired/i.test(r.body.message), JSON.stringify(r));

  r = await upload("term.ics", ics, "text/calendar");
  check("importing the same timetable again marks two sessions as already there", r.body.items.filter((i) => i.status === "duplicate").length === 2 && r.body.items.filter((i) => i.status === "new").length === 1, JSON.stringify(r.body.items.map((i) => i.status)));
  r = await confirm(r.body.importId, null);
  check("confirming everything adds only the missing session", r.body.coursesCreated === 1 && r.body.duplicates === 2, JSON.stringify(r));

  // Canvas assignments: first import, then the same assignment with a moved deadline
  const canvas = (due) => JSON.stringify([{ name: "Homework", assignments: [
    { id: 1, name: "HW 1", due_at: due, html_url: "https://canvas.example/c/1/a/1" },
    { id: 2, name: "HW 2", due_at: "2020-01-01T00:00:00Z", html_url: "https://canvas.example/c/1/a/2" },
  ] }]);
  r = await upload("canvas.json", canvas("2027-11-20T06:00:00Z"), "application/json");
  check("Canvas assignments preview as tasks", r.status === 200 && r.body.parser === "canvas-json" && r.body.items.length === 2, JSON.stringify(r.body).slice(0, 200));
  check("an assignment already past is flagged", r.body.items[1].past === true && r.body.items[0].past === false);
  r = await confirm(r.body.importId, [r.body.items[0].id]);
  check("confirm creates the chosen assignment", r.status === 200 && r.body.tasksCreated === 1 && r.body.tasks === 1, JSON.stringify(r));

  r = await upload("canvas.json", canvas("2027-11-27T06:00:00Z"), "application/json");
  check("the same assignment with a new deadline is an update, showing the old one", r.body.items[0].status === "update" && r.body.items[0].existingDueDate === "2027-11-20T06:00", JSON.stringify(r.body.items[0]));
  r = await confirm(r.body.importId, [r.body.items[0].id]);
  check("confirming an update changes only the deadline", r.body.tasksUpdated === 1 && r.body.tasksCreated === 0, JSON.stringify(r));
  r = await call("GET", "/api/tasks", { query: q });
  check("the task shows the new deadline in local time", r.body.filter((t) => t.title === "HW 1").length === 1 && r.body.find((t) => t.title === "HW 1").dueDate === "2027-11-27T00:00", JSON.stringify(r.body.map((t) => [t.title, t.dueDate])));

  // limits and permissions
  r = await upload("x.json", "{}", "application/json", { ...q, authToken: "wrong" });
  check("a bad token cannot preview (401)", r.status === 401);
  r = await upload("empty.ics", "", "text/calendar");
  check("an empty file is rejected (400)", r.status === 400);
  r = await upload("notes.txt", "just some words", "text/plain");
  check("a file that is not .ics or JSON says so (400)", r.status === 400 && /not a calendar/.test(r.body.message), JSON.stringify(r));
  r = await upload("syllabus.pdf", "%PDF-1.4", "application/pdf");
  check("a PDF sent to the structured endpoint is pointed to the document import (400)", r.status === 400 && /preview-text/.test(r.body.message), JSON.stringify(r));
  r = await upload("big.json", "[" + "0,".repeat(1_100_000) + "0]", "application/json");
  check("a file over 2 MB is rejected (413)", r.status === 413, `status ${r.status}`);

  const dave = (await signUp("dave")).body;
  const forDave = await upload("term.ics", ics, "text/calendar", { userId: dave.id, authToken: dave.token, timezone: "America/Chicago" });
  r = await call("POST", "/api/import/confirm", { query: { userId: carol.id, authToken: carol.token }, json: { importId: forDave.body.importId, itemIds: null } });
  check("one user cannot confirm another user's preview (400)", r.status === 400, JSON.stringify(r));

  r = await call("POST", "/api/import/preview-text", { query: q, json: { fileName: "a.pdf", text: "   " } });
  check("a document with no text is rejected (400)", r.status === 400);
}

console.log("\nfrontend (static assets)");
{
  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  check("the home page is served", page.status === 200 && html.includes("PlanTriz"));
  const js = await fetch(`${BASE}/js/app.js`);
  check("JavaScript modules are served", js.status === 200 && (await js.text()).includes("import"));
  const css = await fetch(`${BASE}/styles/pixel.css`);
  check("stylesheets are served", css.status === 200);
  const icon = await fetch(`${BASE}/favicon.svg`);
  check("the favicon is served", icon.status === 200);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
