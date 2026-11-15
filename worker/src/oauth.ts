/* Sign in with Google. The Java backend remembered each OAuth `state` in memory; a Worker has no memory
 * between requests, so the state is a signed, expiring token (HMAC-SHA256), and a random nonce inside it
 * is also set as a cookie so the callback can only be completed by the browser that started the flow
 * (otherwise a link crafted by someone else could sign a victim in to the attacker's account). */

import type { Env } from "./env";

const encoder = new TextEncoder();

export const STATE_TTL_MS = 10 * 60 * 1000;
export const NONCE_COOKIE = "plantriz_oauth";

const toB64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (text: string) => {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

const hmacKey = (secret: string, usage: "sign" | "verify") => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export const newNonce = () => toB64Url(crypto.getRandomValues(new Uint8Array(18)));

/** "<payload>.<signature>": payload = {n: nonce, exp: expiry in ms}. */
export async function signState(secret: string, nonce: string, nowMs = Date.now()): Promise<string> {
  const payload = toB64Url(encoder.encode(JSON.stringify({ n: nonce, exp: nowMs + STATE_TTL_MS })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toB64Url(new Uint8Array(signature))}`;
}

/** The nonce inside a state this server signed and that has not expired; null for anything else. */
export async function verifyState(secret: string, state: string, nowMs = Date.now()): Promise<string | null> {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64Url(signature), encoder.encode(payload));
    if (!valid) return null;
    const { n, exp } = JSON.parse(new TextDecoder().decode(fromB64Url(payload))) as { n?: unknown; exp?: unknown };
    return typeof n === "string" && typeof exp === "number" && exp > nowMs ? n : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export const nonceCookie = (nonce: string, secure: boolean) =>
  `${NONCE_COOKIE}=${nonce}; Max-Age=${STATE_TTL_MS / 1000}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export const clearNonceCookie = (secure: boolean) =>
  `${NONCE_COOKIE}=; Max-Age=0; Path=/api/auth/oauth; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  stateSecret: string;
}

/** null when Google sign-in is not set up (client id and secret both needed). */
export function googleConfig(env: Env, origin: string): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_REDIRECT_URI?.trim() || `${origin}/api/auth/oauth/google/callback`,
    authUrl: env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    userinfoUrl: env.GOOGLE_USERINFO_URL || "https://www.googleapis.com/oauth2/v3/userinfo",
    stateSecret: env.OAUTH_STATE_SECRET?.trim() || clientSecret,
  };
}

export function authorizationUrl(config: GoogleConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${config.authUrl}?${q}`;
}

export interface GoogleProfile { email: string; name: string | null }

/** Trades the authorization code for the user's verified e-mail and name. Throws a short message on failure. */
export async function fetchGoogleProfile(config: GoogleConfig, code: string): Promise<GoogleProfile> {
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new Error(`Token exchange failed with status ${tokenResponse.status}`);
  const accessToken = ((await tokenResponse.json()) as { access_token?: string }).access_token;
  if (!accessToken) throw new Error("Token response did not include an access token");

  const profileResponse = await fetch(config.userinfoUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!profileResponse.ok) throw new Error(`Userinfo request failed with status ${profileResponse.status}`);
  const profile = (await profileResponse.json()) as { email?: string; name?: string; email_verified?: boolean | string };
  const email = profile.email?.trim().toLowerCase();
  if (!email) throw new Error("Google did not return an email address.");
  // An address Google has not verified could belong to someone else; signing in by e-mail would hand over their account.
  if (profile.email_verified === false || profile.email_verified === "false") throw new Error("Your Google email address is not verified.");
  return { email, name: profile.name?.trim() || null };
}

/** A free username from the e-mail's local part: "jane.doe", then "jane.doe1", "jane.doe2" ... given the taken ones. */
export function pickUsername(email: string, taken: ReadonlySet<string>): string {
  const base = (email.slice(0, email.indexOf("@")).replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase()) || "google-user";
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) if (!taken.has(base + i)) return base + i;
}
