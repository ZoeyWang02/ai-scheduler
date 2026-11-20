/* The assistant: chat (with the user's tasks, rhythm profile, busy times and the conversation so far) and
 * translation. Port of AiService.chat / translateText; the prompt text is the Java text, word for word. */

import { parseTranslationReply, translationMessages } from "../../frontend/js/taskI18n.js";
import { analyzeLifestyle } from "./analytics";
import type { LifestyleAnalysis } from "./analytics";
import { coursesForUser, tasksForUser } from "./db";
import type { Env } from "./env";
import { chatCompletion, isLlmConfigured, LlmError } from "./llm";
import type { ChatMessage } from "./llm";
import { assertTimeZone, msToStored, toJavaString, utcToLocal } from "./time";

export interface TranslationItem { to: string; title: string; description: string }

export const MAX_HISTORY_MESSAGES = 8;
export const MAX_HISTORY_CHARS = 1500;

/** Earlier turns of the conversation, so a follow-up such as "move them to the evening" makes sense. Only
 *  user/assistant turns are kept, only the latest few, each capped in length; anything else (including a client
 *  trying to inject a "system" turn) is dropped. */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const kept: ChatMessage[] = [];
  for (const turn of raw) {
    if (!turn || typeof turn !== "object") continue;
    const { role, content } = turn as { role?: unknown; content?: unknown };
    if (typeof content !== "string" || !content.trim()) continue;
    if (role !== "user" && role !== "assistant") continue;
    kept.push({ role, content: content.length > MAX_HISTORY_CHARS ? content.slice(0, MAX_HISTORY_CHARS) + "…" : content });
  }
  return kept.slice(-MAX_HISTORY_MESSAGES);
}

const WEEKDAYS = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
};

/** Models are unreliable at working out which date "Friday" is, so the prompt spells out the next 14 days. */
export function buildCalendarContext(today: { y: number; mo: number; d: number }, isEn: boolean): string {
  const names = isEn ? WEEKDAYS.en : WEEKDAYS.zh;
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const note = i === 0 ? (isEn ? " (today)" : "（今天）") : i === 1 ? (isEn ? " (tomorrow)" : "（明天）") : i === 2 && !isEn ? "（后天）" : "";
    days.push(`${date.toISOString().slice(0, 10)} ${names[date.getUTCDay()]}${note}`);
  }
  return days.join(isEn ? "; " : "；");
}

export interface PromptParts {
  isEn: boolean;
  taskContext: string;
  lifestyleContext: string;
  busyContext: string;
  currentTime: string;
  calendar: string;
}

const JSON_EXAMPLE = "[\n"
  + '  {"action": "add", "step": "Task Name", "description": "What to do in this step", "estimatedHours": 2, "suggestedDate": "2026-04-14T10:00:00"},\n'
  + '  {"action": "delete", "taskId": 12, "step": "Old Task Name", "reason": "Conflict with sleep"}\n'
  + "]\n";

