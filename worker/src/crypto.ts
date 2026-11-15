/* Password hashing and session tokens (WebCrypto, available in Workers and Node).
 *
 * The stored hash format is the Java backend's: "pbkdf2$<iterations>$<base64 salt>$<base64 hash>",
 * PBKDF2-HMAC-SHA256, 256-bit. Verification reads the iteration count from the stored value, so a
 * hash made with any count still verifies after the default is changed. */

const encoder = new TextEncoder();

// Measured on a laptop with OpenSSL: 30k iterations ~ 4 ms, 50k ~ 7 ms, 210k (the Java backend's value) ~ 28 ms.
// Workers Free allows 10 ms of CPU per request in total, so this is deliberately low; see wrangler.jsonc.
export const DEFAULT_ITERATIONS = 30_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!password || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  try {
    const actual = await pbkdf2(password, fromBase64(parts[2]), iterations);
    return timingSafeEqual(fromBase64(parts[3]), actual);
  } catch {
    return false;
  }
}

/** 32 random bytes, base64url without padding (same shape as the Java tokens). */
export function issueToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function iterationsFromEnv(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n >= 1000 ? n : DEFAULT_ITERATIONS;
}
