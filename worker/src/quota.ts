/* A per-user daily allowance for the built-in AI. Everyone without their own API key shares one provider key
 * (and one free-tier token budget), so a limit keeps a single account from using it all up. */

import type { Env } from "./env";
import { msToStored } from "./time";

export const DEFAULT_AI_DAILY_LIMIT = 40;
const KEEP_DAYS = 7;

/** `AI_DAILY_LIMIT` requests per user per UTC day. "0" turns the limit off; junk falls back to the default. */
export function dailyLimit(env: Pick<Env, "AI_DAILY_LIMIT">): number {
  const raw = env.AI_DAILY_LIMIT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_AI_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_AI_DAILY_LIMIT;
}

export interface Allowance { ok: boolean; used: number; limit: number }

/** Counts one built-in AI request for `userId` and says whether it is still within today's limit. The counter is
 *  incremented first and checked after (one atomic statement), so two requests at once cannot both slip through. */
export async function takeAiAllowance(env: Pick<Env, "DB" | "AI_DAILY_LIMIT">, userId: number, nowMs = Date.now()): Promise<Allowance> {
  const limit = dailyLimit(env);
  if (limit === 0) return { ok: true, used: 0, limit };
  const day = msToStored(nowMs).slice(0, 10);
  const oldest = msToStored(nowMs - KEEP_DAYS * 86_400_000).slice(0, 10);
  const [, upsert] = await env.DB.batch([
    env.DB.prepare("DELETE FROM ai_usage WHERE day < ?").bind(oldest),
    env.DB.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count").bind(userId, day),
  ]);
  const used = (upsert.results[0] as { count: number }).count;
  return { ok: used <= limit, used, limit };
}

export const quotaMessage = (limit: number) =>
  `You have used today's ${limit} built-in AI requests. They reset at 00:00 UTC. Add your own API key in Settings to keep going.`;
