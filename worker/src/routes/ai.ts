import { Hono } from "hono";

import { buildChatMessages, chatReply, translateText } from "../ai";
import { analyzeLifestyle } from "../analytics";
import { AuthError, numberOrNull, requireToken, requireUser } from "../auth";
import { tasksForUser } from "../db";
import type { Env } from "../env";
import { isLlmConfigured } from "../llm";
import { dailyLimit, quotaMessage, takeAiAllowance } from "../quota";

export const aiRoutes = new Hono<{ Bindings: Env }>();
export const analyticsRoutes = new Hono<{ Bindings: Env }>();

/** `configured`: the built-in AI has a key. People can also bring their own (the browser then talks to the provider itself). */
aiRoutes.get("/status", (c) => c.json({ configured: isLlmConfigured(c.env), dailyLimit: dailyLimit(c.env) }));

const SIGN_IN_FOR_BUILT_IN = "Sign in to use the built-in assistant, or add your own API key in Settings.";

/** For people who bring their own API key: the prompt for a chat message (their tasks, rhythm profile, busy times,
 *  the calendar and the conversation so far), which the browser then sends to the provider itself. Nothing is sent
 *  to any AI from here, so no allowance is used and no server key is needed. A guest gets a prompt without data. */
aiRoutes.post("/context", async (c) => {
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) return c.text("Request must include a non-empty 'message' field.", 400);
  const rawUserId = body.userId === undefined || body.userId === null || body.userId === "" ? null : Number(body.userId);
  if (rawUserId !== null && !Number.isFinite(rawUserId)) return c.text("userId must be a number.", 400);
  try {
    if (rawUserId !== null) await requireUser(c.env.DB, rawUserId, typeof body.authToken === "string" ? body.authToken : undefined);
    const messages = await buildChatMessages(c.env, {
      message,
      userId: rawUserId,
      timezone: typeof body.timezone === "string" && body.timezone ? body.timezone : "America/Chicago",
      lang: typeof body.lang === "string" && body.lang ? body.lang : "en",
      history: body.history,
    });
    return c.json({ messages });
  } catch (e) {
    if (e instanceof AuthError) return c.text(`Authentication failed: ${e.message}`, 401);
    if (e instanceof RangeError) return c.text("Unknown timezone", 400);
    return c.text(`Could not prepare the request: ${(e as Error).message}`, 500);
  }
});

/** Free chat: the reply is plain text, with a JSON plan appended when the assistant proposes tasks. */
aiRoutes.post("/chat", async (c) => {
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) return c.text("Request must include a non-empty 'message' field.", 400);

  const rawUserId = body.userId === undefined || body.userId === null || body.userId === "" ? null : Number(body.userId);
  if (rawUserId !== null && !Number.isFinite(rawUserId)) return c.text("userId must be a number.", 400);
  // The built-in AI spends the site's shared key, so it is for signed-in users only and counted per user.
  if (rawUserId === null) return c.text(SIGN_IN_FOR_BUILT_IN, 401);
  try {
    await requireUser(c.env.DB, rawUserId, typeof body.authToken === "string" ? body.authToken : undefined);
    if (isLlmConfigured(c.env)) {
      const allowance = await takeAiAllowance(c.env, rawUserId);
      if (!allowance.ok) return c.text(quotaMessage(allowance.limit), 429);
    }
    const reply = await chatReply(c.env, {
      message,
      userId: rawUserId,
      timezone: typeof body.timezone === "string" && body.timezone ? body.timezone : "America/Chicago",
      lang: typeof body.lang === "string" && body.lang ? body.lang : "en",
      history: body.history,
    });
    return c.text(reply);
  } catch (e) {
    if (e instanceof AuthError) return c.text(`Authentication failed: ${e.message}`, 401);
    if (e instanceof RangeError) return c.text("AI service error: Unknown timezone", 400);
    return c.text(`AI service error: ${(e as Error).message}`, 500);
  }
});

/** Translate one text (a signed-in user's explicit click, never automatic). */
aiRoutes.post("/translate", async (c) => {
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return c.text("Request must include a non-empty 'text' field.", 400);
  try {
    const user = await requireToken(c.env.DB, typeof body.authToken === "string" ? body.authToken : undefined);
    if (isLlmConfigured(c.env)) {
      const allowance = await takeAiAllowance(c.env, user.id);
      if (!allowance.ok) return c.text(quotaMessage(allowance.limit), 429);
    }
    return c.json({ translated: await translateText(c.env, text, typeof body.targetLang === "string" ? body.targetLang : "en") });
  } catch (e) {
    if (e instanceof AuthError) return c.text(`Authentication failed: ${e.message}`, 401);
    return c.text(`Translation failed: ${(e as Error).message}`, 500);
  }
});

/** Study-rhythm analysis of the user's task deadlines. A guest (no userId) gets an empty analysis. */
analyticsRoutes.get("/lifestyle", async (c) => {
  const userId = numberOrNull(c.req.query("userId"));
  try {
    if (userId !== null) await requireUser(c.env.DB, userId, c.req.query("authToken"));
    const tasks = userId === null ? [] : await tasksForUser(c.env.DB, userId);
    return c.json(analyzeLifestyle(tasks, c.req.query("timezone") || "America/Chicago", c.req.query("period"), c.req.query("lang") ?? "en"));
  } catch (e) {
    if (e instanceof AuthError) return c.json({ message: e.message }, 401);
    if (e instanceof RangeError) return c.json({ message: "Unknown timezone" }, 400);
    throw e;
  }
});
