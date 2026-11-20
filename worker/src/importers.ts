/* Turning an uploaded file into a preview: Canvas JSON, Coursera JSON, .ics timetables, unknown JSON
 * (AI cleanup, then a heuristic) and plain documents (PDF / DOCX / text, read by the AI).
 * Port of the preview side of UnifiedImportService.java; the document path is new. */

import type { Env } from "./env";
import { parseIcsEvents } from "./ics";
import { calendarContext, chatCompletion, extractJsonArray, isLlmConfigured } from "./llm";
import type { ChatMessage } from "./llm";
import { assertTimeZone, formatStored, localToUtc, msToStored, parseLocalDateTime, storedToMs, utcToLocal } from "./time";

export type ItemKind = "task" | "course";
export type ItemStatus = "new" | "update" | "duplicate";

export interface ImportItem {
  id: string;
  kind: ItemKind;
  source: string;
  title: string;
  description: string | null;
  /** UTC storage text. Tasks use dueDate; course sessions use start/end. A task that also has `end` is an event:
   *  dueDate is its start. */
  dueDate: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
  confidence: number;
  notes: string | null;
  /** Stable id of the upstream item (Canvas URL, ...). Never sent to the browser. */
  importKey: string | null;
  past: boolean;
  status: ItemStatus;
  existingDueDate: string | null;
}

export interface ParsedImport {
  parser: string;
  aiFallbackUsed: boolean;
  items: ImportItem[];
  /** Shown after the summary, e.g. "The document was long, only the first part was read." */
  warning?: string;
}

const item = (id: string, kind: ItemKind, source: string, title: string, extra: Partial<ImportItem> = {}): ImportItem => ({
  id, kind, source, title,
  description: null, dueDate: null, start: null, end: null, location: null,
  confidence: 0.8, notes: null, importKey: null, past: false, status: "new", existingDueDate: null,
  ...extra,
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** ISO date-time (with zone) -> UTC; a zone-less date-time is taken as UTC; a bare date as midnight. */
export function parseDateToUtc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value === "null") return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value) && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : msToStored(ms);
  }
  const local = parseLocalDateTime(value);
  if (local) return formatStored(local);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return day ? formatStored({ y: +day[1], mo: +day[2], d: +day[3], h: 0, mi: 0, s: 0 }) : null;
}

// ---- Canvas / Coursera -------------------------------------------------------------------------

export const isCanvas = (root: unknown): boolean =>
  Array.isArray(root) && root.length > 0 && isObject(root[0]) && "assignments" in root[0];

export const isCoursera = (root: unknown): boolean =>
  isObject(root) && isObject(root.linked) && Array.isArray(root.linked["onDemandCourseMaterialItems.v2"]);

function previewCanvas(root: unknown[]): ParsedImport {
  const items: ImportItem[] = [];
  for (const group of root) {
    if (!isObject(group) || !Array.isArray(group.assignments)) continue;
    const groupName = text(group.name) || "Canvas";
    for (const raw of group.assignments) {
      if (!isObject(raw)) continue;
      const title = text(raw.name);
      if (!title.trim()) continue;
      const url = text(raw.html_url);
      items.push(item(`canvas-${items.length + 1}`, "task", "Canvas", title, {
        dueDate: parseDateToUtc(raw.due_at),
        description: `From Canvas Group: ${groupName}\nURL: ${url}`,
        // The URL embeds the course, so same-named assignments in different courses stay separate.
        importKey: url.trim() ? `canvas:${url}` : raw.id !== undefined && raw.id !== null ? `canvas-id:${text(raw.id)}` : null,
        confidence: 0.98,
        notes: "Canvas parser matched assignments[].",
      }));
    }
  }
  return { parser: "canvas-json", aiFallbackUsed: false, items };
}

