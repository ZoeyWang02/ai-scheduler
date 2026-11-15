import { describe, expect, it } from "vitest";

import { parseIcsEvents } from "../src/ics";
import { localToUtc, makeZoneConverter } from "../src/time";

const ics = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`), "END:VCALENDAR"].join("\r\n");

const CHI = "America/Chicago";

describe("makeZoneConverter", () => {
  it("agrees with the exact conversion, including around daylight-saving changes", () => {
    const convert = makeZoneConverter(CHI);
    const days = ["2026-01-15", "2026-03-07", "2026-03-08", "2026-03-09", "2026-07-04", "2026-11-01", "2026-11-02", "2026-12-31"];
    for (const day of days) {
      for (const [h, mi] of [[0, 0], [1, 30], [2, 30], [3, 30], [9, 5], [23, 59]]) {
        const [y, mo, d] = day.split("-").map(Number);
        const local = `${day}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00`;
        expect(convert({ y, mo, d, h, mi, s: 0 }), local).toBe(localToUtc(local, CHI));
      }
    }
  });
});

describe("parseIcsEvents", () => {
  it("expands a weekly MWF rule up to a date-only UNTIL", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:CS 225 Data Structures\r\nLOCATION:Siebel 1404\r\nDTSTART;TZID=America/Chicago:20261116T100000\r\nDTEND;TZID=America/Chicago:20261116T105000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261120",
    ), CHI);
    expect(events.map((e) => e.start)).toEqual(["2026-11-16T16:00:00", "2026-11-18T16:00:00", "2026-11-20T16:00:00"]);
    expect(events[0]).toMatchObject({ title: "CS 225 Data Structures", location: "Siebel 1404", end: "2026-11-16T16:50:00" });
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Seminar\r\nDTSTART;TZID=America/Chicago:20260302T100000\r\nDTEND;TZID=America/Chicago:20260302T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2",
    ), CHI);
    expect(events.map((e) => e.start)).toEqual(["2026-03-02T16:00:00", "2026-03-09T15:00:00"]); // CST then CDT
  });

  it("starts on the first matching weekday even when DTSTART is another day", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Tue/Thu class\r\nDTSTART;TZID=America/Chicago:20261116T140000\r\nDTEND;TZID=America/Chicago:20261116T151500\r\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261120",
    ), CHI);
    expect(events.map((e) => e.start)).toEqual(["2026-11-17T20:00:00", "2026-11-19T20:00:00"]);
  });

  it("honours COUNT, INTERVAL and EXDATE (which the Java version ignored)", () => {
    const base = "SUMMARY:Lab\r\nDTSTART;TZID=America/Chicago:20261116T090000\r\nDTEND;TZID=America/Chicago:20261116T100000\r\n";
    expect(parseIcsEvents(ics(base + "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"), CHI)).toHaveLength(3);
    const biweekly = parseIcsEvents(ics(base + "RRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=2;COUNT=3"), CHI);
    expect(biweekly.map((e) => e.start.slice(0, 10))).toEqual(["2026-11-16", "2026-11-30", "2026-12-14"]);
    const skipped = parseIcsEvents(ics(base + "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3\r\nEXDATE;TZID=America/Chicago:20261123T090000"), CHI);
    expect(skipped.map((e) => e.start.slice(0, 10))).toEqual(["2026-11-16", "2026-11-30"]);
  });

  it("stops at 150 sessions however far the rule runs", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Forever\r\nDTSTART;TZID=America/Chicago:20260105T090000\r\nDTEND;TZID=America/Chicago:20260105T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20301231",
    ), CHI);
    expect(events).toHaveLength(150);
  });

  it("without UNTIL or COUNT runs for six months", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Open ended\r\nDTSTART;TZID=America/Chicago:20260105T090000\r\nDTEND;TZID=America/Chicago:20260105T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO",
    ), CHI);
    expect(events.length).toBeGreaterThanOrEqual(26);
    expect(events.length).toBeLessThanOrEqual(27);
  });

  it("reads UTC times, one-off events and all-day events", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Exam\r\nDTSTART:20261120T210000Z\r\nDTEND:20261120T230000Z",
      "SUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261126",
    ), CHI);
    expect(events[0]).toMatchObject({ title: "Exam", start: "2026-11-20T21:00:00", end: "2026-11-20T23:00:00" });
    expect(events[1]).toMatchObject({ title: "Holiday", start: "2026-11-26T06:00:00", end: "2026-11-27T06:00:00" });
  });

  it("uses the user's zone for floating times and for zone names it does not know", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Floating\r\nDTSTART:20261116T100000\r\nDTEND:20261116T110000",
      "SUMMARY:Windows zone\r\nDTSTART;TZID=Central Standard Time:20261116T100000\r\nDTEND;TZID=Central Standard Time:20261116T110000",
    ), CHI);
    expect(events.map((e) => e.start)).toEqual(["2026-11-16T16:00:00", "2026-11-16T16:00:00"]);
  });

  it("unfolds long lines and unescapes text", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Intro to\r\n  Statistics\\, Section A\r\nLOCATION:Room 1\\; Building 2\r\nDTSTART:20261116T100000Z\r\nDTEND:20261116T110000Z",
    ), CHI);
    expect(events[0].title).toBe("Intro to Statistics, Section A");
    expect(events[0].location).toBe("Room 1; Building 2");
  });

  it("skips events it cannot place and keeps going", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:No start\r\nDTEND:20261116T110000Z",
      "SUMMARY:No end\r\nDTSTART:20261116T100000Z",
      "SUMMARY:Fine\r\nDTSTART:20261116T100000Z\r\nDTEND:20261116T110000Z",
    ), CHI);
    expect(events.map((e) => e.title)).toEqual(["Fine"]);
  });

  it("only expands weekly rules, like the Java backend", () => {
    const events = parseIcsEvents(ics(
      "SUMMARY:Daily\r\nDTSTART:20261116T100000Z\r\nDTEND:20261116T110000Z\r\nRRULE:FREQ=DAILY;COUNT=5",
    ), CHI);
    expect(events).toHaveLength(1);
  });

  it("expands a whole timetable quickly (it runs inside a 10 ms CPU budget)", () => {
    const courses = Array.from({ length: 20 }, (_, i) =>
      `SUMMARY:Course ${i}\r\nDTSTART;TZID=America/Chicago:20260105T${String(8 + (i % 8)).padStart(2, "0")}0000\r\nDTEND;TZID=America/Chicago:20260105T${String(8 + (i % 8)).padStart(2, "0")}5000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260501`);
    const started = performance.now();
    const events = parseIcsEvents(ics(...courses), CHI);
    const ms = performance.now() - started;
    expect(events.length).toBeGreaterThan(900);
    expect(ms).toBeLessThan(40); // generous for a loaded CI box; ~5 ms on a laptop
  });
});
