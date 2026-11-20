// A fake OpenAI-compatible LLM server plus a Worker (isolated local database) wired to it, so the AI features
// can be tested without an API key. Used by smoke-ai.mjs; run it directly to keep the stack up for manual or
// browser testing:  node scripts/mock-stack.mjs   ->  http://127.0.0.1:8790
//
// The mock always rate-limits the main model "mock-big", so every call also exercises the fallback model.

import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_MOCK_PORT = 8788;
export const DEFAULT_WORKER_PORT = 8790;

/** What the fake model answers with when it reads a document (dates are in 2027 so they are never "past"). */
export const REPLY = JSON.stringify([
  { kind: "event", title: "Midterm exam", description: "Covers chapters 1-5.", dueDate: "2027-11-19T15:00", end: "2027-11-19T17:00", confidence: 0.95, evidence: "Midterm: Friday Nov 19, 3pm" },
  { kind: "task", title: "Project proposal", dueDate: "2027-11-24", confidence: 0.8 },
  { kind: "course", title: "STAT 400 lecture", start: "2027-11-15T10:00", end: "2027-11-15T10:50", location: "Everitt 2205", confidence: 0.9 },
]);

/** What it answers with in the chat: a sentence and a plan. */
export const CHAT_PLAN = JSON.stringify([
  { action: "add", step: "STAT 400 review", description: "Review chapters 1-5.", estimatedHours: 2, suggestedDate: "2027-11-17T19:00:00" },
]);

const npx = (args) => spawnSync("npx", args, { shell: true, encoding: "utf8", env: { ...process.env, CI: "true" } });

/** Google accounts the fake sign-in knows, by authorization code (the test passes the code it wants). */
export const GOOGLE_PROFILES = {
  alice: { email: "google.alice@example.com", name: "Alice G", email_verified: true },
  linked: { email: "google.linked@example.com", name: "Linked Person", email_verified: true },
  jane: { email: "jane@example.com", name: "Jane One", email_verified: true },
  jane2: { email: "jane@other.example.com", name: "Jane Two", email_verified: true },
  resetme: { email: "google.resetme@example.com", name: "Reset Me", email_verified: true },
  unverified: { email: "unverified@example.com", name: "Not Verified", email_verified: false },
};

/** Returns { base, seen, emails, setMode, stop }. mode: ok | prose | busy | broken.
 *  `seen` has { model, system, user, messages } for every LLM request (`messages` is the whole list);
 *  `emails` has every message the Worker sent through the fake e-mail API. */
