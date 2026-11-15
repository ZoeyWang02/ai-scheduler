export interface Env {
  DB: D1Database;

  // --- AI (Groq or any OpenAI-compatible API) -------------------------------------------------
  /** `wrangler secret put LLM_API_KEY` */
  LLM_API_KEY?: string;
  LLM_API_URL?: string;
  LLM_MODEL?: string;
  /** Second model tried when the first is rate limited (limits are per model). */
  LLM_FALLBACK_MODEL?: string;

  // --- Passwords --------------------------------------------------------------------------------
  PBKDF2_ITERATIONS?: string;

  // --- Sign in with Google (all three needed; secrets via `wrangler secret put`) ------------
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Defaults to `<this site>/api/auth/oauth/google/callback`. */
  GOOGLE_REDIRECT_URI?: string;
  /** Signs the OAuth `state`; defaults to GOOGLE_CLIENT_SECRET. */
  OAUTH_STATE_SECRET?: string;
  /** Where to send the browser after sign-in; defaults to the origin the request came to. */
  FRONTEND_ORIGIN?: string;
  // Google endpoints, overridable for tests.
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_USERINFO_URL?: string;

  // --- Password reset by e-mail (Resend; secrets via `wrangler secret put`) --------------------
  RESEND_API_KEY?: string;
  /** e.g. `PlanTriz <noreply@plantriz.com>`, an address on a domain verified with Resend. */
  EMAIL_FROM?: string;
  EMAIL_API_URL?: string;
  /** "true" prints reset codes to the log instead of sending them (local development only). */
  PASSWORD_RESET_DEV_LOG?: string;
}
