import { Hono } from "hono";

import { AuthError, numberOrNull, requireToken, requireUser } from "../auth";
import { resolveBuddyId, stateAfterToggle } from "../buddy";
import { i18nToStore, parseI18n, parsePreferences, taskById, tasksForUser } from "../db";
import type { TaskRow } from "../db";
import type { Env } from "../env";
import { assertTimeZone, localToUtc, nowStored, toDisplayString, toJavaString, utcToLocal } from "../time";

export const taskRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_TZ = "America/Chicago";

/** TaskResponseDTO. */
function toDto(task: TaskRow, timezone: string) {
  const base = { id: task.id, title: task.title, description: task.description, i18n: parseI18n(task.i18n), color: task.color, completed: task.completed === 1 };
  if (!task.due_date) return { ...base, localDueDate: "No Deadline", dueDate: null, endDate: null };
  const local = utcToLocal(task.due_date, timezone);
  // `endDate` is set for an event (dueDate is then its start) and null for a task, which is only a deadline.
  const endDate = task.end_date ? toJavaString(utcToLocal(task.end_date, timezone)) : null;
  return { ...base, localDueDate: toDisplayString(local), dueDate: toJavaString(local), endDate };
}

/** What POST returns: the saved entity (the frontend only checks that the call succeeded). */
const entity = (task: TaskRow) => ({
  id: task.id,
  title: task.title,
  description: task.description,
  i18n: parseI18n(task.i18n),
  dueDate: task.due_date ? toJavaString(task.due_date) : null,
  endDate: task.end_date ? toJavaString(task.end_date) : null,
  completed: task.completed === 1,
  completedAt: task.completed_at ? toJavaString(task.completed_at) : null,
  aiMetadata: null,
  precededBy: null,
  color: task.color,
});

const readBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> => {
  const body = await c.req.json().catch(() => ({}));
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The end of an event as UTC text, or null for a task. An end needs a start, and has to come after it. */
function endToStore(end: string | null, startUtc: string | null, timezone: string): string | null {
  if (!end) return null;
  if (!startUtc) throw new Error("An event needs a start time.");
  const endUtc = localToUtc(end, timezone);
  if (endUtc <= startUtc) throw new Error("The end must be after the start.");
  return endUtc;
}

/** Task owned by the token's user; throws AuthError for someone else's task (a 403), Error if missing. */
async function requireOwnedTask(db: D1Database, id: number, token: string | undefined): Promise<TaskRow> {
  const user = await requireToken(db, token);
  const task = await taskById(db, id);
  if (!task) throw new Error("Task not found");
  if (task.user_id !== user.id) throw new AuthError("Forbidden");
  return task;
}

taskRoutes.get("/", async (c) => {
  const timezone = c.req.query("timezone") || DEFAULT_TZ;
  const userId = numberOrNull(c.req.query("userId"));
  try {
    assertTimeZone(timezone);
    if (userId === null) return c.json([]);
    await requireUser(c.env.DB, userId, c.req.query("authToken"));
    return c.json((await tasksForUser(c.env.DB, userId)).map((t) => toDto(t, timezone)));
  } catch (e) {
    if (e instanceof AuthError) return c.json({ message: e.message }, 401);
    if (e instanceof RangeError) return c.json({ message: "Unknown timezone" }, 400);
    throw e;
  }
});

taskRoutes.post("/", async (c) => {
  try {
    const user = await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"));
    const timezone = c.req.query("timezone") || DEFAULT_TZ;
    const body = await readBody(c);
    const due = str(body.dueDate);
    const dueDate = due ? localToUtc(due, timezone) : null;
    const endDate = endToStore(str(body.endDate), dueDate, timezone);
    const result = await c.env.DB.prepare("INSERT INTO tasks (title, description, due_date, end_date, color, i18n, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(str(body.title), str(body.description), dueDate, endDate, str(body.color), i18nToStore(body.i18n), user.id).run();
    return c.json(entity((await taskById(c.env.DB, result.meta.last_row_id))!));
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 401);
    return c.text(`Create failed: ${(e as Error).message}`, 400);
  }
});

taskRoutes.patch("/:id/color", async (c) => {
  const color = str((await readBody(c)).color);
  if (!color || !color.trim()) return c.text("Color cannot be empty.", 400);
  try {
    const task = await requireOwnedTask(c.env.DB, Number(c.req.param("id")), c.req.query("authToken"));
    await c.env.DB.prepare("UPDATE tasks SET color = ? WHERE id = ?").bind(color, task.id).run();
    return c.text("Color updated.");
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 403);
    return c.text(`Update failed: ${(e as Error).message}`, 400);
  }
});

taskRoutes.patch("/:id/complete", async (c) => {
  try {
    const db = c.env.DB;
    const task = await requireOwnedTask(db, Number(c.req.param("id")), c.req.query("authToken"));
    const completed = (await readBody(c)).completed === true;
    const completedAt = completed ? nowStored() : null;
    await db.prepare("UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ?").bind(completed ? 1 : 0, completedAt, task.id).run();

    const owner = (await db.prepare("SELECT preferences FROM users WHERE id = ?").bind(task.user_id).first<{ preferences: string | null }>())!;
    const done = (await tasksForUser(db, task.user_id))
      .filter((t) => t.completed === 1 && t.completed_at)
      .map((t) => ({ dueDate: t.due_date, completedAt: t.completed_at }));
    const buddyState = stateAfterToggle(
      resolveBuddyId(parsePreferences(owner.preferences)),
      done,
      { dueDate: task.due_date, completedAt, completed },
    );
    return c.json({ message: "Task completion updated.", buddyState });
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 403);
    return c.text(`Update failed: ${(e as Error).message}`, 400);
  }
});

taskRoutes.delete("/:id", async (c) => {
  try {
    const task = await requireOwnedTask(c.env.DB, Number(c.req.param("id")), c.req.query("authToken"));
    await c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(task.id).run();
    return c.text("Task deleted.");
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 403);
    return c.text(`Delete failed: ${(e as Error).message}`, 500);
  }
});

taskRoutes.put("/:id", async (c) => {
  try {
    const task = await requireOwnedTask(c.env.DB, Number(c.req.param("id")), c.req.query("authToken"));
    const body = await readBody(c);
    const timezone = c.req.query("timezone") || DEFAULT_TZ;
    const due = str(body.dueDate);
    const dueDate = due ? localToUtc(due, timezone) : task.due_date;
    // Without "endDate" in the body the event keeps its length; with it, an empty value turns the event back into a task.
    const endDate = "endDate" in body ? endToStore(str(body.endDate), dueDate, timezone) : task.end_date ?? null;
    const title = str(body.title);
    const description = str(body.description);
    // The translations belong to the text they were made from. A client that changes the text sends fresh ones
    // (or none, when translating failed); if it sends nothing and the text did change, the old ones are stale.
    const i18n = "i18n" in body ? i18nToStore(body.i18n) : title === task.title && description === task.description ? task.i18n ?? null : null;
    await c.env.DB.prepare("UPDATE tasks SET title = ?, description = ?, due_date = ?, end_date = ?, i18n = ? WHERE id = ?")
      .bind(title, description, dueDate, endDate, i18n, task.id).run();
    return c.text("Task updated.");
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 403);
    return c.text(`Update failed: ${(e as Error).message}`, 400);
  }
});
