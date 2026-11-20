import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { annotate, buildSummary, matchTask } from "../src/importService";
import { cleanDocumentText, cleanTitle, documentPrompt, itemsFromModelReply, parseDateToUtc, parseDocumentText, parseStructuredFile } from "../src/importers";
import type { ImportItem } from "../src/importers";
import { chatCompletion, extractJsonArray } from "../src/llm";

const CHI = "America/Chicago";
const env = (extra: Partial<Env> = {}): Env => ({ DB: {} as D1Database, ...extra });

const task = (over: Partial<ImportItem> = {}): ImportItem => ({
  id: "t1", kind: "task", source: "Canvas", title: "HW 1", description: null, dueDate: "2026-11-20T06:00:00", start: null, end: null,
  location: null, confidence: 0.9, notes: null, importKey: null, past: false, status: "new", existingDueDate: null, ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("parseDateToUtc", () => {
  it("handles zoned, zone-less and date-only values like the Java parser", () => {
    expect(parseDateToUtc("2026-11-24T05:59:00Z")).toBe("2026-11-24T05:59:00");
    expect(parseDateToUtc("2026-11-24T00:59:00+01:00")).toBe("2026-11-23T23:59:00");
    expect(parseDateToUtc("2026-11-24T10:00:00")).toBe("2026-11-24T10:00:00"); // taken as UTC
    expect(parseDateToUtc("2026-11-24")).toBe("2026-11-24T00:00:00");
    for (const bad of [null, undefined, "", "null", "next friday", 42]) expect(parseDateToUtc(bad)).toBeNull();
  });
});

describe("structured files", () => {
  it("reads a Canvas export with stable keys, skipping blank names", async () => {
    const canvas = JSON.stringify([
      { name: "Homework", assignments: [
        { id: 1, name: "HW 1", due_at: "2026-11-20T06:00:00Z", html_url: "https://canvas.example/c/1/a/1" },
        { id: 2, name: "  ", due_at: null },
        { id: 3, name: "No url", due_at: null },
      ] },
      { assignments: [{ name: "Ungrouped" }] },
    ]);
    const parsed = await parseStructuredFile(env(), "canvas.json", canvas, CHI);
    expect(parsed).toMatchObject({ parser: "canvas-json", aiFallbackUsed: false });
    expect(parsed.items.map((i) => [i.id, i.title, i.importKey])).toEqual([
      ["canvas-1", "HW 1", "canvas:https://canvas.example/c/1/a/1"],
      ["canvas-2", "No url", "canvas-id:3"],
      ["canvas-3", "Ungrouped", null],
    ]);
    expect(parsed.items[0]).toMatchObject({ dueDate: "2026-11-20T06:00:00", description: "From Canvas Group: Homework\nURL: https://canvas.example/c/1/a/1", confidence: 0.98 });
    expect(parsed.items[2].description).toBe("From Canvas Group: Canvas\nURL: ");
  });

  it("reads Coursera items with an estimated time", async () => {
    const coursera = JSON.stringify({ linked: { "onDemandCourseMaterialItems.v2": [{ id: "abc", name: "Week 1 Quiz", slug: "week-1-quiz", timeCommitment: 5_400_000 }, { slug: "x" }] } });
    const parsed = await parseStructuredFile(env(), "coursera.json", coursera, CHI);
    expect(parsed.parser).toBe("coursera-json");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ importKey: "coursera:abc", dueDate: null });
    expect(parsed.items[0].description).toBe("Source: Coursera\nEstimated time: 1.50 hours\nSlug: week-1-quiz");
  });

  it("turns a timetable into course sessions", async () => {
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:CS 225\r\nLOCATION:Siebel\r\nDTSTART;TZID=America/Chicago:20261116T100000\r\nDTEND;TZID=America/Chicago:20261116T105000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261120\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const parsed = await parseStructuredFile(env(), "term.ics", ics, CHI);
    expect(parsed).toMatchObject({ parser: "ics-calendar", aiFallbackUsed: false });
    expect(parsed.items.map((i) => [i.id, i.kind, i.start])).toEqual([["ics-1", "course", "2026-11-16T16:00:00"], ["ics-2", "course", "2026-11-18T16:00:00"]]);
  });

  it("reads generic JSON with start/end as events and due as tasks, in the user's time zone, ignoring the file's own title", async () => {
    const file = JSON.stringify({
      name: "Fall Break Plan", timezone: "America/Chicago",
      items: [
        { kind: "event", title: "Hiking trip", description: "Easy loop", location: "Maple Ridge", start: "2026-11-23T08:30:00", end: "2026-11-23T12:30:00" },
        { kind: "task", title: "Pack", due: "2026-11-21T08:00:00" },
        { title: "Zoned", start: "2026-11-24T10:00:00Z", end: "2026-11-24T11:00:00Z" },
        { title: "Backwards", start: "2026-11-24T10:00:00", end: "2026-11-24T09:00:00" },
      ],
    });
    const parsed = await parseStructuredFile(env(), "plan.json", file, CHI);
    expect(parsed.items.map((i) => [i.title, i.dueDate, i.end])).toEqual([
      ["Hiking trip", "2026-11-23T14:30:00", "2026-11-23T18:30:00"], // 08:30 Chicago = 14:30 UTC
      ["Pack", "2026-11-21T14:00:00", null],
      ["Zoned", "2026-11-24T10:00:00", "2026-11-24T11:00:00"],     // an explicit Z is kept as it is
      ["Backwards", "2026-11-24T16:00:00", null],                   // an end before the start: only a deadline
    ]);
    expect(parsed.items[0].description).toBe("Easy loop\nLocation: Maple Ridge");
    expect(parsed.items.some((i) => i.title === "Fall Break Plan")).toBe(false);
  });

  it("falls back to a heuristic for unknown JSON when no AI is configured", async () => {
    const parsed = await parseStructuredFile(env(), "x.json", JSON.stringify({ stuff: { list: [{ title: "Read ch. 3", due: "2026-12-01T12:00:00Z" }, { name: "No date" }] } }), CHI);
    expect(parsed).toMatchObject({ parser: "ai-cleanup-json", aiFallbackUsed: true });
    expect(parsed.items.map((i) => [i.title, i.dueDate, i.confidence])).toEqual([["Read ch. 3", "2026-12-01T12:00:00", 0.68], ["No date", null, 0.54]]);
  });

  it("explains a file that is neither a calendar nor JSON", async () => {
    await expect(parseStructuredFile(env(), "notes.txt", "just some words", CHI)).rejects.toThrow(/not a calendar/);
  });
});

