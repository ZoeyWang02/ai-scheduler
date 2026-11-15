/* Authentication guards (the Java AuthService.requireUser / requireToken). The API identifies the
 * caller with `userId` + `authToken` query parameters, exactly like the existing frontend sends. */

import type { UserRow } from "./db";
import { parsePreferences, userById, userByToken } from "./db";

/** Equivalent of Java's SecurityException; each route decides whether it maps to 401 or 403. */
export class AuthError extends Error {}

export async function requireUser(db: D1Database, userId: number | null, token: string | null | undefined): Promise<UserRow> {
  if (userId === null || Number.isNaN(userId) || !token || !token.trim()) throw new AuthError("Authentication required");
  const user = await userByToken(db, token);
  if (!user) throw new AuthError("Invalid authentication token");
  if (user.id !== userId) throw new AuthError("User token does not match requested user");
  return user;
}

export async function requireToken(db: D1Database, token: string | null | undefined): Promise<UserRow> {
  if (!token || !token.trim()) throw new AuthError("Authentication required");
  const user = await userByToken(db, token);
  if (!user) throw new AuthError("Invalid authentication token");
  return user;
}

export async function requireExistingUser(db: D1Database, userId: number): Promise<UserRow> {
  const user = await userById(db, userId);
  if (!user) throw new Error(`User not found: ${userId}`);
  return user;
}

/** AuthResponseDTO: what sign-in / sign-up return and what the frontend keeps in localStorage. */
export function authResponse(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    token: user.auth_token,
    preferences: parsePreferences(user.preferences),
  };
}

export const numberOrNull = (value: string | undefined): number | null => {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