export function buildSystemPrompt(p: PromptParts): string {
  const { isEn } = p;
  const langInstruction = isEn
    ? "CRITICAL: You MUST communicate with the user, answer their questions, and output the recommended schedule block names (step/reason) ENTIRELY IN ENGLISH."
    : "关键规则：请全程使用中文回答用户并提供建议。";

  const rules = isEn
    ? "\nFirst decide what the user wants, then answer accordingly:"
      + "\n(A) The user TELLS you about an event or commitment with a time (a meeting, class, exam, appointment, deadline), e.g. \"I have a meeting tomorrow at 8pm\". Record exactly that: one short confirmation sentence, then a JSON array with ONE add item for that event. step = the event in the user's own words, suggestedDate = the exact time they gave (work out \"tomorrow\", \"Friday\" etc. from the current time above), estimatedHours = the duration they gave, otherwise 1. The scheduling rules below do NOT apply to a time the user fixed, even at night. Do NOT add any other items and do NOT move existing tasks. If they gave no time, ask for it and return no JSON."
      + "\n(B) The user ASKS you to plan, schedule, break down or prioritize work. Make a plan that follows the scheduling rules: every suggestedDate between 06:00 and 23:00 (user's local time), never overlapping busy times; if there is not enough data prefer 09:00-11:30, 14:00-17:00, 19:00-22:00. You may add, reduce or cancel tasks; to delete an existing task return action=delete with its taskId."
      + "\n(C) Anything else (a question, chat, thanks): answer briefly in plain text with NO JSON."
      + "\nThe task list above is background only: never re-add, repeat or reschedule those tasks unless the user asks. Never invent tasks, courses or deliverables the user did not mention."
      + "\nThe earlier turns of this conversation are included before the user's latest message: use them to understand words like \"it\", \"them\" or \"that plan\". A turn starting with [Proposed plan] is a plan you suggested that the user has NOT applied yet, and one starting with [Applied plan] was already added to the task list; if they ask to change an unapplied plan, return the complete revised plan as one fresh JSON array (not just the differences). If they want to change tasks that are already in the task list above, return action=delete (with the taskId) for the old ones and action=add for the new ones."
      + "\nFor every action=add item, \"description\" is one or two concrete sentences saying what to do, based on what the user said in this conversation. Never use generic filler."
      + "\nWhen you return JSON, append one raw JSON array at the end of your response, formatted exactly like this:\n"
    : "\n先判断用户想要什么，再回答："
      + "\n（A）用户在告知一个带时间的事件或安排（会议、上课、考试、约见、截止时间），例如“我明天晚上8点有个会”。就只记录这件事：用一句话确认，然后返回只含一个 add 条目的 JSON 数组。step 用用户自己的说法，suggestedDate 为用户说的确切时间（“明天”“周五”等请根据上面的当前时间推算），estimatedHours 为用户说的时长，没说就填 1。用户指定的时间不受下面的排期规则限制，晚上也一样。不要添加任何其他条目，也不要改动已有任务。如果用户没说具体时间，就询问时间，不返回 JSON。"
      + "\n（B）用户请你制定计划、安排日程、拆解或排优先级。按排期规则做计划：所有 suggestedDate 必须在用户时区的 06:00 到 23:00 之间，不能与课程/不可用时间重叠；数据不足时默认优先 09:00-11:30、14:00-17:00、19:00-22:00。你可以增加计划，也可以删减/取消，删除旧任务请用 action=delete 并提供 taskId。"
      + "\n（C）其他情况（提问、闲聊、道谢）：用纯文字简短回答，不要返回 JSON。"
      + "\n上面的任务列表只是背景信息：除非用户要求，不要重复添加、重复安排或改期这些任务。不要编造用户没提到的任务、课程或作业。"
      + "\n本次对话之前的几轮内容会放在用户最新消息之前：请用它们理解“它”“这些”“那个计划”等说法。以 [Proposed plan] 开头的是你之前给出、用户还没有应用的计划，以 [Applied plan] 开头的则已经加入了任务列表；如果用户要求修改还没应用的计划，请返回完整的新计划（一个全新的 JSON 数组，而不是只写改动的部分）。如果用户要改的是上面任务列表里已有的任务，请对旧任务返回 action=delete（带 taskId），对新安排返回 action=add。"
      + "\n每个 action=add 的条目都必须有 \"description\"：用一两句具体的话说明要做什么，内容来自用户在本次对话中说的话，不要写空泛的套话。"
      + "\n返回 JSON 时，请在回复最后附上一个纯 JSON 数组，格式严格如下：\n";

  return (isEn ? "You are a UIUC academic assistant. Here are the user's current tasks:\n" : "你是一个UIUC的学术助理。以下是用户的课程作业：\n") + p.taskContext
    + "\n\n" + p.lifestyleContext
    + (isEn ? "\n\nAvoid these busy times for the next two weeks:\n" : "\n\n以下是用户未来两周的课程/不可用时间，排计划必须避开这些时间：\n") + p.busyContext
    + (isEn ? "\n\nCurrent time is: " : "\n\n现在的时间是：") + p.currentTime + "。"
    + (isEn
      ? "\nCalendar for the next 14 days (use it to resolve weekdays and relative dates; a bare weekday such as \"Friday\" means the first such day in this list): "
      : "\n未来14天的日历（请用它换算星期几和相对日期；单说“周五”指此列表中第一个周五）：")
    + p.calendar + "。"
    + rules
    + JSON_EXAMPLE
    + "\n" + langInstruction; // the language rule goes last, where it weighs most
}

const lifestyleContext = (l: LifestyleAnalysis, isEn: boolean) => isEn
  ? `User's rhythm profile: ${l.rhythmLabel}; Focus style: ${l.focusStyle}; Peak window: ${l.peakWindow}; Recommendation: ${l.recommendation}`
  : `用户近期作息画像：${l.rhythmLabel}；偏好专注模式：${l.focusStyle}；高能时间：${l.peakWindow}；排期建议：${l.recommendation}`;

export interface ChatRequest {
  message: string;
  userId: number | null;
  timezone: string;
  lang: string;
  history?: unknown;
}

