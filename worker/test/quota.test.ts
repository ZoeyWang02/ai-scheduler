import { describe, expect, it } from "vitest";

import { DEFAULT_AI_DAILY_LIMIT, dailyLimit, quotaMessage } from "../src/quota";

describe("dailyLimit", () => {
  it("defaults to 40 when unset, empty or not a whole number", () => {
    expect(DEFAULT_AI_DAILY_LIMIT).toBe(40);
    for (const raw of [undefined, "", "  ", "lots", "-5", "2.5", "NaN"]) expect(dailyLimit({ AI_DAILY_LIMIT: raw }), String(raw)).toBe(40);
  });

  it("reads a whole number, and 0 means no limit", () => {
    expect(dailyLimit({ AI_DAILY_LIMIT: "25" })).toBe(25);
    expect(dailyLimit({ AI_DAILY_LIMIT: " 100 " })).toBe(100);
    expect(dailyLimit({ AI_DAILY_LIMIT: "0" })).toBe(0);
  });

  it("tells the user the number and where to go", () => {
    expect(quotaMessage(40)).toMatch(/40 built-in AI requests/);
    expect(quotaMessage(40)).toMatch(/your own API key in Settings/);
  });
});