function previewCoursera(root: Record<string, unknown>): ParsedImport {
  const raws = (root.linked as Record<string, unknown>)["onDemandCourseMaterialItems.v2"] as unknown[];
  const items: ImportItem[] = [];
  for (const raw of raws) {
    if (!isObject(raw)) continue;
    const title = text(raw.name);
    if (!title.trim()) continue;
    const hours = (Number(raw.timeCommitment) || 0) / 3_600_000;
    const id = text(raw.id);
    const slug = text(raw.slug);
    items.push(item(`coursera-${items.length + 1}`, "task", "Coursera", title, {
      description: `Source: Coursera\nEstimated time: ${hours.toFixed(2)} hours\nSlug: ${slug}`,
      importKey: id.trim() ? `coursera:${id}` : slug.trim() ? `coursera-slug:${slug}` : null,
      confidence: 0.92,
      notes: "Coursera parser matched linked.onDemandCourseMaterialItems.v2.",
    }));
  }
  return { parser: "coursera-json", aiFallbackUsed: false, items };
}

// ---- unknown JSON ------------------------------------------------------------------------------

const TITLE_KEYS = ["title", "name", "summary", "assignment", "task"];

const firstText = (node: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const v = node[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
};

function collectCandidates(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 6 || out.length > 80) return;
  if (Array.isArray(node)) {
    for (const child of node) collectCandidates(child, out, depth + 1);
  } else if (isObject(node)) {
    if (firstText(node, TITLE_KEYS)) out.push(node);
    for (const child of Object.values(node)) collectCandidates(child, out, depth + 1);
  }
}

function heuristicJson(root: unknown): ParsedImport {
  const candidates: Record<string, unknown>[] = [];
  collectCandidates(root, candidates);
  const items: ImportItem[] = [];
  for (const candidate of candidates.slice(0, 40)) {
    const title = firstText(candidate, TITLE_KEYS);
    if (!title) continue;
    const dueDate = parseDateToUtc(firstText(candidate, ["due_at", "dueDate", "due", "deadline", "end_at"]));
    items.push(item(`ai-json-${items.length + 1}`, "task", "AI cleanup", title, {
      dueDate,
      description: "AI cleanup candidate from unknown JSON structure.",
      confidence: dueDate ? 0.68 : 0.54,
      notes: "Unknown JSON: review before confirming. LLM cleanup can be enabled with LLM_API_KEY.",
    }));
  }
  return { parser: "ai-cleanup-json", aiFallbackUsed: true, items };
}

async function aiCleanupJson(env: Env, rawText: string): Promise<ImportItem[]> {
  if (!isLlmConfigured(env)) return [];
  const system = "You normalize unknown academic JSON imports. Return only a JSON array. "
    + 'Each item must be {"kind":"task","title":"...","description":"...","dueDate":"ISO optional","confidence":0.0}. '
    + "Use kind=task only. Do not include markdown.";
  const user = "Extract coursework tasks from this JSON. If uncertain, use lower confidence. JSON:\n" + rawText.slice(0, 12000);
  try {
    const reply = await chatCompletion(env, [{ role: "system", content: system }, { role: "user", content: user }], 0.1);
    const items: ImportItem[] = [];
    for (const raw of extractJsonArray(reply) ?? []) {
      if (!isObject(raw) || !text(raw.title).trim()) continue;
      items.push(item(`ai-json-${items.length + 1}`, "task", "AI cleanup", text(raw.title), {
        dueDate: parseDateToUtc(raw.dueDate),
        description: text(raw.description) || "AI-cleaned item from unknown JSON.",
        confidence: clamp01(Number(raw.confidence), 0.7),
        notes: "AI cleanup normalized this unknown JSON item. Review before confirming.",
      }));
    }
    return items;
  } catch {
    return []; // the heuristic below still gives the user something to review
  }
}

const clamp01 = (n: number, fallback: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);

// ---- entry points ------------------------------------------------------------------------------

const looksLikeIcs = (fileName: string, body: string) =>
  fileName.toLowerCase().endsWith(".ics") || body.includes("BEGIN:VCALENDAR") || body.includes("BEGIN:VEVENT");

