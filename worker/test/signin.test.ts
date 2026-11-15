import { afterEach, describe, expect, it, vi } from "vitest";

import { isEmailConfigured, resetCodeEmail, sendEmail } from "../src/email";
import type { Env } from "../src/env";
import { authorizationUrl, clearNonceCookie, fetchGoogleProfile, googleConfig, newNonce, NONCE_COOKIE, nonceCookie, pickUsername, readCookie, signState, STATE_TTL_MS, verifyState } from "../src/oauth";
import { generateCode, hashCode, sameHash } from "../src/reset";

afterEach(() => vi.unstubAllGlobals());

const env = (extra: Partial<Env> = {}): Env => ({ DB: {} as D1Database, ...extra });
const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("OAuth state", () => {
  it("round-trips: the nonce comes back from a state this server signed", async () => {
    const state = await signState("secret", "nonce-123", NOW);
    expect(await verifyState("secret", state, NOW + 1000)).toBe("nonce-123");
  });

  it("rejects a state that was changed, signed with another secret, expired or malformed", async () => {
    const state = await signState("secret", "nonce-123", NOW);
    const [payload, signature] = state.split(".");
    const forged = `${btoa(JSON.stringify({ n: "other", exp: NOW + 99_999_999 })).replace(/=+$/, "")}.${signature}`;
    expect(await verifyState("secret", forged, NOW)).toBeNull();
    expect(await verifyState("secret", `${payload}.${signature.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(await verifyState("another secret", state, NOW)).toBeNull();
    expect(await verifyState("secret", state, NOW + STATE_TTL_MS + 1)).toBeNull();
    for (const bad of ["", "nodot", "a.b.c", ".", `${payload}.`, "!!!.???"]) expect(await verifyState("secret", bad, NOW), bad).toBeNull();
  });

  it("makes a different nonce every time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe("the nonce cookie", () => {
  it("is HttpOnly, SameSite=Lax, scoped to the OAuth paths, and Secure on https", () => {
    const cookie = nonceCookie("abc", true);
    expect(cookie).toBe(`${NONCE_COOKIE}=abc; Max-Age=600; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Secure`);
    expect(nonceCookie("abc", false)).not.toContain("Secure");
    expect(clearNonceCookie(true)).toContain("Max-Age=0");
  });

  it("is found among other cookies", () => {
    expect(readCookie(`a=1; ${NONCE_COOKIE}=xyz; b=2`, NONCE_COOKIE)).toBe("xyz");
    expect(readCookie("a=1", NONCE_COOKIE)).toBeNull();
    expect(readCookie(undefined, NONCE_COOKIE)).toBeNull();
    expect(readCookie(`${NONCE_COOKIE}=`, NONCE_COOKIE)).toBeNull();
  });
});

describe("googleConfig / authorizationUrl", () => {
  it("is off until both the client id and secret are set", () => {
    expect(googleConfig(env(), "https://x.test")).toBeNull();
    expect(googleConfig(env({ GOOGLE_CLIENT_ID: "id" }), "https://x.test")).toBeNull();
    expect(googleConfig(env({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "   " }), "https://x.test")).toBeNull();
  });

  it("defaults the redirect URI to this site and signs state with the client secret", () => {
    const c = googleConfig(env({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec" }), "https://www.plantriz.com")!;
    expect(c.redirectUri).toBe("https://www.plantriz.com/api/auth/oauth/google/callback");
    expect(c.stateSecret).toBe("sec");
    expect(c.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(googleConfig(env({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REDIRECT_URI: "https://r.test/cb", OAUTH_STATE_SECRET: "s2" }), "https://x")!).toMatchObject({ redirectUri: "https://r.test/cb", stateSecret: "s2" });
  });

  it("builds the Google URL with the same parameters as the Java backend", () => {
    const c = googleConfig(env({ GOOGLE_CLIENT_ID: "my id", GOOGLE_CLIENT_SECRET: "sec" }), "https://www.plantriz.com")!;
    const url = new URL(authorizationUrl(c, "STATE"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "my id", redirect_uri: "https://www.plantriz.com/api/auth/oauth/google/callback", response_type: "code",
      scope: "openid email profile", state: "STATE", prompt: "select_account",
    });
  });
});

describe("fetchGoogleProfile", () => {
  const config = googleConfig(env({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec" }), "https://www.plantriz.com")!;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("exchanges the code and returns the lower-cased e-mail and name", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.includes("token") ? json({ access_token: "AT" }) : json({ email: "Jane.Doe@Example.com", name: " Jane Doe ", email_verified: true });
    }));
    expect(await fetchGoogleProfile(config, "the-code")).toEqual({ email: "jane.doe@example.com", name: "Jane Doe" });
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(Object.fromEntries(form)).toEqual({ code: "the-code", client_id: "id", client_secret: "sec", redirect_uri: config.redirectUri, grant_type: "authorization_code" });
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });

  it("refuses an address Google has not verified (it could belong to someone else)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("token") ? json({ access_token: "AT" }) : json({ email: "x@example.com", email_verified: false }))));
    await expect(fetchGoogleProfile(config, "c")).rejects.toThrow(/not verified/);
  });

  it("fails with a short message when Google refuses the code or gives no e-mail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant" }, 400)));
    await expect(fetchGoogleProfile(config, "c")).rejects.toThrow(/Token exchange failed with status 400/);
    vi.stubGlobal("fetch", vi.fn(async () => json({})));
    await expect(fetchGoogleProfile(config, "c")).rejects.toThrow(/access token/);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("token") ? json({ access_token: "AT" }) : json({ name: "No Mail" }))));
    await expect(fetchGoogleProfile(config, "c")).rejects.toThrow(/did not return an email/);
  });
});

describe("pickUsername", () => {
  it("uses the part before the @, cleaned, and finds the first free number", () => {
    expect(pickUsername("Jane.Doe+news@example.com", new Set())).toBe("jane.doenews");
    expect(pickUsername("jane@example.com", new Set(["jane"]))).toBe("jane1");
    expect(pickUsername("jane@example.com", new Set(["jane", "jane1", "jane2"]))).toBe("jane3");
    expect(pickUsername("+++@example.com", new Set())).toBe("google-user");
  });
});

describe("password reset codes", () => {
  it("makes six digits, zero-padded, with every digit appearing", () => {
    const codes = Array.from({ length: 3000 }, generateCode);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes.join("").split("")).size).toBe(10);
    expect(new Set(codes).size).toBeGreaterThan(2900); // not repeating
  });

  it("hashes a code together with the e-mail, so the same code means nothing for another address", async () => {
    const a = await hashCode("a@example.com", "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await hashCode("a@example.com", "123456"));
    expect(a).not.toBe(await hashCode("b@example.com", "123456"));
    expect(a).not.toBe(await hashCode("a@example.com", "123457"));
    expect(sameHash(a, a)).toBe(true);
    expect(sameHash(a, a.slice(0, -1) + (a.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(sameHash(a, "short")).toBe(false);
  });
});

describe("e-mail", () => {
  it("needs both a key and a sender", () => {
    expect(isEmailConfigured(env())).toBe(false);
    expect(isEmailConfigured(env({ RESEND_API_KEY: "k" }))).toBe(false);
    expect(isEmailConfigured(env({ RESEND_API_KEY: "k", EMAIL_FROM: "PlanTriz <noreply@plantriz.com>" }))).toBe(true);
  });

  it("posts the message to Resend and fails loudly when it is refused", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response("{}", { status: 200 }); }));
    const e = env({ RESEND_API_KEY: "rk", EMAIL_FROM: "PlanTriz <noreply@plantriz.com>" });
    await sendEmail(e, { to: "a@example.com", subject: "S", text: "T" });
    expect(seen[0].url).toBe("https://api.resend.com/emails");
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer rk");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ from: "PlanTriz <noreply@plantriz.com>", to: ["a@example.com"], subject: "S", text: "T" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await expect(sendEmail(e, { to: "a@example.com", subject: "S", text: "T" })).rejects.toThrow(/HTTP 403/);
  });

  it("writes the code and its lifetime in English and Chinese", () => {
    const mail = resetCodeEmail("042917", 10);
    expect(mail.subject).toContain("PlanTriz");
    expect(mail.text).toContain("verification code is 042917");
    expect(mail.text).toContain("valid for 10 minutes");
    expect(mail.text).toContain("验证码是 042917");
  });
});