describe("matching against what the user already has", () => {
  const existing = [
    { id: 1, title: "HW 1", due_date: "2026-11-20T06:00:00", import_key: "canvas:u1" },
    { id: 2, title: "Manual task", due_date: null, import_key: null },
    { id: 3, title: "HW 2", due_date: "2026-11-21T06:00:00", import_key: "canvas:other" },
  ];

  it("same key and deadline is a duplicate; a moved deadline is an update", () => {
    expect(matchTask(task({ importKey: "canvas:u1" }), existing).status).toBe("duplicate");
    expect(matchTask(task({ importKey: "canvas:u1", dueDate: "2026-11-27T06:00:00" }), existing)).toMatchObject({ status: "update", existing: { id: 1 } });
  });

  it("never blanks out a stored deadline because the file had none", () => {
    expect(matchTask(task({ importKey: "canvas:u1", dueDate: null }), existing).status).toBe("duplicate");
  });

  it("matches keyless items by title and deadline, including both being empty", () => {
    expect(matchTask(task({ title: "Manual task", dueDate: null }), existing).status).toBe("duplicate");
    expect(matchTask(task({ title: "Manual task", dueDate: "2026-12-01T00:00:00" }), existing).status).toBe("new");
  });

  it("keeps same-named items from different upstream sources apart", () => {
    expect(matchTask(task({ title: "HW 2", dueDate: "2026-11-21T06:00:00", importKey: "canvas:mine" }), existing).status).toBe("new");
    // An item with no key of its own (e.g. read from a document) cannot be told apart by source, so the
    // title + deadline match counts as a duplicate even when the stored task has a key (as in Java).
    expect(matchTask(task({ title: "HW 2", dueDate: "2026-11-21T06:00:00", importKey: null }), existing).status).toBe("duplicate");
  });

  it("annotates past items, existing courses and the old deadline of an update", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const items = [
      task({ id: "a", dueDate: "2026-11-01T00:00:00" }),
      task({ id: "b", importKey: "canvas:u1", dueDate: "2026-11-27T06:00:00" }),
      { ...task({ id: "c", kind: "course", title: "CS 225" }), dueDate: null, start: "2026-11-16T16:00:00", end: "2026-11-16T16:50:00" },
      { ...task({ id: "d", kind: "course", title: "CS 225" }), dueDate: null, start: "2026-11-18T16:00:00", end: "2026-11-18T16:50:00" },
    ] as ImportItem[];
    const courses = [{ id: 9, title: "CS 225", start_time: "2026-11-16T16:00:00", end_time: "2026-11-16T16:50:00", location: null, user_id: 1 }];
    annotate(items, existing.map((t) => ({ ...t, description: null, completed: 0, completed_at: null, ai_metadata: null, preceded_by_id: null, user_id: 1, color: null })), courses, now);
    expect(items.map((i) => [i.id, i.past, i.status, i.existingDueDate])).toEqual([
      ["a", true, "new", null], ["b", false, "update", "2026-11-20T06:00:00"], ["c", false, "duplicate", null], ["d", false, "new", null],
    ]);
  });

  it("summarises like the Java backend", () => {
    expect(buildSummary({ parser: "canvas-json", aiFallbackUsed: false, items: [task(), task()] })).toBe("Detected 2 tasks and 0 course sessions with canvas-json.");
    expect(buildSummary({ parser: "ai-document", aiFallbackUsed: true, warning: "Long.", items: [] })).toContain("AI cleanup suggested; review carefully. Long.");
  });
});

