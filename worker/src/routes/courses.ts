import { Hono } from "hono";

import { AuthError, numberOrNull, requireToken, requireUser } from "../auth";
import { courseById, coursesForUser } from "../db";
import type { Env } from "../env";
import { toJavaString, utcToLocal } from "../time";

export const courseRoutes = new Hono<{ Bindings: Env }>();

courseRoutes.get("/", async (c) => {
  const userId = numberOrNull(c.req.query("userId"));
  const timezone = c.req.query("timezone") ?? "America/Chicago";
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
