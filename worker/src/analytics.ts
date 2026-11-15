/* Study-rhythm analysis from task deadlines. Port of LifestyleAnalysisService.java: the same buckets,
 * labels, thresholds and wording, as pure functions. */

import { assertTimeZone, formatStored, localToUtc, makeUtcToLocal, msToStored, utcToLocal } from "./time";
import type { TaskRow } from "./db";

export type Period = "day" | "week" | "month";

export interface LifestyleAnalysis {
  period: Period;
  focusStyle: string;
  peakWindow: string;
  rhythmLabel: string;
  recommendation: string;
  totalTasks: number;
  completedTasks: number;
  timeBuckets: { label: string; count: number; percentage: number }[];
  hourlyStudy: { hour: number; hours: number }[];
}

type AnalysisTask = Pick<TaskRow, "due_date" | "description" | "completed">;
type FocusStyle = "fragmented" | "deep" | "steady";

// "Estimated: 2 h" (from chat), "Estimated time: 1.50 hours" (Coursera), "预计耗时 2 小时". The Java regex was
// case-sensitive and missed the first two; both English forms are accepted here.
const HOURS_PATTERN = /(预计耗时|预计时长|耗时|estimated(?:\s+time)?)\s*[:：]?\s*(\d+(?:\.\d+)?)/i;

export function normalizePeriod(period: string | null | undefined): Period {
  const p = (period ?? "").toLowerCase();
  return p === "day" || p === "month" ? p : "week";
}

const bucketIndex = (hour: number) => (hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : hour >= 17 && hour < 23 ? 2 : 3);

const BUCKET_LABELS = {
  en: ["Morning 5-12", "Afternoon 12-17", "Evening 17-23", "Late Night 23-5"],
  zh: ["早晨 5-12", "下午 12-17", "晚上 17-23", "深夜 23-5"],
};
const RHYTHM_LABELS = {
  en: ["Morning Bird", "Afternoon Pusher", "Night Owl", "Midnight Sprinter"],
  zh: ["晨间学习者", "午后推进型", "夜间高能型", "深夜冲刺型"],
};
const FOCUS_LABELS = {
  en: { fragmented: "Fragmented Focus", deep: "Deep Block Focus", steady: "Steady Rhythm" },
  zh: { fragmented: "碎片化专注", deep: "长时间深度专注", steady: "稳定节奏型" },
};
const RECOMMENDATIONS = {
  en: {
    none: "Not enough historical data. Import Canvas or Coursera tasks first, and I will update your rhythm profile.",
    fragmented: "Suggest breaking high-pressure tasks into 25-40 min chunks, and place review tasks in between breaks.",
    deep: "Suggest keeping 1-2 deep learning blocks (90 mins) daily. Prioritize complex tasks during your peak hours.",
    steady: "Maintain a steady learning window. Lock in your top 3 tasks a day in advance to avoid rushing.",
  },
  zh: {
    none: "还没有足够历史数据。先导入 Canvas 或 Coursera 任务，我会根据截止时间和完成记录更新你的节奏画像。",
    fragmented: "建议把高压任务拆成 25-40 分钟小块，并把复习、阅读类任务放进课间或饭后空档。",
    deep: "建议每天保留 1-2 个 90 分钟深度学习块，复杂作业优先放在你的高能时段。",
    steady: "建议维持固定学习窗口，提前一天锁定最重要的 3 个任务，减少临时赶工。",
  },
};

export function estimateHours(description: string | null): number {
  const match = description ? HOURS_PATTERN.exec(description) : null;
  return match ? Number.parseFloat(match[2]) : 1;
}

function focusStyle(taskCount: number, period: Period, strongestBucket: number): FocusStyle {
  const density = period === "month" ? Math.round(taskCount / 4) : taskCount;
  if (density >= 8) return "fragmented";
  return strongestBucket === 2 || strongestBucket === 3 ? "deep" : "steady";
}

/** Tasks with a deadline from the start of the period (local midnight) until the end of time. */
export function analyzeLifestyle(tasks: AnalysisTask[], timeZone: string, period: string | null | undefined, lang: string | null | undefined, nowMs = Date.now()): LifestyleAnalysis {
  assertTimeZone(timeZone);
  const normalized = normalizePeriod(period);
  const L = lang === "en" ? "en" : "zh";

  const today = utcToLocal(msToStored(nowMs), timeZone);
  const back = normalized === "day" ? 0 : normalized === "month" ? 30 : 7;
  const startDay = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - back));
  const startUtc = localToUtc(formatStored({ y: startDay.getUTCFullYear(), mo: startDay.getUTCMonth() + 1, d: startDay.getUTCDate(), h: 0, mi: 0, s: 0 }), timeZone);

  const inPeriod = tasks.filter((t) => t.due_date !== null && t.due_date >= startUtc); // same text format: string order is time order
  const toLocal = makeUtcToLocal(timeZone);
  const buckets = [0, 0, 0, 0];
  const hourly = new Array<number>(24).fill(0);
  let completed = 0;
  for (const task of inPeriod) {
    const hour = toLocal(task.due_date!).h;
    buckets[bucketIndex(hour)]++;
    hourly[hour] += estimateHours(task.description);
    if (task.completed === 1) completed++;
  }

  const total = inPeriod.length;
  const result: LifestyleAnalysis = {
    period: normalized,
    focusStyle: "",
    peakWindow: "",
    rhythmLabel: "",
    recommendation: "",
    totalTasks: total,
    completedTasks: completed,
    timeBuckets: buckets.map((count, i) => ({ label: BUCKET_LABELS[L][i], count, percentage: total === 0 ? 0 : Math.round((count * 100) / total) })),
    hourlyStudy: hourly.map((h, hour) => ({ hour, hours: Math.round(h * 10) / 10 })),
  };

  if (total === 0) {
    const waiting = L === "en" ? "Waiting for data" : "等待数据";
    return { ...result, peakWindow: L === "en" ? "No Data" : "暂无数据", rhythmLabel: waiting, focusStyle: waiting, recommendation: RECOMMENDATIONS[L].none };
  }

  let strongest = 0;
  for (let i = 1; i < buckets.length; i++) if (buckets[i] > buckets[strongest]) strongest = i;
  const style = focusStyle(total, normalized, strongest);
  return {
    ...result,
    peakWindow: BUCKET_LABELS[L][strongest],
    rhythmLabel: RHYTHM_LABELS[L][strongest],
    focusStyle: FOCUS_LABELS[L][style],
    recommendation: RECOMMENDATIONS[L][style],
  };
}