describe("documents read by the AI", () => {
  const reply = `Here you go:\n[
    {"kind":"task","title":"Midterm exam","dueDate":"2026-11-20T15:00","confidence":0.95,"evidence":"Midterm: Friday Nov 20, 3pm"},
    {"kind":"task","title":"Project proposal","dueDate":"2026-11-25","confidence":0.8},
    {"kind":"task","title":"Final paper","confidence":0.3},
    {"kind":"course","title":"CS 225 lecture","start":"2026-11-16T10:00","end":"2026-11-16T10:50","location":"Siebel 1404"},
    {"kind":"course","title":"No start"},
    {"kind":"course","title":"Backwards","start":"2026-11-16T11:00","end":"2026-11-16T10:00"},
    {"kind":"task","title":"","dueDate":"2026-11-20T15:00"},
    {"kind":"task","title":"Impossible","dueDate":"2026-13-45T25:00"}
  ]\nHope that helps.`;

  it("builds items from the model's reply, in the user's time zone", () => {
    const items = itemsFromModelReply(reply, "syllabus.pdf", CHI);
    expect(items.map((i) => [i.kind, i.title, i.dueDate ?? i.start])).toEqual([
      ["task", "Midterm exam", "2026-11-20T21:00:00"],      // 15:00 Chicago = 21:00 UTC
      ["task", "Project proposal", "2026-11-26T05:59:00"],   // a bare date -> 23:59 local
      ["task", "Final paper", null],                         // an important deadline without a date is kept
      ["course", "CS 225 lecture", "2026-11-16T16:00:00"],
      ["task", "Impossible", null],                          // the impossible date is dropped, the item is not
    ]);
    expect(items[0]).toMatchObject({ source: "PDF", confidence: 0.95, notes: 'From the document: "Midterm: Friday Nov 20, 3pm"' });
    expect(items[3]).toMatchObject({ end: "2026-11-16T16:50:00", location: "Siebel 1404" });
    expect(items[1].notes).toContain("Review before confirming");
  });

  it("makes an event of an exam or meeting that has a start and an end, and a task of one without a usable end", () => {
    const items = itemsFromModelReply(JSON.stringify([
      { kind: "event", title: "Midterm", start: "2026-11-20T19:00", end: "2026-11-20T21:00", location: "Room 1" },
      { kind: "event", title: "Interview", dueDate: "2026-11-21T10:00", end: "2026-11-21T10:45" },
      { kind: "event", title: "No end", start: "2026-11-22T09:00" },
      { kind: "event", title: "Backwards", start: "2026-11-22T09:00", end: "2026-11-22T08:00" },
    ]), "x.pdf", CHI);
    expect(items.map((i) => [i.kind, i.title, i.dueDate, i.end])).toEqual([
      ["task", "Midterm", "2026-11-21T01:00:00", "2026-11-21T03:00:00"],
      ["task", "Interview", "2026-11-21T16:00:00", "2026-11-21T16:45:00"],
      ["task", "No end", "2026-11-22T15:00:00", null],
      ["task", "Backwards", "2026-11-22T15:00:00", null],
    ]);
    expect(items[0].location).toBe("Room 1");
  });

  it("tells the model about events", () => {
    expect(documentPrompt(CHI, { y: 2026, mo: 11, d: 14 })).toContain("kind=event");
  });

  it("takes a task's time from `start` when the model put it there instead of `dueDate`", () => {
    const items = itemsFromModelReply('[{"kind":"task","title":"Midterm 2","start":"2026-11-20T19:00","end":"2026-11-20T21:00"},{"kind":"task","title":"Quiz","dueDate":"nonsense","start":"2026-11-21T09:00"}]', "x.pdf", CHI);
    expect(items.map((i) => i.dueDate)).toEqual(["2026-11-21T01:00:00", "2026-11-21T15:00:00"]);
  });

  it("caps the number of items and reads a reply that is not JSON as nothing", () => {
    const many = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ kind: "task", title: `T${i}`, dueDate: "2026-12-01T10:00" })));
    expect(itemsFromModelReply(many, "x.docx", CHI)).toHaveLength(40);
    expect(itemsFromModelReply("I could not find anything.", "x.docx", CHI)).toEqual([]);
  });

  it("drops a schedule table's week label from the start of a title", () => {
    expect(cleanTitle("Week 12 HW 8")).toBe("HW 8");
    expect(cleanTitle("Wk. 3: Midterm Exam 2")).toBe("Midterm Exam 2");
    expect(cleanTitle("第5周 作业3")).toBe("作业3");
    expect(cleanTitle("Week 12")).toBe("Week 12"); // nothing left: keep it rather than an empty title
    expect(cleanTitle("Weekly quiz 4")).toBe("Weekly quiz 4");
    expect(cleanTitle("Homework 12 due Week 3")).toBe("Homework 12 due Week 3");
  });

  it("cleans extracted text", () => {
    expect(cleanDocumentText("a\u0000b  \t c\n\n\n\n\nd ")).toBe("ab c\n\nd");
  });

  it("tells the model today's date, the zone and the calendar", () => {
    const prompt = documentPrompt(CHI, { y: 2026, mo: 11, d: 14 });
    expect(prompt).toContain("Today is 2026-11-14");
    expect(prompt).toContain("America/Chicago");
    expect(prompt).toContain("2026-11-14 Sat (today); 2026-11-15 Sun (tomorrow)");
  });

  it("calls the model with the document and returns the parsed preview", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.messages[1].content).toContain('Document "syllabus.pdf"');
      expect(body.messages[1].content).toContain("Midterm");
      return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const parsed = await parseDocumentText(env({ LLM_API_KEY: "k" }), "syllabus.pdf", "Course syllabus. Midterm: Friday Nov 20, 3pm. Project proposal due Nov 25.", CHI, Date.parse("2026-11-14T18:00:00Z"));
    expect(parsed).toMatchObject({ parser: "ai-document", aiFallbackUsed: true });
    expect(parsed.items).toHaveLength(5);
    expect(parsed.warning).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("warns when the document is longer than what is read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      expect(String(JSON.parse(String(init.body)).messages[1].content).length).toBeLessThan(15_000);
      return new Response(JSON.stringify({ choices: [{ message: { content: "[]" } }] }));
    }));
    const parsed = await parseDocumentText(env({ LLM_API_KEY: "k" }), "long.txt", "x".repeat(50_000), CHI);
    expect(parsed.warning).toMatch(/only the first 14,000 characters/);
  });

  it("rejects a document with no readable text (for example a scanned PDF)", async () => {
    await expect(parseDocumentText(env({ LLM_API_KEY: "k" }), "scan.pdf", "  \n ", CHI)).rejects.toThrow(/scanned PDF/);
  });
});

describe("llm", () => {
  it("retries once with the fallback model when the first is rate limited", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      models.push(model);
      return model === "big"
        ? new Response("{}", { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }));
    expect(await chatCompletion(env({ LLM_API_KEY: "k", LLM_MODEL: "big", LLM_FALLBACK_MODEL: "small" }), [{ role: "user", content: "hi" }])).toBe("ok");
    expect(models).toEqual(["big", "small"]);
  });

  it("does not retry other errors, and refuses to run without a key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(chatCompletion(env({ LLM_API_KEY: "k" }), [{ role: "user", content: "hi" }])).rejects.toThrow(/HTTP 500/);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(chatCompletion(env(), [{ role: "user", content: "hi" }])).rejects.toThrow(/not configured/);
  });

  it("extracts the JSON array from a chatty reply", () => {
    expect(extractJsonArray('Sure!\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(extractJsonArray("no array here")).toBeNull();
    expect(extractJsonArray("[not json]")).toBeNull();
  });
});
