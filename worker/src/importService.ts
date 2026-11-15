/* Previews and confirming. D1 allows 50 queries per request on the free plan (a batch counts as one),
 * so the user's existing tasks and course sessions are read once and matched in memory, and every
 * write of a confirm goes out in a few batches. */

import { coursesForUser, tasksForUser } from "./db";
import type { CourseRow, TaskRow } from "./db";
import type { ImportItem, ItemStatus, ParsedImport } from "./importers";
import { msToStored, storedToMs, toJavaString } from "./time";

const MAX_ITEMS = 1500; // keeps a stored preview well under D1's 2 MB row limit
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 400;

export interface StoredPreview {
  importId: string;
  fileName: string;
  parser: string;
  aiFallbackUsed: boolean;
  summary: string;
  items: ImportItem[];
}

const nullable = (v: string | null | undefined) => (v === undefined || v === "" ? null : v);

/** What confirming `item` would do to the tasks the user already has (Java matchTask). */
export function matchTask(item: ImportItem, tasks: Pick<TaskRow, "id" | "title" | "due_date" | "import_key">[]): { status: ItemStatus; existing: Pick<TaskRow, "id" | "due_date" | "import_key"> | null } {
  const due = nullable(item.dueDate);
  const key = item.importKey;
  if (key) {
    const byKey = tasks.find((t) => t.import_key === key);
    if (byKey) {
      // Never blank out a stored deadline because the file had none: only a real new date is an update.
      const changed = due !== null && due !== nullable(byKey.due_date);
      return { status: changed ? "update" : "duplicate", existing: byKey };
    }
  }
  for (const candidate of tasks) {
    if (candidate.title !== item.title || nullable(candidate.due_date) !== due) continue;
    // A candidate with a *different* import key is another upstream item that merely shares title and
    // deadline (two courses' "Homework 1"): not a duplicate. Keyless candidates are matched.
    if (key === null || candidate.import_key === null) return { status: "duplicate", existing: candidate };
  }
  return { status: "new", existing: null };
}

const courseKey = (title: string | null, start: string, end: string) => `${title ?? ""}|${start}|${end}`;

/** Marks each item as past / new / update / duplicate so the UI can pre-select sensibly. */
export function annotate(items: ImportItem[], tasks: TaskRow[], courses: CourseRow[], nowMs: number): void {
  const keys = new Set(courses.map((c) => courseKey(c.title, c.start_time, c.end_time)));
  for (const it of items) {
    if (it.kind === "course") {
      it.past = it.end !== null && storedToMs(it.end) < nowMs;
      it.status = it.start && it.end && keys.has(courseKey(it.title, it.start, it.end)) ? "duplicate" : "new";
    } else {
      it.past = it.dueDate !== null && storedToMs(it.dueDate) < nowMs;
      const match = matchTask(it, tasks);
      it.status = match.status;
      it.existingDueDate = match.status === "update" ? nullable(match.existing?.due_date) : null;
    }
  }
}

export function buildSummary(parsed: Pick<ParsedImport, "parser" | "aiFallbackUsed" | "warning" | "items">): string {
  const tasks = parsed.items.filter((i) => i.kind === "task").length;
  const courses = parsed.items.filter((i) => i.kind === "course").length;
  return `Detected ${tasks} tasks and ${courses} course sessions with ${parsed.parser}.`
    + (parsed.aiFallbackUsed ? " AI cleanup suggested; review carefully." : "")
    + (parsed.warning ? ` ${parsed.warning}` : "");
}

/** Annotates, caps and stores a parsed import, and returns the preview to show. */
export async function createPreview(db: D1Database, userId: number, fileName: string, parsed: ParsedImport, nowMs = Date.now()): Promise<StoredPreview> {
  if (parsed.items.length > MAX_ITEMS) {
    parsed = { ...parsed, items: parsed.items.slice(0, MAX_ITEMS), warning: `Only the first ${MAX_ITEMS} items are shown.` };
  }
  const [tasks, courses] = await Promise.all([tasksForUser(db, userId), coursesForUser(db, userId)]);
  annotate(parsed.items, tasks, courses, nowMs);

  const preview: StoredPreview = {
    importId: crypto.randomUUID(),
    fileName,
    parser: parsed.parser,
    aiFallbackUsed: parsed.aiFallbackUsed,
    summary: buildSummary(parsed),
    items: parsed.items,
  };
  await db.batch([
    db.prepare("DELETE FROM import_previews WHERE created_at < ?").bind(msToStored(nowMs - PREVIEW_TTL_MS)),
    db.prepare("INSERT INTO import_previews (id, user_id, created_at, payload) VALUES (?, ?, ?, ?)")
      .bind(preview.importId, userId, msToStored(nowMs), JSON.stringify(preview)),
  ]);
  return preview;
}

