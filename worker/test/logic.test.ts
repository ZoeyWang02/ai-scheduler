import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildBuddyState, resolveBuddyId, stateAfterToggle, xpForTask } from "../src/buddy";
import { hashPassword, issueToken, iterationsFromEnv, verifyPassword } from "../src/crypto";
import { assertTimeZone, localToUtc, parseLocalDateTime, toDisplayString, toJavaString, utcToLocal } from "../src/time";

describe("time", () => {
  it("converts a Chicago wall-clock time to UTC in winter and summer", () => {
    expect(localToUtc("2026-11-16T10:00:00", "America/Chicago")).toBe("2026-11-16T16:00:00");
    expect(localToUtc("2026-07-01T10:00", "America/Chicago")).toBe("2026-07-01T15:00:00");
  });

  it("converts UTC back to another zone, across midnight", () => {
    expect(utcToLocal("2026-11-16T16:00:00", "Asia/Shanghai")).toBe("2026-11-17T00:00:00");
    expect(utcToLocal("2026-11-16T16:00:00", "America/Chicago")).toBe("2026-11-16T10:00:00");
  });

  it("handles the spring-forward change (2026-03-08, Chicago)", () => {
    expect(localToUtc("2026-03-08T01:30:00", "America/Chicago")).toBe("2026-03-08T07:30:00"); // CST
    expect(localToUtc("2026-03-08T03:30:00", "America/Chicago")).toBe("2026-03-08T08:30:00"); // CDT
  });

  it("round-trips local -> UTC -> local", () => {
    for (const zone of ["America/Chicago", "Asia/Shanghai", "Europe/London", "Australia/Sydney"]) {
      expect(utcToLocal(localToUtc("2026-12-25T18:45:00", zone), zone)).toBe("2026-12-25T18:45:00");
    }
  });

  it("accepts what Jackson accepted: optional seconds, fractions, trailing Z", () => {
    expect(parseLocalDateTime("2026-11-16T10:00")).toMatchObject({ h: 10, mi: 0, s: 0 });
    expect(parseLocalDateTime("2026-11-16T10:00:30.123Z")).toMatchObject({ s: 30 });
    expect(parseLocalDateTime("tomorrow")).toBeNull();
  });

  it("formats like Java's LocalDateTime", () => {
    expect(toJavaString("2026-11-16T10:00:00")).toBe("2026-11-16T10:00");
    expect(toJavaString("2026-11-16T10:00:07")).toBe("2026-11-16T10:00:07");
    expect(toDisplayString("2026-11-16T10:00:00")).toBe("2026-11-16 10:00");
  });

  it("rejects an unknown time zone", () => {
    expect(() => assertTimeZone("Mars/Olympus")).toThrow(RangeError);
  });
});

describe("buddy", () => {
  const completedAt = "2026-11-16T12:00:00";

  it("starts as a calm hatchling with nothing completed", () => {
    expect(buildBuddyState("junimo", [])).toMatchObject({
      xp: 0, level: 1, stage: "hatchling", xpToNextStage: 100, mood: "calm", totalTasksCompleted: 0,
    });
  });

  it("gives 10 XP, plus 2 per full day early (capped at 5 days)", () => {
    expect(xpForTask({ completedAt, dueDate: null })).toBe(10);
    expect(xpForTask({ completedAt, dueDate: "2026-11-16T11:00:00" })).toBe(10); // late
    expect(xpForTask({ completedAt, dueDate: "2026-11-19T12:00:00" })).toBe(16); // 3 days early
    expect(xpForTask({ completedAt, dueDate: "2027-02-01T12:00:00" })).toBe(20); // capped
    expect(xpForTask({ completedAt: null, dueDate: "2026-11-19T12:00:00" })).toBe(0);
  });

  it("reports mood from how recently something was completed", () => {
    const done = [{ completedAt, dueDate: null }];
    const at = (iso: string) => Date.parse(iso + "Z");
    expect(buildBuddyState("junimo", done, at("2026-11-16T13:00:00")).mood).toBe("excited");
    expect(buildBuddyState("junimo", done, at("2026-11-17T08:00:00")).mood).toBe("happy");
    expect(buildBuddyState("junimo", done, at("2026-11-20T08:00:00")).mood).toBe("calm");
  });

  it("moves to growing at 100 XP and mature at 300 XP", () => {
    const tasks = (n: number) => Array.from({ length: n }, () => ({ completedAt, dueDate: null }));
    expect(buildBuddyState("junimo", tasks(10)).stage).toBe("growing");
    expect(buildBuddyState("junimo", tasks(30))).toMatchObject({ stage: "mature", xpToNextStage: null });
  });

  it("flags the completion that crosses a level line", () => {
    const toggled = { completedAt, dueDate: null, completed: true };
    const five = Array.from({ length: 5 }, () => ({ completedAt, dueDate: null })); // 50 XP -> level 2
    expect(stateAfterToggle("junimo", five, toggled)).toMatchObject({ level: 2, justLeveledUp: true, justAdvancedStage: false });
    const four = five.slice(1);
    expect(stateAfterToggle("junimo", four, toggled)).toMatchObject({ level: 1, justLeveledUp: false });
  });

  it("does not flag anything when a task is un-completed", () => {
    const toggled = { completedAt: null, dueDate: null, completed: false };
    expect(stateAfterToggle("junimo", [], toggled)).toMatchObject({ justLeveledUp: false, justAdvancedStage: false });
  });

  it("reads the buddy from preferences, defaulting to junimo", () => {
    expect(resolveBuddyId({ studyBuddy: "duck" })).toBe("duck");
    expect(resolveBuddyId({ studyBuddy: " " })).toBe("junimo");
    expect(resolveBuddyId(null)).toBe("junimo");
  });
});

describe("crypto", () => {
  it("hashes and verifies a password", async () => {
    const stored = await hashPassword("correct horse", 2000);
    expect(stored).toMatch(/^pbkdf2\$2000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("salts every hash differently", async () => {
    expect(await hashPassword("same", 1000)).not.toBe(await hashPassword("same", 1000));
  });

  it("verifies a hash in the Java backend's format", async () => {
    const salt = Buffer.from("0123456789abcdef");
    const hash = pbkdf2Sync("secret123", salt, 3000, 32, "sha256");
    const javaStyle = `pbkdf2$3000$${salt.toString("base64")}$${hash.toString("base64")}`;
    expect(await verifyPassword("secret123", javaStyle)).toBe(true);
    expect(await verifyPassword("secret124", javaStyle)).toBe(false);
  });

  it("rejects malformed stored values", async () => {
    for (const bad of [null, "", "plain", "pbkdf2$x$y$z", "pbkdf2$0$AA==$AA=="]) {
      expect(await verifyPassword("secret123", bad)).toBe(false);
    }
  });

  it("issues url-safe 43 character tokens", () => {
    const token = issueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issueToken()).not.toBe(token);
  });

  it("falls back to the default for a bad iteration setting", () => {
    expect(iterationsFromEnv("120000")).toBe(120000);
    expect(iterationsFromEnv("abc")).toBe(30000);
    expect(iterationsFromEnv("5")).toBe(30000);
  });
});
