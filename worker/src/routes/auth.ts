import { Hono } from "hono";

import { AuthError, authResponse, numberOrNull, requireUser } from "../auth";
import { hashPassword, issueToken, iterationsFromEnv, verifyPassword } from "../crypto";
import { parsePreferences, userByEmail, userByUsername } from "../db";
import type { UserRow } from "../db";
import { isEmailConfigured, resetCodeEmail, sendEmail } from "../email";
import type { Env } from "../env";
import { authorizationUrl, clearNonceCookie, fetchGoogleProfile, googleConfig, newNonce, NONCE_COOKIE, nonceCookie, pickUsername, readCookie, signState, verifyState } from "../oauth";
import { generateCode, hashCode, RESET_COOLDOWN_MS, RESET_MAX_ATTEMPTS, RESET_TTL_MS, sameHash } from "../reset";
import { assertTimeZone, msToStored, nowStored, storedToMs } from "../time";

export const authRoutes = new Hono<{ Bindings: Env }>();

const norm = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;

const readBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
  const body = await c.req.json().catch(() => ({}));
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

authRoutes.get("/preferences", async (c) => {
  try {
    const user = await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"));
    return c.json(parsePreferences(user.preferences) ?? {});
  } catch (e) {
    if (e instanceof AuthError) return c.json({ message: e.message }, 401);
    throw e;
  }
});

authRoutes.put("/preferences", async (c) => {
  try {
    const user = await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"));
    const preferences = await readBody(c);
    await c.env.DB.prepare("UPDATE users SET preferences = ? WHERE id = ?").bind(JSON.stringify(preferences), user.id).run();
    return c.json({ message: "Preferences updated." });
  } catch (e) {
    if (e instanceof AuthError) return c.json({ message: e.message }, 401);
    throw e;
  }
});

authRoutes.put("/timezone", async (c) => {
  try {
    const user = await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"));
    const timezone = (await readBody(c)).timezone;
    if (typeof timezone !== "string" || !timezone.trim()) return c.json({ message: "Timezone is required" }, 400);
    try {
      assertTimeZone(timezone);
    } catch {
      return c.json({ message: "Unknown timezone" }, 400);
    }
    await c.env.DB.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(timezone, user.id).run();
    return c.json({ message: "Timezone updated.", timezone });
  } catch (e) {
    if (e instanceof AuthError) return c.json({ message: e.message }, 401);
    throw e;
  }
});

authRoutes.post("/signup", async (c) => {
  const body = await readBody(c);
  const email = norm(body.email);
  const username = norm(body.username);
  const password = typeof body.password === "string" ? body.password : null;
  if (!username || !email || !password || password.length < 6) {
    return c.json({ message: "Username, email, and a password of at least 6 characters are required" }, 400);
  }
  const db = c.env.DB;
  const existingByEmail = await userByEmail(db, email);
  const existingByUsername = await userByUsername(db, username);
  if (existingByUsername && (!existingByEmail || existingByUsername.id !== existingByEmail.id)) {
    return c.json({ message: "Username already exists" }, 409);
  }
  if (existingByEmail && existingByEmail.password_hash != null) {
    return c.json({ message: "Email already exists" }, 409);
  }

  const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone : null;
  if (timezone) {
    try {
      assertTimeZone(timezone);
    } catch {
      return c.json({ message: "Unknown timezone" }, 400);
    }
  }
  const passwordHash = await hashPassword(password, iterationsFromEnv(c.env.PBKDF2_ITERATIONS));
  const token = issueToken();

  let user: UserRow | null;
  if (existingByEmail) {
    // An account created through Google sign-in (no password yet) is completed here.
    await db.prepare("UPDATE users SET username = ?, name = ?, password_hash = ?, auth_token = ?, timezone = COALESCE(?, timezone) WHERE id = ?")
      .bind(username, username, passwordHash, token, timezone, existingByEmail.id).run();
  } else {
    await db.prepare("INSERT INTO users (email, username, name, password_hash, auth_token, created_at, timezone) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'America/Chicago'))")
      .bind(email, username, username, passwordHash, token, nowStored(), timezone).run();
  }
  user = await userByEmail(db, email);
  return c.json(authResponse(user!));
});

