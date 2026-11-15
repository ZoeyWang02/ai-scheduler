import { Hono } from "hono";

import { AuthError, numberOrNull, requireUser } from "../auth";
import { buildBuddyState, resolveBuddyId } from "../buddy";
import { parsePreferences, tasksForUser } from "../db";
import type { Env } from "../env";

export const buddyRoutes = new Hono<{ Bindings: Env }>();

buddyRoutes.get("/state", async (c) => {
  try {
    const user = await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"));
    const done = (await tasksForUser(c.env.DB, user.id))
      .filter((t) => t.completed === 1 && t.completed_at)
      .map((t) => ({ dueDate: t.due_date, completedAt: t.completed_at }));
    return c.json(buildBuddyState(resolveBuddyId(parsePreferences(user.preferences)), done));
  } catch (e) {
    if (e instanceof AuthError) return c.text(e.message, 401);
    throw e;
  }
});
