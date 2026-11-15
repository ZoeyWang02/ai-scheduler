/* Study Buddy state, derived entirely from completed tasks (nothing stored, nothing decays).
 * A direct port of BuddyStateService.java: same constants, same rounding. */

import { storedToMs } from "./time";

const BASE_XP = 10;
const BONUS_PER_DAY_EARLY = 2;
const MAX_EARLY_BONUS_DAYS = 5;
const XP_PER_LEVEL = 50;
const STAGE_GROWING_XP = 100;
const STAGE_MATURE_XP = 300;
const EXCITED_WINDOW_HOURS = 2;
const HAPPY_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

export const DEFAULT_BUDDY_ID = "junimo";

export interface BuddyTask { dueDate: string | null; completedAt: string | null }

export interface BuddyState {
  buddyId: string;
  stage: "hatchling" | "growing" | "mature";
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  xpToNextStage: number | null;
  totalTasksCompleted: number;
  earlyCompletions: number;
  mood: "calm" | "happy" | "excited";
  justLeveledUp: boolean | null;
  justAdvancedStage: boolean | null;
}

/** Whole hours between two instants, truncated toward zero like java.time.Duration.toHours(). */
const hoursBetween = (fromMs: number, toMs: number) => Math.trunc((toMs - fromMs) / HOUR_MS);

function daysEarly(task: BuddyTask): number {
  if (!task.dueDate || !task.completedAt) return 0;
  const hours = hoursBetween(storedToMs(task.completedAt), storedToMs(task.dueDate));
  return hours > 0 ? Math.floor(hours / 24) : 0;
}

export function xpForTask(task: BuddyTask): number {
  if (!task.completedAt) return 0;
  const early = daysEarly(task);
  return BASE_XP + (early > 0 ? Math.min(early, MAX_EARLY_BONUS_DAYS) * BONUS_PER_DAY_EARLY : 0);
}

export const levelForXp = (xp: number) => Math.floor(xp / XP_PER_LEVEL) + 1;

export function stageForXp(xp: number): BuddyState["stage"] {
  if (xp >= STAGE_MATURE_XP) return "mature";
  if (xp >= STAGE_GROWING_XP) return "growing";
  return "hatchling";
}

function xpToNextStage(xp: number): number | null {
  if (xp < STAGE_GROWING_XP) return STAGE_GROWING_XP - xp;
  if (xp < STAGE_MATURE_XP) return STAGE_MATURE_XP - xp;
  return null;
}

function moodFor(completed: BuddyTask[], nowMs: number): BuddyState["mood"] {
  const times = completed.map((t) => t.completedAt).filter((t): t is string => !!t).map(storedToMs);
  if (!times.length) return "calm";
  const since = hoursBetween(Math.max(...times), nowMs);
  if (since <= EXCITED_WINDOW_HOURS) return "excited";
  if (since <= HAPPY_WINDOW_HOURS) return "happy";
  return "calm";
}

/** `completed` = the user's tasks that are completed and have a completion time. */
export function buildBuddyState(buddyId: string, completed: BuddyTask[], nowMs = Date.now()): BuddyState {
  const xp = completed.reduce((sum, t) => sum + xpForTask(t), 0);
  return {
    buddyId,
    stage: stageForXp(xp),
    xp,
    level: levelForXp(xp),
    xpIntoLevel: xp % XP_PER_LEVEL,
    xpPerLevel: XP_PER_LEVEL,
    xpToNextStage: xpToNextStage(xp),
    totalTasksCompleted: completed.length,
    earlyCompletions: completed.filter((t) => daysEarly(t) > 0).length,
    mood: moodFor(completed, nowMs),
    justLeveledUp: null,
    justAdvancedStage: null,
  };
}

/** State right after a completion toggle; flags whether this task crossed a level / stage line. */
export function stateAfterToggle(buddyId: string, completed: BuddyTask[], toggled: BuddyTask & { completed: boolean }, nowMs = Date.now()): BuddyState {
  const after = buildBuddyState(buddyId, completed, nowMs);
  if (!(toggled.completed && toggled.completedAt)) {
    return { ...after, justLeveledUp: false, justAdvancedStage: false };
  }
  const xpBefore = Math.max(0, after.xp - xpForTask(toggled));
  return {
    ...after,
    justLeveledUp: levelForXp(xpBefore) !== after.level,
    justAdvancedStage: stageForXp(xpBefore) !== after.stage,
  };
}

export function resolveBuddyId(preferences: Record<string, unknown> | null): string {
  const id = preferences?.studyBuddy;
  return typeof id === "string" && id.trim() ? id : DEFAULT_BUDDY_ID;
}
