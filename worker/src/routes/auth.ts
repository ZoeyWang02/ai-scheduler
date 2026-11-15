import { Hono } from "hono";

import { AuthError, authResponse, numberOrNull, requireUser } from "../auth";
import { hashPassword, issueToken, iterationsFromEnv, verifyPassword } from "../crypto";
import { parsePreferences, userByEmail, userByUsername } from "../db";
import type { UserRow } from "../db";
import type { Env } from "../env";
import { assertTimeZone, nowStored } from "../time";

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

// Password reset needs outgoing email, which this deployment does not have yet. The Java backend only
// printed the code to its log, which a Worker has no equivalent of.
const NO_EMAIL = "Password reset by email is not set up on this deployment yet.";
authRoutes.post("/password-reset/request", (c) => c.json({ message: NO_EMAIL }, 501));
authRoutes.post("/password-reset/confirm", (c) => c.json({ message: NO_EMAIL }, 501));

authRoutes.post("/oauth/:provider/start", (c) => {
  const provider = c.req.param("provider").trim().toLowerCase();
  if (!/^(google|apple|sso)$/.test(provider)) return c.json({ message: "Unsupported identity provider" }, 400);
  return c.json({ message: `${provider} sign-in is not configured on this deployment yet.` }, 501);
});
authRoutes.get("/oauth/google/start", (c) => c.text("Google OAuth is not configured.", 501));
