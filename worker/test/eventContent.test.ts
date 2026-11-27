import { describe, expect, it } from "vitest";

import { calendarEventContent, describeEntry } from "../../frontend/js/eventContent.js";

const dict = { tagDue: "Due", tagEvent: "Event", tagClass: "Class" };

describe("describeEntry", () => {
  it("gives a task its deadline, and says when it is done", () => {
    expect(describeEntry({ kind: "task", localStart: "2026-11-26T17:00", localEnd: null }, dict)).toEqual({ kind: "task", tag: "Due", time: "17:00", done: false });
    expect(describeEntry({ kind: "task", localStart: "2026-11-26T17:00", completed: true }, dict).done).toBe(true);
  });

  it("gives an event and a class their time span", () => {
    expect(describeEntry({ kind: "event", localStart: "2026-11-26T13:00", localEnd: "2026-11-26T14:30" }, dict)).toEqual({ kind: "event", tag: "Event", time: "13:00-14:30", done: false });
    expect(describeEntry({ kind: "course", localStart: "2026-11-26T10:00:00", localEnd: "2026-11-26T10:50:00" }, dict)).toMatchObject({ tag: "Class", time: "10:00-10:50" });
  });

  it("treats an unknown kind as a task", () => {
    expect(describeEntry({ localStart: "2026-11-26T09:00" }, dict).kind).toBe("task");
  });
});

describe("calendarEventContent", () => {
  it("leaves the week and day views to the standard drawing", () => {
    for (const type of ["timeGridWeek", "timeGridDay"]) {
      expect(calendarEventContent({ view: { type }, event: { extendedProps: {} } }, dict)).toBe(true);
    }
  });
});
