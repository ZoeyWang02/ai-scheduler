import { describe, expect, it, vi } from "vitest";

import {
  AssistantRequestError, chatComplete, clearConfig, describeAiError, hasOwnKey, LlmClientError, loadConfig, maskKey, PROVIDERS, saveConfig, STORAGE_KEY, testConnection, translateMessages, translateWithOwnKey,
} from "../../frontend/js/llmClient.js";

/** A stand-in for sessionStorage / localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    data,
  };
}
const storages = () => ({ session: memoryStorage(), local: memoryStorage() });

const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const status = (code: number, body = "") => new Response(body, { status: code });
const config = (extra: Record<string, unknown> = {}): any => ({ provider: "groq", apiKey: "gsk_test_key_123456", model: "", ...extra });
const messages = [{ role: "user", content: "hi" }];

describe("stored settings", () => {
  it("keeps the key in sessionStorage unless asked to remember it", () => {
    const s = storages();
    expect(hasOwnKey(s)).toBe(false);
    expect(saveConfig(config(), false, s)).toBe(true);
    expect(s.session.data.has(STORAGE_KEY)).toBe(true);
    expect(s.local.data.has(STORAGE_KEY)).toBe(false);
    expect(loadConfig(s)).toEqual({ provider: "groq", apiKey: "gsk_test_key_123456", model: "", remember: false });
    expect(hasOwnKey(s)).toBe(true);
  });

  it("'remember' uses localStorage and removes the session copy (and back)", () => {
    const s = storages();
    saveConfig(config(), false, s);
    saveConfig(config(), true, s);
    expect(s.local.data.has(STORAGE_KEY)).toBe(true);
    expect(s.session.data.has(STORAGE_KEY)).toBe(false);
    expect(loadConfig(s)!.remember).toBe(true);
    saveConfig(config(), false, s);
    expect(s.local.data.has(STORAGE_KEY)).toBe(false);
    expect(loadConfig(s)!.remember).toBe(false);
  });

  it("clearConfig removes it from both places", () => {
    const s = storages();
    saveConfig(config(), true, s);
    s.session.setItem(STORAGE_KEY, s.local.getItem(STORAGE_KEY)!);
    clearConfig(s);
    expect(hasOwnKey(s)).toBe(false);
    expect(s.session.data.size + s.local.data.size).toBe(0);
  });

  it("ignores broken or empty stored data, and an unknown provider falls back to the default", () => {
    expect(loadConfig({ session: memoryStorage({ [STORAGE_KEY]: "{not json" }), local: null })).toBeNull();
    expect(loadConfig({ session: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ provider: "groq", apiKey: "  " }) }), local: null })).toBeNull();
    const weird = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ provider: "evil.example.com", apiKey: "k-1234567890123", model: 5 }) });
    expect(loadConfig({ session: weird, local: null })).toEqual({ provider: "groq", apiKey: "k-1234567890123", model: "", remember: false });
  });

  it("copes with storage that is missing or throws", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadConfig({ session: throwing, local: null })).toBeNull();
    expect(saveConfig(config(), false, { session: throwing, local: null })).toBe(false);
    expect(saveConfig(config(), false, { session: null, local: null })).toBe(false);
    expect(() => clearConfig({ session: throwing, local: null })).not.toThrow();
  });

  it("masks a key for display", () => {
    expect(maskKey("gsk_abcdefghijklmnop1234")).toBe("gsk••••••••1234");
    expect(maskKey("short")).toBe("••••••••");
    expect(maskKey("")).toBe("");
    expect(maskKey("gsk_abcdefghijklmnop1234")).not.toContain("abcdefgh");
  });
});

describe("providers", () => {
  it("are all https, on the hosts the Content-Security-Policy allows", () => {
    const headers = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../frontend/_headers"), "utf8");
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      const origin = new URL(provider.url).origin;
      expect(provider.url.startsWith("https://"), id).toBe(true);
      expect(headers, id).toContain(origin);
      expect(provider.model, id).toBeTruthy();
    }
  });
});

describe("chatComplete", () => {
  it("posts an OpenAI-style request to the provider's URL with the key as a bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply("hello"));
    expect(await chatComplete(messages, { config: config(), temperature: 0.3, fetchImpl })).toBe("hello");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(PROVIDERS.groq.url);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer gsk_test_key_123456");
    expect(JSON.parse(init.body)).toEqual({ model: PROVIDERS.groq.model, temperature: 0.3, messages });
  });

  it("never sends the key anywhere but the provider's own URL, even if the stored provider is tampered with", async () => {
    const fetchImpl = vi.fn();
    await expect(chatComplete(messages, { config: config({ provider: "https://evil.example.com" }), fetchImpl })).rejects.toMatchObject({ kind: "config" });
    await expect(chatComplete(messages, { config: config({ provider: "__proto__" }), fetchImpl })).rejects.toMatchObject({ kind: "config" });
    await expect(chatComplete(messages, { config: config({ apiKey: "" }), fetchImpl })).rejects.toMatchObject({ kind: "config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the model the user typed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply("ok"));
    await chatComplete(messages, { config: config({ model: "my-model" }), fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("my-model");
  });

  it("retries once without temperature when the model only accepts its default", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(status(400, '{"error":{"message":"Unsupported value: temperature does not support 0.3 with this model."}}'))
      .mockResolvedValueOnce(reply("fine"));
    expect(await chatComplete(messages, { config: config({ provider: "openai" }), temperature: 0.3, fetchImpl })).toBe("fine");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).not.toHaveProperty("temperature");
  });

  it("tries the provider's fallback model once when rate limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(reply("from fallback"));
    expect(await chatComplete(messages, { config: config(), fetchImpl })).toBe("from fallback");
    expect(fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body).model)).toEqual([PROVIDERS.groq.model, PROVIDERS.groq.fallbackModel]);
  });

  it("does not switch models for a model the user chose, or for a provider without a fallback", async () => {
    const a = vi.fn().mockResolvedValue(status(429));
    await expect(chatComplete(messages, { config: config({ model: "mine" }), fetchImpl: a })).rejects.toMatchObject({ kind: "rate" });
    expect(a).toHaveBeenCalledTimes(1);
    const b = vi.fn().mockResolvedValue(status(429));
    await expect(chatComplete(messages, { config: config({ provider: "deepseek" }), fetchImpl: b })).rejects.toMatchObject({ kind: "rate" });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("maps failures to error kinds", async () => {
    const kind = async (response: Response | Error, cfg = config()) => {
      const fetchImpl = response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response);
      try { await chatComplete(messages, { config: cfg, fetchImpl }); return "none"; } catch (e) { return (e as LlmClientError).kind; }
    };
    expect(await kind(status(401))).toBe("auth");
    expect(await kind(status(403))).toBe("auth");
    expect(await kind(status(404))).toBe("model");
    expect(await kind(status(400, '{"error":"The model `x` does not exist"}'))).toBe("model");
    expect(await kind(status(400, "bad json body"))).toBe("bad");
    expect(await kind(status(500))).toBe("bad");
    expect(await kind(new TypeError("Failed to fetch"))).toBe("network");
    expect(await kind(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe("timeout");
    expect(await kind(new Response("not json", { status: 200 }))).toBe("empty");
    expect(await kind(new Response(JSON.stringify({ choices: [] }), { status: 200 }))).toBe("empty");
  });

  it("an error never contains the key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(401, "invalid key gsk_test_key_123456"));
    const error = await chatComplete(messages, { config: config(), fetchImpl }).catch((e) => e);
    expect(String(error.message)).not.toContain("gsk_test_key");
  });
});

describe("testConnection and translation", () => {
  it("testConnection resolves when the provider answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply("OK"));
    expect(await testConnection(config(), { fetchImpl })).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).temperature).toBe(0);
  });

  it("builds the same translation prompts as the server", () => {
    expect(translateMessages("你好", "en")[0].content).toBe("You are a translator. Translate the user's text into English. Return ONLY the translated text, no quotes, no explanation, no markdown.");
    expect(translateMessages("hello", "zh")[0].content.startsWith("你是一个翻译助手")).toBe(true);
    expect(translateMessages("hello", "zh")[1]).toEqual({ role: "user", content: "hello" });
  });

  it("translateWithOwnKey trims the answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply("  Hello  "));
    expect(await translateWithOwnKey("你好", "en", { config: config(), fetchImpl })).toBe("Hello");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).temperature).toBe(0.2);
  });
});

describe("describeAiError", () => {
  const dict = {
    aiErrAuth: "auth", aiErrRate: "rate", aiErrModel: "model", aiErrNetwork: "network", aiErrTimeout: "timeout", aiErrEmpty: "empty", aiErrNoKey: "nokey",
    aiErrOther: "other {status}", aiNeedKeyOrSignIn: "sign in", aiQuotaReached: "quota {n}", aiConnectFail: "connect fail",
  };

  it("explains every provider failure", () => {
    for (const kind of ["auth", "rate", "model", "network", "timeout", "empty"]) {
      expect(describeAiError(new LlmClientError(kind), dict)).toBe(kind);
    }
    expect(describeAiError(new LlmClientError("config"), dict)).toBe("nokey");
    expect(describeAiError(new LlmClientError("bad", 502), dict)).toBe("other 502");
  });

  it("explains the built-in assistant's refusals", () => {
    expect(describeAiError(new AssistantRequestError(401), dict)).toBe("sign in");
    expect(describeAiError(new AssistantRequestError(429), dict, { dailyLimit: 40 })).toBe("quota 40");
    expect(describeAiError(new AssistantRequestError(500), dict)).toBe("connect fail");
    expect(describeAiError(new Error("x"), dict, { fallback: "custom" })).toBe("custom");
  });
});
