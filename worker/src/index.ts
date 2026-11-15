import { Hono } from "hono";

import type { Env } from "./env";
import { aiRoutes, analyticsRoutes } from "./routes/ai";
import { authRoutes } from "./routes/auth";
import { buddyRoutes } from "./routes/buddy";
import { courseRoutes } from "./routes/courses";
import { importRoutes } from "./routes/import";
import { taskRoutes } from "./routes/tasks";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/auth", authRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/courses", courseRoutes);
app.route("/api/buddy", buddyRoutes);
app.route("/api/import", importRoutes);

/** Same list as the Java TimezoneController: "Continent/City" ids only. */
app.get("/api/timezones", (c) => {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported("timeZone") : ["America/Chicago", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Shanghai", "Asia/Tokyo"];
  const list = zones
    .filter((z) => z.includes("/") && !z.startsWith("Etc/") && !z.startsWith("SystemV/") && !z.startsWith("US/"))
    .sort();
  return c.json(list);
});

app.route("/api/ai", aiRoutes);
app.route("/api/analytics", analyticsRoutes);

// Not ported. The old direct-upload endpoints (/api/tasks/upload/*, /api/courses/upload/ics) are no longer
// used by the UI: it goes through /api/import/preview and /confirm. Say so plainly instead of a bare 404.
const notYet = (c: { json: (body: unknown, status: 501) => Response }) =>
  c.json({ message: "This feature is not available in the Worker build." }, 501);
app.post("/api/courses/upload/ics", notYet);
app.post("/api/tasks/upload/:type", notYet);

app.all("/api/*", (c) => c.json({ message: "Not found" }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ message: "Server error" }, 500);
});

export default app;