export async function startMockStack({ mockPort = DEFAULT_MOCK_PORT, workerPort = DEFAULT_WORKER_PORT, state = ".wrangler/mock-stack-state", dailyLimit = 60 } = {}) {
  let mode = "ok";
  const seen = [];
  const emails = [];

  const mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const json = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
      // --- fake Google: the authorization code is the name of the account to sign in as ---
      if (req.url.startsWith("/google/auth")) {
        // The "consent screen": sends the browser straight back, signed in as "alice" (or ?login_hint=<name>).
        const q = new URL(req.url, "http://mock").searchParams;
        const back = new URL(q.get("redirect_uri"));
        back.searchParams.set("code", q.get("login_hint") || "alice");
        back.searchParams.set("state", q.get("state") ?? "");
        res.writeHead(302, { Location: back.href });
        return res.end();
      }
      if (req.url.startsWith("/google/token")) {
        const code = new URLSearchParams(body).get("code") ?? "";
        return GOOGLE_PROFILES[code] ? json(200, { access_token: `at-${code}` }) : json(400, { error: "invalid_grant" });
      }
      if (req.url.startsWith("/google/userinfo")) {
        const code = (req.headers.authorization ?? "").replace("Bearer at-", "");
        return GOOGLE_PROFILES[code] ? json(200, GOOGLE_PROFILES[code]) : json(401, { error: "bad token" });
      }
      // --- fake e-mail API (Resend) ---
      if (req.url.startsWith("/email/emails")) {
        emails.push({ auth: req.headers.authorization, ...JSON.parse(body || "{}") });
        return json(200, { id: `mail-${emails.length}` });
      }
      const parsed = JSON.parse(body || "{}");
      const messages = parsed.messages ?? [];
      const [system, user] = messages;
      seen.push({ model: parsed.model, system: system?.content ?? "", user: user?.content ?? "", messages, temperature: parsed.temperature });
      const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (parsed.model === "mock-big" || mode === "busy") return send(429, { error: "rate limited" });
      if (mode === "broken") return send(500, { error: "boom" });

      const prompt = system?.content ?? "";
      let content;
      if (mode === "prose") content = "I could not find any dates in this document.";
      else if (prompt.startsWith("You translate task titles")) {
        // The task translator: answers every item with its text marked "<to>:", empty text stays empty.
        const items = JSON.parse(user?.content ?? "[]");
        content = JSON.stringify(items.map((i) => ({ title: i.title ? `${i.to}:${i.title}` : "", description: i.description ? `${i.to}:${i.description}` : "" })));
      } else if (prompt.startsWith("You are a translator")) content = "  Hello, this is translated.  ";
      else if (prompt.startsWith("你是一个翻译助手")) content = "你好，这是译文。";
      else if (prompt.includes("UIUC academic assistant") || prompt.includes("UIUC的学术助理")) content = `Here is a plan for you.\n${CHAT_PLAN}`;
      else content = `Sure, here you go:\n${REPLY}`;
      send(200, { choices: [{ message: { content } }] });
    });
  });
  await new Promise((resolve) => mock.listen(mockPort, "127.0.0.1", resolve));

  rmSync(state, { recursive: true, force: true });
  const migrate = npx(["wrangler", "d1", "migrations", "apply", "plantriz", "--local", "--persist-to", state]);
  if (migrate.status !== 0) throw new Error("migration failed:\n" + migrate.stdout + migrate.stderr);

  const worker = spawn("npx", [
    "wrangler", "dev", "--local", "--port", String(workerPort), "--host", `127.0.0.1:${workerPort}`, "--persist-to", state,
    "--var", `LLM_API_URL:http://127.0.0.1:${mockPort}/v1/chat/completions`,
    "--var", `AI_DAILY_LIMIT:${dailyLimit}`,
    "--var", "LLM_API_KEY:test-key", "--var", "LLM_MODEL:mock-big", "--var", "LLM_FALLBACK_MODEL:mock-small",
    "--var", "GOOGLE_CLIENT_ID:mock-client-id", "--var", "GOOGLE_CLIENT_SECRET:mock-client-secret",
    "--var", `GOOGLE_AUTH_URL:http://127.0.0.1:${mockPort}/google/auth`,
    "--var", `GOOGLE_TOKEN_URL:http://127.0.0.1:${mockPort}/google/token`,
    "--var", `GOOGLE_USERINFO_URL:http://127.0.0.1:${mockPort}/google/userinfo`,
    // (quoted: the arguments go through a shell, which would read < and > as redirections)
    "--var", "RESEND_API_KEY:mock-resend-key", "--var", '"EMAIL_FROM:PlanTriz <noreply@plantriz.test>"',
    "--var", `EMAIL_API_URL:http://127.0.0.1:${mockPort}/email/emails`,
  ], { shell: true, stdio: "ignore", env: { ...process.env, CI: "true" } });

  const base = `http://127.0.0.1:${workerPort}`;
  const stop = () => {
    if (worker.pid) spawnSync("taskkill", ["/pid", String(worker.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
    mock.close();
  };

  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/api/ai/status`)).ok) return { base, seen, emails, setMode: (m) => { mode = m; }, stop }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error("the Worker did not start");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stack = await startMockStack();
  console.log(`Worker with a fake LLM is running at ${stack.base} (Ctrl+C to stop)`);
  process.on("SIGINT", () => { stack.stop(); process.exit(0); });
  setInterval(() => {}, 1 << 30);
}
