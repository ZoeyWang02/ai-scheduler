/* Password reset codes: 6 digits, valid for 10 minutes, at most 5 wrong guesses, one new code a minute.
 * Only a hash of the code is stored. */

export const RESET_TTL_MS = 10 * 60 * 1000;
export const RESET_COOLDOWN_MS = 60 * 1000;
export const RESET_MAX_ATTEMPTS = 5;

/** A uniformly random 6-digit code (rejection sampling, so no digit is favoured). */
export function generateCode(): string {
  const limit = 4_294_000_000; // the largest multiple of 1,000,000 that fits in 32 bits
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return String(buffer[0] % 1_000_000).padStart(6, "0");
}

export async function hashCode(email: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email}:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
