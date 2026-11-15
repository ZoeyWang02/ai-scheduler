/* Time helpers that reproduce what the Java backend did with LocalDateTime + ZoneId.
 *
 * Storage format: UTC text "YYYY-MM-DDTHH:MM:SS" (no zone suffix), like Hibernate's LocalDateTime.
 * Wire format: Java's LocalDateTime.toString(), which drops the seconds when they are zero
 * ("2026-11-16T10:00"). The frontend already copes with both. */

export interface LocalParts { y: number; mo: number; d: number; h: number; mi: number; s: number }

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z)?$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Accepts what Jackson accepted for a LocalDateTime: seconds optional, fraction and trailing Z tolerated. */
export function parseLocalDateTime(text: string): LocalParts | null {
  const m = LOCAL_RE.exec(text.trim());
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
}

export function formatStored(p: LocalParts): string {
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** Java's LocalDateTime.toString(): seconds are omitted when zero. */
export function toJavaString(stored: string): string {
  return stored.endsWith(":00") ? stored.slice(0, -3) : stored;
}

/** "yyyy-MM-dd HH:mm", the display format the task list uses. */
export function toDisplayString(stored: string): string {
  return stored.slice(0, 16).replace("T", " ");
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** Throws RangeError for an unknown zone, which callers turn into a 400. */
export function assertTimeZone(timeZone: string): void {
  formatterFor(timeZone);
}

/** The zone's wall-clock fields at an instant. */
function zoneFields(ms: number, timeZone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = +part.value;
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour, mi: out.minute, s: out.second };
}

/** Zone offset (local minus UTC) in ms at an instant. */
function offsetMs(ms: number, timeZone: string): number {
  const f = zoneFields(ms, timeZone);
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in `timeZone` -> UTC storage text. */
export function localToUtc(local: string, timeZone: string): string {
  const p = parseLocalDateTime(local);
  if (!p) throw new Error(`Invalid date-time: ${local}`);
  const asIfUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  // Two passes settle the offset around daylight-saving changes.
  let utc = asIfUtc - offsetMs(asIfUtc, timeZone);
  utc = asIfUtc - offsetMs(utc, timeZone);
  return msToStored(utc);
}

/** Many local -> UTC conversions in one zone, cheaply. A timetable expands to hundreds of sessions and
 *  the free plan allows ~10 ms of CPU, so the zone offset is looked up once per calendar day instead
 *  of per call (about 10 us each). Days near a daylight-saving change fall back to the exact path. */
export function makeZoneConverter(timeZone: string): (p: LocalParts) => string {
  const DAY = 86_400_000;
  const MARGIN = 14 * 3_600_000;
  const dayOffsets = new Map<string, number | null>();
  const offsetForDay = (p: LocalParts): number | null => {
    const key = `${p.y}-${p.mo}-${p.d}`;
    let value = dayOffsets.get(key);
    if (value === undefined) {
      const dayStart = Date.UTC(p.y, p.mo - 1, p.d);
      const before = offsetMs(dayStart - MARGIN, timeZone);
      const after = offsetMs(dayStart + DAY + MARGIN, timeZone);
      value = before === after ? before : null; // null: the offset changes around this day
      dayOffsets.set(key, value);
    }
    return value;
  };
  return (p) => {
    const offset = offsetForDay(p);
    if (offset === null) return localToUtc(formatStored(p), timeZone);
    return msToStored(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - offset);
  };
}

/** Many UTC -> local conversions in one zone (the rhythm analysis looks at every task). The zone offset is
 *  looked up once per UTC day; a day on which it changes falls back to the exact path. */
export function makeUtcToLocal(timeZone: string): (stored: string) => LocalParts {
  const DAY = 86_400_000;
  const offsets = new Map<number, number | null>();
  return (stored) => {
    const ms = storedToMs(stored);
    const day = Math.floor(ms / DAY);
    let offset = offsets.get(day);
    if (offset === undefined) {
      const start = offsetMs(day * DAY, timeZone);
      offset = start === offsetMs((day + 1) * DAY - 1000, timeZone) ? start : null;
      offsets.set(day, offset);
    }
    if (offset === null) return zoneFields(ms, timeZone);
    const d = new Date(ms + offset);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  };
}

/** UTC storage text -> the wall-clock time in `timeZone`, as storage-style text. */
export function utcToLocal(stored: string, timeZone: string): string {
  return formatStored(zoneFields(storedToMs(stored), timeZone));
}

export function storedToMs(stored: string): number {
  const p = parseLocalDateTime(stored);
  if (!p) throw new Error(`Invalid stored date-time: ${stored}`);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
}

export function msToStored(ms: number): string {
  const d = new Date(ms);
  return formatStored({ y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() });
}

export function nowStored(): string {
  return msToStored(Date.now());
}