const REPLIES = {
  notConfigured: "AI service is not configured. Set LLM_API_KEY.",
  busy: { en: "I'm getting a lot of requests right now. Please try again in a few seconds.", zh: "现在请求有点多，请几秒钟后再试一次。" },
  failed: { en: "Sorry, my brain is a bit scrambled right now (API Connection Failed).", zh: "对不起，我现在脑子有点乱（API连接失败）。" },
};

/** The system prompt (the user's tasks, rhythm profile, busy times, calendar) + earlier turns + the new message.
 *  Shared by the server-key path (chatReply) and the bring-your-own-key path, where the browser sends exactly
 *  these messages to the provider itself. */
export async function buildChatMessages(env: Env, req: ChatRequest, nowMs = Date.now()): Promise<ChatMessage[]> {
  const isEn = req.lang === "en";
  const tz = req.timezone;
  assertTimeZone(tz);

  // Two queries: everything the user has, read once.
  const [tasks, courses] = req.userId === null ? [[], []] : await Promise.all([tasksForUser(env.DB, req.userId), coursesForUser(env.DB, req.userId)]);

  const taskContext = tasks
    .map((t) => `- id=${t.id}${isEn ? ", title=" : ", 标题="}${t.title}${isEn ? ", Due=" : ", 截止日期="}${t.due_date ? toJavaString(utcToLocal(t.due_date, tz)) : "none"}`)
    .join("\n");

  const nowStored = msToStored(nowMs);
  const horizon = msToStored(nowMs + 14 * 86_400_000);
  const noCourses = isEn ? "No course schedule data available." : "暂无课程表数据。";
  const busy = courses
    .filter((c) => c.start_time >= nowStored && c.start_time <= horizon)
    .map((c) => `${c.title}: ${utcToLocal(c.start_time, tz).slice(0, 16).replace("T", " ")} - ${utcToLocal(c.end_time, tz).slice(11, 16)}`);

  const currentTime = utcToLocal(nowStored, tz);
  const system = buildSystemPrompt({
    isEn,
    taskContext,
    lifestyleContext: lifestyleContext(analyzeLifestyle(tasks, tz, "week", req.lang, nowMs), isEn),
    busyContext: busy.length ? busy.join("\n") : noCourses,
    currentTime,
    calendar: buildCalendarContext({ y: +currentTime.slice(0, 4), mo: +currentTime.slice(5, 7), d: +currentTime.slice(8, 10) }, isEn),
  });

  return [{ role: "system", content: system }, ...sanitizeHistory(req.history), { role: "user", content: req.message }];
}

/** The assistant's reply as plain text (a JSON plan may be appended at the end). Never throws for an AI failure:
 *  like the Java backend it answers with an apology, so the chat window always has something to show. */
export async function chatReply(env: Env, req: ChatRequest, nowMs = Date.now()): Promise<string> {
  if (!isLlmConfigured(env)) return REPLIES.notConfigured;
  const isEn = req.lang === "en";
  const messages = await buildChatMessages(env, req, nowMs);
  try {
    return await chatCompletion(env, messages, 0.3);
  } catch (error) {
    if (error instanceof LlmError && error.status === 429) return isEn ? REPLIES.busy.en : REPLIES.busy.zh;
    console.error("AI chat failed:", error instanceof Error ? error.message : error);
    return isEn ? REPLIES.failed.en : REPLIES.failed.zh;
  }
}

/** Task titles and descriptions translated in one request (see frontend/js/taskI18n.js): the answers in the order
 *  asked, or null when the model's reply cannot be used. Throws LlmError when the model cannot be reached. */
export async function translateTasks(env: Env, items: TranslationItem[]): Promise<{ title: string; description: string }[] | null> {
  const reply = await chatCompletion(env, translationMessages(items), 0.2);
  return parseTranslationReply(reply, items.length);
}

/** One piece of text, translated on request (the translate button on a chat message / task). */
export async function translateText(env: Env, text: string, targetLang: string): Promise<string> {
  if (!isLlmConfigured(env) || !text.trim()) return text;
  const system = targetLang === "en"
    ? "You are a translator. Translate the user's text into English. Return ONLY the translated text, no quotes, no explanation, no markdown."
    : "你是一个翻译助手。请将用户提供的文本翻译成中文。只返回翻译结果，不要引号、不要解释、不要 markdown。";
  return (await chatCompletion(env, [{ role: "system", content: system }, { role: "user", content: text }], 0.2)).trim();
}
