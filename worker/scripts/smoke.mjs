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

  r = await call("POST", "/api/ai/chat", { json: { message: "hi" } });
  check("AI chat says it is not available yet (501), not a 404", r.status === 501, JSON.stringify(r));
  r = await call("POST", "/api/import/preview");
  check("import says it is not available yet (501)", r.status === 501);
  r = await call("GET", "/api/does-not-exist");
  check("an unknown API path is a JSON 404", r.status === 404 && r.body.message === "Not found");
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
