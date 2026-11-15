/* One place that talks to the LLM (OpenAI-compatible chat completions, Groq by default).
 * Mirrors the Java AiService: same URL/model defaults, and on HTTP 429 the call is retried once
 * with the fallback model, because free-tier limits are counted per model. */

import type { Env } from "./env";

export const DEFAULT_LLM_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_LLM_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_LLM_FALLBACK_MODEL = "openai/gpt-oss-20b";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export class LlmError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

export const isLlmConfigured = (env: Env) => Boolean(env.LLM_API_KEY && env.LLM_API_KEY.trim());

async function post(env: Env, model: string, messages: ChatMessage[], temperature: number): Promise<string> {
  const response = await fetch(env.LLM_API_URL || DEFAULT_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LLM_API_KEY}` },
    body: JSON.stringify({ model, temperature, messages }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!response.ok) throw new LlmError(`LLM request failed with HTTP ${response.status}`, response.status);
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmError("LLM response had no content");
  return content;
}

export async function chatCompletion(env: Env, messages: ChatMessage[], temperature = 0.3): Promise<string> {
  if (!isLlmConfigured(env)) throw new LlmError("The AI service is not configured. Set LLM_API_KEY.");
  const model = env.LLM_MODEL || DEFAULT_LLM_MODEL;
  try {
    return await post(env, model, messages, temperature);
  } catch (error) {
    const fallback = env.LLM_FALLBACK_MODEL ?? DEFAULT_LLM_FALLBACK_MODEL;
    if (error instanceof LlmError && error.status === 429 && fallback && fallback !== model) {
      return await post(env, fallback, messages, temperature);
    }
    throw error;
  }
}

/** The first '[' to the last ']' of a model reply, parsed; null when there is no JSON array. */
export function extractJsonArray(text: string | null | undefined): unknown[] | null {
  if (!text) return null;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The next `days` days with weekday names, today and tomorrow marked: models are poor at working out
 *  which date "Friday" is, so prompts spell the calendar out (same idea as AiService.buildCalendarContext). */
export function calendarContext(todayLocal: { y: number; mo: number; d: number }, days = 14): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(todayLocal.y, todayLocal.mo - 1, todayLocal.d + i));
    const iso = date.toISOString().slice(0, 10);
    out.push(`${iso} ${names[date.getUTCDay()]}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`);
  }
  return out.join("; ");
}