/** A .ics, Canvas, Coursera or unknown JSON file. */
export async function parseStructuredFile(env: Env, fileName: string, body: string, timeZone: string): Promise<ParsedImport> {
  assertTimeZone(timeZone);
  if (looksLikeIcs(fileName, body)) {
    const items = parseIcsEvents(body, timeZone).map((e, i) => item(`ics-${i + 1}`, "course", "ICS", e.title, {
      location: e.location, start: e.start, end: e.end, confidence: 0.88,
      notes: "ICS parser matched VEVENT and expanded supported recurrence rules.",
    }));
    return { parser: "ics-calendar", aiFallbackUsed: false, items };
  }
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    throw new Error("This file is not a calendar (.ics) or JSON file. For a PDF, Word or text document, use the document import.");
  }
  if (isCanvas(root)) return previewCanvas(root as unknown[]);
  if (isCoursera(root)) return previewCoursera(root as Record<string, unknown>);
  const aiItems = await aiCleanupJson(env, body);
  return aiItems.length ? { parser: "ai-cleanup-json", aiFallbackUsed: true, items: aiItems } : heuristicJson(root);
}

// ---- documents (PDF / DOCX / text) read by the AI ----------------------------------------------

/** How much document text goes to the model. ~14k characters is ~4k tokens, which fits a free-tier
 *  per-minute token budget together with the reply. */
export const MAX_DOCUMENT_CHARS = 14_000;

export function cleanDocumentText(raw: string): string {
  return raw.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function documentPrompt(timeZone: string, todayLocal: { y: number; mo: number; d: number }): string {
  return [
    "You read academic documents (syllabi, assignment sheets, timetables, emails) and extract schedule items.",
    `Today is ${formatStored({ ...todayLocal, h: 0, mi: 0, s: 0 }).slice(0, 10)} and the user's time zone is ${timeZone}.`,
    `Calendar for the next 14 days (use it to place weekdays): ${calendarContext(todayLocal)}.`,
    "Return ONLY a JSON array, no markdown and no commentary. Each element:",
    '{"kind":"task"|"event"|"course","title":"short title","description":"one sentence","dueDate":"YYYY-MM-DDTHH:MM","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","location":"","confidence":0.0,"evidence":"short quote from the document"}',
    "Rules:",
    "- kind=task: an assignment, project, reading or other deadline to hand something in. Give dueDate. If only a date is known use T23:59.",
    "- kind=event: something that happens once during a stretch of time: an exam, quiz, test, presentation slot, review session, interview or one-off meeting. Give start and end (if the document gives a start and a length, work out the end; put the room in location). An exam whose time of day or length is not given is a task with its date as dueDate instead.",
    "- kind=course: a regularly scheduled meeting with a start and end (lecture, lab, discussion section, office hours). Give start and end.",
    "- Include EVERY dated deadline and exam in the document, however far ahead (months are fine). Only the repeating weekly meetings are limited: list just the ones in the next 14 days.",
    "- Times are 24-hour, in the user's time zone. A date without a year means the next such date from today.",
    "- Titles: short, and name the course when the document does (\"CS 225 Lecture\", \"CS 225 HW 8\"). Leave out week numbers and other table labels. Write every word of a title in the document's language, including words like Lecture, Lab or Office hours.",
    "- Never invent items. Skip anything whose date cannot be determined, except an important deadline: then omit the date and use confidence 0.4 or lower.",
    "- confidence is 0 to 1 (how sure you are about the date). evidence is a quote of at most 100 characters.",
    "- At most 40 items. Use the document's own language for titles.",
  ].join("\n");
}

const localParts = (iso: string): { y: number; mo: number; d: number } => {
  const p = parseLocalDateTime(iso)!;
  return { y: p.y, mo: p.mo, d: p.d };
};

/** The model's local "YYYY-MM-DDTHH:MM" (or a bare date) -> UTC text; null when it is not a date. */
function modelDateToUtc(value: unknown, timeZone: string, dateOnlyTime: string): string | null {
  if (typeof value !== "string") return null;
  let v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += `T${dateOnlyTime}`;
  const p = parseLocalDateTime(v);
  if (!p || p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31 || p.h > 23 || p.mi > 59) return null;
  return localToUtc(formatStored(p), timeZone);
}

/** A schedule table's "Week 12" / "第12周" column often ends up at the start of a title; drop it. */
export function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/^\s*(?:week|wk)\.?\s*\d+\s*[:\-–—.]?\s*/i, "")
    .replace(/^\s*第\s*\d+\s*周\s*[:：\-–—]?\s*/, "")
    .trim();
  return (cleaned || raw.trim()).slice(0, 120);
}

