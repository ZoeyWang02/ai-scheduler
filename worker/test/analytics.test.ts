import { describe, expect, it } from "vitest";

import { analyzeLifestyle, estimateHours, normalizePeriod } from "../src/analytics";
import { makeUtcToLocal, utcToLocal } from "../src/time";

const CHI = "America/Chicago";
// "now" = Saturday 2026-11-14 12:00 in Chicago (18:00 UTC); the week window starts Saturday 2026-11-07 00:00 Chicago.
const NOW = Date.parse("2026-11-14T18:00:00Z");

/** A task due at a Chicago wall-clock time (winter: UTC-6). */
const due = (day: string, hhmm: string, extra: Partial<{ description: string | null; completed: number }> = {}) => {
  const [h, m] = hhmm.split(":").map(Number);
  const utc = new Date(Date.parse(`${day}T00:00:00Z`) + (h + 6) * 3_600_000 + m * 60_000).toISOString().slice(0, 19);
  return { due_date: utc, description: extra.description ?? null, completed: extra.completed ?? 0 };
};

describe("makeUtcToLocal", () => {
  it("agrees with the exact conversion, including on daylight-saving change days", () => {
    const toLocal = makeUtcToLocal(CHI);
    for (const stamp of ["2026-03-08T07:59:00", "2026-03-08T08:01:00", "2026-03-08T12:00:00", "2026-07-04T03:00:00", "2026-11-01T06:30:00", "2026-11-01T07:30:00", "2026-12-31T23:59:59"]) {
      const exact = utcToLocal(stamp, CHI);
      const fast = toLocal(stamp);
      expect(`${String(fast.y).padStart(4, "0")}-${String(fast.mo).padStart(2, "0")}-${String(fast.d).padStart(2, "0")}T${String(fast.h).padStart(2, "0")}:${String(fast.mi).padStart(2, "0")}:${String(fast.s).padStart(2, "0")}`, stamp).toBe(exact);
    }
  });
});

describe("estimateHours", () => {
  it("reads the estimate from the description, in the forms the app writes", () => {
    expect(estimateHours("Review notes\nFrom chat: \"x\"\nEstimated: 2 h")).toBe(2);
    expect(estimateHours("Source: Coursera\nEstimated time: 1.50 hours\nSlug: a")).toBe(1.5);
    expect(estimateHours("复习\n预计耗时 3 小时")).toBe(3);
    expect(estimateHours("预计时长：0.5")).toBe(0.5);
    expect(estimateHours("no estimate here")).toBe(1);
    expect(estimateHours(null)).toBe(1);
  });
});

