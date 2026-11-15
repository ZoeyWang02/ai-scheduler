/* iCalendar (.ics) parsing for timetables, with weekly recurrence expansion.
 * Port of CourseEventService.parseEvents / expandRRule, plus the parts the Java version skipped:
 * folded lines, escaped text, COUNT, INTERVAL and EXDATE. Pure functions: no I/O. */

import { assertTimeZone, formatStored, makeZoneConverter, msToStored, storedToMs } from "./time";
import type { LocalParts } from "./time";

export interface IcsEvent {
  title: string;
  location: string | null;
  /** UTC storage text, e.g. "2026-11-16T16:00:00" */
  start: string;
  end: string;
}

interface Prop { name: string; params: Record<string, string>; value: string }

const MAX_OCCURRENCES = 150; // same safety cap as the Java backend
const DAY_MS = 86_400_000;
const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** RFC 5545 line unfolding: a line starting with a space or tab continues the previous one. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw.trimEnd());
  }
  return out;
}

function parseProp(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** A zone name from the file, or the user's zone when it is missing or not an IANA name. */
function zoneOf(params: Record<string, string>, fallback: string): string {
  const tzid = params.TZID;
  if (!tzid) return fallback;
  try {
    assertTimeZone(tzid);
    return tzid;
  } catch {
    return fallback;
  }
}

interface When { utc: string; local: LocalParts | null; zone: string; allDay: boolean }

/** DTSTART / DTEND / UNTIL / EXDATE value -> UTC text. `local` is the wall clock in `zone` (null for Z times). */
function parseWhen(value: string, params: Record<string, string>, defaultZone: string, convert: (zone: string) => (p: LocalParts) => string): When | null {
  const zone = zoneOf(params, defaultZone);
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const parts: LocalParts = { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0 };
  const allDay = m[4] === undefined;
  if (m[7]) return { utc: formatStored(parts), local: null, zone, allDay: false };
  return { utc: convert(zone)(parts), local: parts, zone, allDay };
}

export function parseIcsEvents(text: string, defaultZone: string): IcsEvent[] {
  assertTimeZone(defaultZone);
  const converters = new Map<string, (p: LocalParts) => string>();
  const convert = (zone: string) => {
    let fn = converters.get(zone);
    if (!fn) converters.set(zone, (fn = makeZoneConverter(zone)));
    return fn;
  };

  const events: IcsEvent[] = [];
  let current: Prop[] | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { current = []; continue; }
    if (line === "END:VEVENT") {
      if (current) events.push(...toEvents(current, defaultZone, convert));
      current = null;
      continue;
    }
    if (current) {
      const prop = parseProp(line);
      if (prop) current.push(prop);
    }
  }
  return events;
}

function toEvents(props: Prop[], defaultZone: string, convert: (zone: string) => (p: LocalParts) => string): IcsEvent[] {
  const first = (name: string) => props.find((p) => p.name === name);
  const dtstart = first("DTSTART");
  if (!dtstart) return [];
  const start = parseWhen(dtstart.value, dtstart.params, defaultZone, convert);
  if (!start) return [];

  const dtend = first("DTEND");
  let end = dtend ? parseWhen(dtend.value, dtend.params, defaultZone, convert) : null;
  if (!end && start.allDay) end = { ...start, utc: msToStored(storedToMs(start.utc) + DAY_MS) }; // an all-day event lasts one day
  if (!end) return [];
  const durationMs = Math.max(0, storedToMs(end.utc) - storedToMs(start.utc));

  const title = unescapeText(first("SUMMARY")?.value ?? "").trim() || "Course";
  const location = unescapeText(first("LOCATION")?.value ?? "").trim() || null;
  const single: IcsEvent = { title, location, start: start.utc, end: end.utc };

  const rrule = first("RRULE")?.value;
  if (!rrule) return [single];

  const rules: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) rules[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (rules.FREQ !== "WEEKLY" || !start.local) return [single]; // like the Java backend: only weekly rules expand

  const zone = start.zone;
  const toUtc = convert(zone);
  const interval = Math.max(1, Number.parseInt(rules.INTERVAL ?? "1", 10) || 1);
  const maxCount = rules.COUNT ? Number.parseInt(rules.COUNT, 10) : Infinity;

  // Last allowed start. A date-only UNTIL means the end of that day; no UNTIL means six months, as in Java.
  let untilMs = storedToMs(start.utc) + 183 * DAY_MS;
  if (rules.UNTIL) {
    const until = parseWhen(rules.UNTIL, { TZID: zone }, zone, convert);
    if (until) {
      const dateOnly = /^\d{8}$/.test(rules.UNTIL.trim());
      untilMs = storedToMs(until.utc) + (dateOnly ? DAY_MS - 1000 : 0);
    }
  }

  const byDays = (rules.BYDAY ?? "")
    .split(",")
    .map((d) => WEEKDAYS[d.trim().slice(-2).toUpperCase()])
    .filter((d) => d !== undefined);
  const startNaive = Date.UTC(start.local.y, start.local.mo - 1, start.local.d);
  const startDow = new Date(startNaive).getUTCDay();
  if (!byDays.length) byDays.push(startDow);

  // EXDATE: occurrences to skip, by exact start instant (or by local date for date-only values).
  const excludedInstants = new Set<string>();
  const excludedDates = new Set<string>();
  for (const prop of props.filter((p) => p.name === "EXDATE")) {
    for (const value of prop.value.split(",")) {
      const ex = parseWhen(value, prop.params, zone, convert);
      if (!ex) continue;
      if (ex.allDay && ex.local) excludedDates.add(`${ex.local.y}-${ex.local.mo}-${ex.local.d}`);
      else excludedInstants.add(ex.utc);
    }
  }

  const weekAnchor = startNaive - ((startDow + 6) % 7) * DAY_MS; // the Monday of the first week
  const out: IcsEvent[] = [];
  let counted = 0;
  for (let offset = 0; offset < 900 && counted < maxCount && out.length < MAX_OCCURRENCES; offset++) {
    const dayNaive = startNaive + offset * DAY_MS;
    const dow = new Date(dayNaive).getUTCDay();
    if (!byDays.includes(dow)) continue;
    if (Math.floor((dayNaive - weekAnchor) / (7 * DAY_MS)) % interval !== 0) continue;

    const day = new Date(dayNaive);
    const occurrence: LocalParts = { y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), h: start.local.h, mi: start.local.mi, s: start.local.s };
    const startUtc = toUtc(occurrence);
    const startMs = storedToMs(startUtc);
    if (startMs > untilMs) break;
    counted++;
    if (excludedInstants.has(startUtc) || excludedDates.has(`${occurrence.y}-${occurrence.mo}-${occurrence.d}`)) continue;
    out.push({ title, location, start: startUtc, end: msToStored(startMs + durationMs) });
  }
  return out.length ? out : [single]; // fallback: at least the first session, as in Java
}
