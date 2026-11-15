export interface Env {
  DB: D1Database;
  /** Groq (or any OpenAI-compatible) key; set with `wrangler secret put LLM_API_KEY`. */
  LLM_API_KEY?: string;
  LLM_API_URL?: string;
  LLM_MODEL?: string;
  /** Second model tried when the first is rate limited (limits are per model). */
  LLM_FALLBACK_MODEL?: string;
  PBKDF2_ITERATIONS?: string;
}