describe("analyzeLifestyle", () => {
  it("normalises the period like the Java service", () => {
    expect([normalizePeriod("DAY"), normalizePeriod("month"), normalizePeriod("week"), normalizePeriod("year"), normalizePeriod(null)]).toEqual(["day", "month", "week", "week", "week"]);
  });

  it("buckets deadlines by the user's local hour and adds up the hours", () => {
    const tasks = [
      due("2026-11-16", "09:00", { description: "Estimated: 2 h" }), // morning
      due("2026-11-16", "10:30"),                                    // morning
      due("2026-11-17", "14:00", { completed: 1 }),                  // afternoon
      due("2026-11-17", "21:00", { description: "预计耗时 1.5" }),    // evening
      due("2026-11-18", "23:30"),                                    // late night
    ];
    const r = analyzeLifestyle(tasks, CHI, "week", "en", NOW);
    expect(r.totalTasks).toBe(5);
    expect(r.completedTasks).toBe(1);
    expect(r.timeBuckets).toEqual([
      { label: "Morning 5-12", count: 2, percentage: 40 },
      { label: "Afternoon 12-17", count: 1, percentage: 20 },
      { label: "Evening 17-23", count: 1, percentage: 20 },
      { label: "Late Night 23-5", count: 1, percentage: 20 },
    ]);
    expect(r.hourlyStudy).toHaveLength(24);
    expect(r.hourlyStudy[9]).toEqual({ hour: 9, hours: 2 });
    expect(r.hourlyStudy[21]).toEqual({ hour: 21, hours: 1.5 });
    expect(r.peakWindow).toBe("Morning 5-12");
    expect(r.rhythmLabel).toBe("Morning Bird");
    expect(r.focusStyle).toBe("Steady Rhythm");
  });

  it("uses only tasks from the start of the period (local midnight)", () => {
    const tasks = [due("2026-11-06", "23:59"), due("2026-11-07", "00:00"), due("2026-11-14", "08:00")];
    expect(analyzeLifestyle(tasks, CHI, "week", "en", NOW).totalTasks).toBe(2);   // Nov 7 00:00 is the first moment
    expect(analyzeLifestyle(tasks, CHI, "day", "en", NOW).totalTasks).toBe(1);    // today only
    expect(analyzeLifestyle(tasks, CHI, "month", "en", NOW).totalTasks).toBe(3);
  });

  it("ignores tasks without a deadline", () => {
    expect(analyzeLifestyle([{ due_date: null, description: null, completed: 0 }], CHI, "week", "en", NOW).totalTasks).toBe(0);
  });

  it("describes an empty profile, in English and Chinese", () => {
    const en = analyzeLifestyle([], CHI, "week", "en", NOW);
    expect(en).toMatchObject({ totalTasks: 0, peakWindow: "No Data", rhythmLabel: "Waiting for data", focusStyle: "Waiting for data" });
    expect(en.recommendation).toMatch(/Not enough historical data/);
    const zh = analyzeLifestyle([], CHI, "week", "zh", NOW);
    expect(zh).toMatchObject({ peakWindow: "暂无数据", rhythmLabel: "等待数据" });
    expect(zh.timeBuckets.map((b) => b.label)).toEqual(["早晨 5-12", "下午 12-17", "晚上 17-23", "深夜 23-5"]);
    expect(zh.timeBuckets.every((b) => b.percentage === 0)).toBe(true);
  });

  it("calls a day with 8 or more deadlines fragmented focus and suggests short chunks", () => {
    const many = Array.from({ length: 8 }, (_, i) => due("2026-11-16", `${9 + (i % 3)}:00`));
    const r = analyzeLifestyle(many, CHI, "week", "en", NOW);
    expect(r.focusStyle).toBe("Fragmented Focus");
    expect(r.recommendation).toMatch(/25-40 min chunks/);
    // for a month, the count is divided by 4 first
    expect(analyzeLifestyle(many, CHI, "month", "en", NOW).focusStyle).toBe("Steady Rhythm");
  });

  it("calls evening and night peaks deep block focus, and gives the deep-block advice in Chinese too", () => {
    const evening = [due("2026-11-16", "20:00"), due("2026-11-17", "21:00")];
    expect(analyzeLifestyle(evening, CHI, "week", "en", NOW)).toMatchObject({ rhythmLabel: "Night Owl", focusStyle: "Deep Block Focus" });
    const zh = analyzeLifestyle(evening, CHI, "week", "zh", NOW);
    expect(zh).toMatchObject({ rhythmLabel: "夜间高能型", focusStyle: "长时间深度专注" });
    expect(zh.recommendation).toMatch(/90 分钟深度学习块/); // the Java version never matched this label and fell through to the default advice
  });

  it("breaks a tie in favour of the earlier bucket, like the Java loop", () => {
    const r = analyzeLifestyle([due("2026-11-16", "08:00"), due("2026-11-16", "15:00")], CHI, "week", "en", NOW);
    expect(r.peakWindow).toBe("Morning 5-12");
  });

  it("uses the user's zone: the same instant is a different bucket elsewhere", () => {
    const task = [{ due_date: "2026-11-16T16:00:00", description: null, completed: 0 }]; // 10:00 Chicago, 00:00 Shanghai next day
    expect(analyzeLifestyle(task, CHI, "week", "en", NOW).peakWindow).toBe("Morning 5-12");
    expect(analyzeLifestyle(task, "Asia/Shanghai", "week", "en", NOW).peakWindow).toBe("Late Night 23-5");
  });

  it("rejects an unknown time zone", () => {
    expect(() => analyzeLifestyle([], "Mars/Olympus", "week", "en", NOW)).toThrow(RangeError);
  });
});