/** The JSON the browser receives: server-only fields removed, dates in the Java wire format. */
export function previewForClient(preview: StoredPreview) {
  const date = (v: string | null) => (v ? toJavaString(v) : null);
  return {
    importId: preview.importId,
    fileName: preview.fileName,
    parser: preview.parser,
    aiFallbackUsed: preview.aiFallbackUsed,
    summary: preview.summary,
    items: preview.items.map((i) => ({
      id: i.id, kind: i.kind, source: i.source, title: i.title, description: i.description,
      dueDate: date(i.dueDate), start: date(i.start), end: date(i.end), location: i.location,
      confidence: i.confidence, notes: i.notes, past: i.past, status: i.status, existingDueDate: date(i.existingDueDate),
    })),
  };
}

export interface ConfirmResult {
  tasksCreated: number;
  tasksUpdated: number;
  coursesCreated: number;
  duplicates: number;
  skipped: number;
  tasks: number;
  courses: number;
}

export class ImportExpiredError extends Error {
  constructor() {
    super("Import preview expired. Please upload the file again.");
  }
}

/** Writes the selected items. `itemIds === null` means everything; an empty list writes nothing.
 *  Counts report what actually happened: an item that already exists is a duplicate (or an update when
 *  its deadline moved), never counted as created. */
export async function confirmImport(db: D1Database, userId: number, importId: string, itemIds: string[] | null): Promise<ConfirmResult> {
  const row = await db.prepare("SELECT payload FROM import_previews WHERE id = ? AND user_id = ?").bind(importId, userId).first<{ payload: string }>();
  if (!row) throw new ImportExpiredError();
  const preview = JSON.parse(row.payload) as StoredPreview;
  const selected = itemIds === null ? null : new Set(itemIds);

  const [tasks, courses] = await Promise.all([tasksForUser(db, userId), coursesForUser(db, userId)]);
  const working = tasks.map((t) => ({ ...t }));
  const keys = new Set(courses.map((c) => courseKey(c.title, c.start_time, c.end_time)));

  const writes: D1PreparedStatement[] = [];
  const result: ConfirmResult = { tasksCreated: 0, tasksUpdated: 0, coursesCreated: 0, duplicates: 0, skipped: 0, tasks: 0, courses: 0 };

  for (const it of preview.items) {
    if (selected && !selected.has(it.id)) { result.skipped++; continue; }
    if (it.kind === "task") {
      const match = matchTask(it, working);
      if (match.status === "update" && match.existing) {
        // Only the deadline is synced from upstream; the user's own edits stay.
        writes.push(db.prepare("UPDATE tasks SET due_date = ? WHERE id = ?").bind(it.dueDate, match.existing.id));
        match.existing.due_date = it.dueDate;
        result.tasksUpdated++;
      } else if (match.status === "duplicate" && match.existing) {
        if (it.importKey && !match.existing.import_key) {
          writes.push(db.prepare("UPDATE tasks SET import_key = ? WHERE id = ?").bind(it.importKey, match.existing.id));
          match.existing.import_key = it.importKey;
        }
        result.duplicates++;
      } else {
        writes.push(db.prepare("INSERT INTO tasks (title, description, due_date, import_key, user_id) VALUES (?, ?, ?, ?, ?)")
          .bind(it.title, it.description, it.dueDate, it.importKey, userId));
        working.push({ id: -1, title: it.title, description: it.description, due_date: it.dueDate, completed: 0, completed_at: null, ai_metadata: null, preceded_by_id: null, user_id: userId, color: null, import_key: it.importKey });
        result.tasksCreated++;
      }
    } else if (it.kind === "course") {
      if (!it.start || !it.end) { result.skipped++; continue; }
      // (Java's Set.add returns whether the element was new; JavaScript's returns the set, so check first.)
      const key = courseKey(it.title, it.start, it.end);
      if (keys.has(key)) { result.duplicates++; continue; }
      keys.add(key);
      writes.push(db.prepare("INSERT INTO course_events (title, start_time, end_time, location, user_id) VALUES (?, ?, ?, ?, ?)")
        .bind(it.title, it.start, it.end, it.location, userId));
      result.coursesCreated++;
    } else {
      result.skipped++;
    }
  }

  writes.push(db.prepare("DELETE FROM import_previews WHERE id = ?").bind(importId));
  for (let i = 0; i < writes.length; i += BATCH_SIZE) await db.batch(writes.slice(i, i + BATCH_SIZE));

  result.tasks = result.tasksCreated + result.tasksUpdated; // kept for older clients, like the Java response
  result.courses = result.coursesCreated;
  return result;
}