authRoutes.post("/signin", async (c) => {
  const body = await readBody(c);
  const identifier = norm(body.identifier);
  const password = typeof body.password === "string" ? body.password : null;
  if (!identifier || !password || !password.trim()) {
    return c.json({ message: "Username/email and password are required" }, 400);
  }
  const db = c.env.DB;
  const user = identifier.includes("@") ? await userByEmail(db, identifier) : await userByUsername(db, identifier);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ message: "Invalid username/email or password" }, 401);
  }
  const token = issueToken(); // a new sign-in replaces the previous session, as in the Java backend
  await db.prepare("UPDATE users SET auth_token = ? WHERE id = ?").bind(token, user.id).run();
  return c.json(authResponse({ ...user, auth_token: token }));
});

// ---- password reset by e-mail ---------------------------------------------------------------------

const NO_EMAIL = "Password reset by email is not set up on this deployment yet.";
const INVALID_CODE = "Invalid or expired verification code";

authRoutes.post("/password-reset/request", async (c) => {
  const email = norm((await readBody(c)).email);
  if (!email) return c.json({ message: "Email is required" }, 400);
  const devLog = c.env.PASSWORD_RESET_DEV_LOG === "true";
  if (!isEmailConfigured(c.env) && !devLog) return c.json({ message: NO_EMAIL }, 501);

  // The answer is the same whether or not the address has an account, so this cannot be used to find out.
  const reply = { message: "Verification code sent if the email exists." + (devLog ? " In local development, check the backend log." : "") };
  const db = c.env.DB;
  const user = await userByEmail(db, email);
  if (!user) return c.json(reply);

  const now = Date.now();
  const existing = await db.prepare("SELECT created_at FROM password_resets WHERE email = ?").bind(email).first<{ created_at: string }>();
  if (existing && now - storedToMs(existing.created_at) < RESET_COOLDOWN_MS) return c.json(reply); // one code a minute

  const code = generateCode();
  await db.prepare("INSERT OR REPLACE INTO password_resets (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)")
    .bind(email, await hashCode(email, code), msToStored(now + RESET_TTL_MS), msToStored(now)).run();
  try {
    if (isEmailConfigured(c.env)) await sendEmail(c.env, { to: email, ...resetCodeEmail(code, RESET_TTL_MS / 60_000) });
    else console.log(`[DEV] Password reset code for ${email}: ${code}`);
  } catch (error) {
    console.error("Sending the reset e-mail failed:", error instanceof Error ? error.message : error);
  }
  return c.json(reply);
});

authRoutes.post("/password-reset/confirm", async (c) => {
  const body = await readBody(c);
  const email = norm(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !code || password.length < 6) {
    return c.json({ message: "Email, verification code, and a password of at least 6 characters are required" }, 400);
  }
  const db = c.env.DB;
  const row = await db.prepare("SELECT code_hash, expires_at, attempts FROM password_resets WHERE email = ?").bind(email).first<{ code_hash: string; expires_at: string; attempts: number }>();
  if (!row) return c.json({ message: INVALID_CODE }, 400);
  if (storedToMs(row.expires_at) < Date.now() || row.attempts >= RESET_MAX_ATTEMPTS) {
    await db.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run();
    return c.json({ message: INVALID_CODE }, 400);
  }
  if (!sameHash(row.code_hash, await hashCode(email, code))) {
    await db.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    return c.json({ message: INVALID_CODE }, 400);
  }
  const user = await userByEmail(db, email);
  if (!user) return c.json({ message: INVALID_CODE }, 400);

  const passwordHash = await hashPassword(password, iterationsFromEnv(c.env.PBKDF2_ITERATIONS));
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, auth_token = NULL WHERE id = ?").bind(passwordHash, user.id), // signs the account out everywhere
    db.prepare("DELETE FROM password_resets WHERE email = ?").bind(email),
  ]);
  return c.json({ message: "Password reset. Please sign in again." });
});

