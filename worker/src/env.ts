export interface Env {
  DB: D1Database;
  /** Groq (or any OpenAI-compatible) key; set with `wrangler secret put LLM_API_KEY`. */
  LLM_API_KEY?: string;
  PBKDF2_ITERATIONS?: string;
}