/** Pure: the model's reply -> preview items. Exported for tests. */
export function itemsFromModelReply(reply: string, fileName: string, timeZone: string): ImportItem[] {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toUpperCase();
  const source = ext ?? "Document";
  const items: ImportItem[] = [];
  for (const raw of extractJsonArray(reply) ?? []) {
    if (items.length >= 40) break;
    if (!isObject(raw)) continue;
    const title = cleanTitle(text(raw.title));
    if (!title) continue;
    const evidence = text(raw.evidence).trim().slice(0, 120);
    const common = {
      description: text(raw.description).trim().slice(0, 300) || null,
      location: text(raw.location).trim().slice(0, 120) || null,
      confidence: clamp01(Number(raw.confidence), 0.6),
      notes: evidence ? `From the document: "${evidence}"` : "Read from the document by AI. Review before confirming.",
    };
    if (raw.kind === "course") {
      const start = modelDateToUtc(raw.start, timeZone, "09:00");
      if (!start) continue; // a meeting without a start time cannot go on a calendar
      const end = modelDateToUtc(raw.end, timeZone, "10:00") ?? msToStored(storedToMs(start) + 3_600_000);
      if (storedToMs(end) <= storedToMs(start)) continue;
      items.push(item(`doc-${items.length + 1}`, "course", source, title, { ...common, start, end }));
    } else {
      // An event has a start and an end after it; without a usable end it is only a deadline, kept as a task.
      const eventStart = raw.kind === "event" ? modelDateToUtc(raw.start, timeZone, "09:00") ?? modelDateToUtc(raw.dueDate, timeZone, "09:00") : null;
      const eventEnd = eventStart ? modelDateToUtc(raw.end, timeZone, "10:00") : null;
      if (eventStart && eventEnd && storedToMs(eventEnd) > storedToMs(eventStart)) {
        items.push(item(`doc-${items.length + 1}`, "task", source, title, { ...common, dueDate: eventStart, end: eventEnd }));
        continue;
      }
      // Models sometimes put an exam's time in `start` (it has a start and an end) instead of `dueDate`.
      const dueDate = modelDateToUtc(raw.dueDate, timeZone, "23:59") ?? modelDateToUtc(raw.start, timeZone, "23:59");
      items.push(item(`doc-${items.length + 1}`, "task", source, title, { ...common, dueDate }));
    }
  }
  return items;
}

/** What goes to the model for a document: the two messages, and whether the text had to be cut. Also used by the
 *  bring-your-own-key path, where the browser sends these messages to the provider itself. */
export function documentMessages(fileName: string, rawText: string, timeZone: string, nowMs = Date.now()): { messages: ChatMessage[]; truncated: boolean } {
  assertTimeZone(timeZone);
  const cleaned = cleanDocumentText(rawText);
  if (cleaned.length < 20) throw new Error("No readable text was found in this file. A scanned PDF (an image of text) cannot be read yet.");
  const todayLocal = localParts(utcToLocal(msToStored(nowMs), timeZone));
  return {
    truncated: cleaned.length > MAX_DOCUMENT_CHARS,
    messages: [
      { role: "system", content: documentPrompt(timeZone, todayLocal) },
      { role: "user", content: `Document "${fileName}":\n\n${cleaned.slice(0, MAX_DOCUMENT_CHARS)}` },
    ],
  };
}

/** The model's reply to documentMessages() -> a parsed import. */
export function parsedFromDocumentReply(reply: string, fileName: string, timeZone: string, truncated: boolean): ParsedImport {
  assertTimeZone(timeZone);
  return {
    parser: "ai-document",
    aiFallbackUsed: true,
    items: itemsFromModelReply(reply, fileName, timeZone),
    warning: truncated ? `The document is long, so only the first ${MAX_DOCUMENT_CHARS.toLocaleString("en-US")} characters were read.` : undefined,
  };
}

export async function parseDocumentText(env: Env, fileName: string, rawText: string, timeZone: string, nowMs = Date.now()): Promise<ParsedImport> {
  const { messages, truncated } = documentMessages(fileName, rawText, timeZone, nowMs);
  return parsedFromDocumentReply(await chatCompletion(env, messages, 0.1), fileName, timeZone, truncated);
}
