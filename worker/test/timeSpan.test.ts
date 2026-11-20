import { describe, expect, it } from "vitest";

import { clockText, durationText, spanMinutes, spanText, timeLine } from "../../frontend/js/timeSpan.js";

describe("spanMinutes / spanText", () => {
  it("measures a span from the local date-times the API sends", () => {
    expect(spanMinutes("2027-03-01T10:00:00", "2027-03-01T11:30:00")).toBe(90);
    expect(spanMinutes("2027-03-01 10:00", "2027-03-02T10:00:00")).toBe(24 * 60);
  });

  it("gives null for a missing, equal or backwards end", () => {
    expect(spanMinutes("2027-03-01T10:00:00", null)).toBeNull();
    expect(spanMinutes("2027-03-01T10:00:00", "2027-03-01T10:00:00")).toBeNull();
    expect(spanMinutes("2027-03-01T10:00:00", "2027-03-01T09:00:00")).toBeNull();
    expect(spanMinutes("nonsense", "2027-03-01T09:00:00")).toBeNull();
    expect(spanText("2027-03-01T10:00:00", "2027-03-01T09:00:00")).toBeNull();
  });

  it("writes one day as a time range and several days with both dates", () => {
    expect(spanText("2027-03-01T10:00:00", "2027-03-01T11:30:00")).toBe("2027-03-01 10:00-11:30");
    expect(spanText("2027-03-01T22:00:00", "2027-03-02T01:00:00")).toBe("2027-03-01 22:00 - 2027-03-02 01:00");
  });

  it("is not thrown off by a daylight-saving change, because it never converts zones", () => {
    expect(spanMinutes("2027-03-14T01:00:00", "2027-03-14T04:00:00")).toBe(180);
  });
});

describe("durationText", () => {
  it("uses minutes under an hour, hours with at most one decimal, then days", () => {
    expect(durationText(45, "en")).toBe("45 min");
    expect(durationText(45, "zh")).toBe("45 分钟");
    expect(durationText(90, "en")).toBe("1.5 h");
    expect(durationText(120, "zh")).toBe("2 小时");
    expect(durationText(100, "en")).toBe("1.7 h");
    expect(durationText(24 * 60, "en")).toBe("1 day");
    expect(durationText(26 * 60, "en")).toBe("1 day 2 h");
    expect(durationText(2 * 24 * 60, "zh")).toBe("2 天");
  });
});

describe("timeLine", () => {
  it("shows an event as a span with its length", () => {
    expect(timeLine("2027-03-01T10:00:00", "2027-03-01T11:30:00", "en")).toBe("Time: 2027-03-01 10:00-11:30 (1.5 h)");
    expect(timeLine("2027-03-01T10:00:00", "2027-03-01T11:30:00", "zh")).toBe("时间: 2027-03-01 10:00-11:30 (1.5 小时)");
  });

  it("shows a task as a deadline", () => {
    expect(timeLine("2027-03-01T10:00:00", null, "en")).toBe("Due: 2027-03-01 10:00");
    expect(timeLine("2027-03-01T10:00:00", undefined, "zh")).toBe("截止: 2027-03-01 10:00");
  });

  it("falls back to the start when the end is not after it", () => {
    expect(timeLine("2027-03-01T10:00:00", "2027-03-01T09:00:00", "en")).toBe("Due: 2027-03-01 10:00");
  });
});

describe("clockText", () => {
  it("gives a range for an event, one time for a task, nothing without a time", () => {
    expect(clockText("2027-03-01T10:00:00", "2027-03-01T11:30:00")).toBe("10:00-11:30");
    expect(clockText("2027-03-01 10:00", null)).toBe("10:00");
    expect(clockText("No Deadline", null)).toBe("");
  });
});
