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
