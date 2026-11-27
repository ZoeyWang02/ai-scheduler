import { Hono } from "hono";

import { AuthError, numberOrNull, requireToken, requireUser } from "../auth";
import { courseById, coursesForUser } from "../db";
import type { Env } from "../env";
import { assertTimeZone, localToUtc, parseLocalDateTime, toJavaString, utcToLocal } from "../time";

export const courseRoutes = new Hono<{ Bindings: Env }>();

courseRoutes.get("/", async (c) => {
  const userId = numberOrNull(c.req.query("userId"));
  const timezone = c.req.query("timezone") || "America/Chicago";
  if (userId === null || userId < 0) return c.json([]); // guests ask with userId=-1
  try {
    await requireUser(c.env.DB, userId, c.req.query("authToken"));
    const events = await coursesForUser(c.env.DB, userId);
    return c.json(events.map((e) => ({
      id: e.id,
      title: e.title,
      start: toJavaString(utcToLocal(e.start_time, timezone)),
      end: toJavaString(utcToLocal(e.end_time, timezone)),
      location: e.location,
    })));
  } catch (e) {
    if (e instanceof AuthError) return c.json({ message: e.message }, 401);
    if (e instanceof RangeError) return c.json({ message: "Unknown timezone" }, 400);
    throw e;
  }
});

/** Changes one class session: its name, place, start and end (local times in `timezone`). Other weeks of the same
 *  class are separate rows and stay as they are. */
courseRoutes.put("/:id", async (c) => {
  try {
    const user = await requireToken(c.env.DB, c.req.query("authToken"));
    const event = await courseById(c.env.DB, Number(c.req.param("id")));
    if (!event) return c.text("Update failed: Course not found", 404);
    if (event.user_id !== user.id) throw new AuthError("Forbidden");
    const timezone = c.req.query("timezone") || "America/Chicago";
    assertTimeZone(timezone);
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 300) return c.text("A class needs a name of at most 300 characters.", 400);
    const { start, end } = body;
    if (typeof start !== "string" || typeof end !== "string" || !parseLocalDateTime(start) || !parseLocalDateTime(end)) {
      return c.text("A class needs a start and an end time.", 400);
    }
    const startUtc = localToUtc(start, timezone);
    const endUtc = localToUtc(end, timezone);
    if (endUtc <= startUtc) return c.text("The end must be after the start.", 400);
    const location = typeof body.location === "string" ? body.location.trim().slice(0, 200) || null : null;
    await c.env.DB.prepare("UPDATE course_events SET title = ?, start_time = ?, end_time = ?, location = ? WHERE id = ?")
      .bind(title, startUtc, endUtc, location, event.id).run();
    return c.text("Class updated.");
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 403);
    if (e instanceof RangeError) return c.text("Unknown timezone", 400);
    return c.text(`Update failed: ${(e as Error).message}`, 400);
  }
});

courseRoutes.delete("/:id", async (c) => {
  try {
    const user = await requireToken(c.env.DB, c.req.query("authToken"));
    const event = await courseById(c.env.DB, Number(c.req.param("id")));
    if (!event) return c.text("Delete failed: Course not found", 404);
    if (event.user_id !== user.id) throw new AuthError("Forbidden");
    await c.env.DB.prepare("DELETE FROM course_events WHERE id = ?").bind(event.id).run();
    return c.text("Course session deleted.");
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 403);
    return c.text(`Server error: ${(e as Error).message}`, 500);
  }
});