// ---- sign in with Google -----------------------------------------------------------------------------

const GOOGLE_NOT_CONFIGURED = "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.";

const isHttps = (c: { req: { url: string } }) => new URL(c.req.url).protocol === "https:";

/** The authorization URL for a fresh sign-in attempt, plus the cookie that ties it to this browser. */
async function beginGoogleSignIn(c: { env: Env; req: { url: string } }) {
  const config = googleConfig(c.env, new URL(c.req.url).origin);
  if (!config) return null;
  const nonce = newNonce();
  return { url: authorizationUrl(config, await signState(config.stateSecret, nonce)), cookie: nonceCookie(nonce, isHttps(c)) };
}

authRoutes.post("/oauth/:provider/start", async (c) => {
  const provider = c.req.param("provider").trim().toLowerCase();
  if (!/^(google|apple|sso)$/.test(provider)) return c.json({ message: "Unsupported identity provider" }, 400);
  if (provider !== "google") return c.json({ message: `${provider} sign-in is not configured on this deployment yet.` }, 501);
  const start = await beginGoogleSignIn(c);
  if (!start) return c.json({ message: GOOGLE_NOT_CONFIGURED }, 501);
  c.header("Set-Cookie", start.cookie);
  return c.json({ authorizationUrl: start.url });
});

authRoutes.get("/oauth/google/start", async (c) => {
  const start = await beginGoogleSignIn(c);
  if (!start) return c.text(GOOGLE_NOT_CONFIGURED, 501);
  return new Response(null, { status: 302, headers: { Location: start.url, "Set-Cookie": start.cookie } });
});

authRoutes.get("/oauth/google/callback", async (c) => {
  const origin = c.env.FRONTEND_ORIGIN?.trim() || new URL(c.req.url).origin;
  const clear = clearNonceCookie(isHttps(c));
  // The frontend picks the result up from the URL fragment on load; a fragment is never sent to any server.
  const back = (fragment: string) => new Response(null, { status: 302, headers: { Location: `${origin}/index.html#${fragment}`, "Set-Cookie": clear } });
  const failure = (message: string) => back(`oauthError=${encodeURIComponent(message)}`);

  const config = googleConfig(c.env, new URL(c.req.url).origin);
  if (!config) return failure(GOOGLE_NOT_CONFIGURED);
  const error = c.req.query("error");
  if (error) return failure(`Google sign-in failed: ${error}`);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const nonce = state ? await verifyState(config.stateSecret, state) : null;
  if (!code || !nonce || readCookie(c.req.header("Cookie"), NONCE_COOKIE) !== nonce) {
    return failure("Google sign-in state is invalid or expired.");
  }

  try {
    const profile = await fetchGoogleProfile(config, code);
    const db = c.env.DB;
    const token = issueToken();
    const existing = await userByEmail(db, profile.email);
    if (existing) {
      await db.prepare("UPDATE users SET name = COALESCE(?, name), auth_token = ?, username = COALESCE(username, ?) WHERE id = ?")
        .bind(profile.name, token, existing.username ? null : await freeUsername(db, profile.email), existing.id).run();
    } else {
      await db.prepare("INSERT INTO users (email, username, name, auth_token, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(profile.email, await freeUsername(db, profile.email), profile.name ?? profile.email.split("@")[0], token, nowStored()).run();
    }
    const user = (await userByEmail(db, profile.email))!;
    return back(`oauthUser=${encodeURIComponent(JSON.stringify(authResponse(user)))}`);
  } catch (e) {
    return failure(`Google sign-in failed. ${(e as Error).message}`);
  }
});

/** One query: every username that starts like the wanted one; the first free suffix is picked in memory. */
async function freeUsername(db: D1Database, email: string): Promise<string> {
  const base = (email.slice(0, email.indexOf("@")).replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase()) || "google-user";
  const rows = await db.prepare("SELECT username FROM users WHERE username LIKE ?").bind(`${base}%`).all<{ username: string }>();
  return pickUsername(email, new Set(rows.results.map((r) => r.username)));
}
