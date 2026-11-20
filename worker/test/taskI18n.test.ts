import { describe, expect, it, vi } from "vitest";

import {
  buildI18n, buildTaskTranslations, isValidI18n, languageOf, MAX_ITEMS, parseTranslationReply, pickTaskText, splitPlanPrefix, translationItem, translationMessages,
} from "../../frontend/js/taskI18n.js";
import { i18nToStore, parseI18n } from "../src/db";

describe("languageOf / translationItem", () => {
  it("calls text with any Chinese character Chinese, and everything else English", () => {
    expect(languageOf("发送邮件给老师")).toBe("zh");
    expect(languageOf("Meeting with 老师")).toBe("zh");
    expect(languageOf("Email the teacher")).toBe("en");
    expect(languageOf("")).toBe("en");
  });

  it("asks for the opposite language, without the planner tag", () => {
    expect(translationItem({ title: "[AI] 发送邮件给老师 1", description: "写清楚" })).toEqual({ from: "zh", to: "en", title: "发送邮件给老师 1", description: "写清楚" });
    expect(translationItem({ title: "Quiz prep", description: null })).toEqual({ from: "en", to: "zh", title: "Quiz prep", description: "" });
  });

  it("decides the language from the title, not from a description that quotes the other language", () => {
    expect(translationItem({ title: "Read chapter 4", description: 'Take notes\nFrom chat: "帮我安排复习"' }).to).toBe("zh");
    expect(translationItem({ title: "复习第三章", description: "Estimated: 2 h" }).to).toBe("en");
  });

  it("lets the description decide only when the title has no letters", () => {
    expect(translationItem({ title: "2", description: "第三次作业" }).to).toBe("en");
    expect(translationItem({ title: "2", description: "Homework" }).to).toBe("zh");
    expect(translationItem({ title: "", description: "" }).to).toBe("zh");
  });

  it("splits the planner tag in either language", () => {
    expect(splitPlanPrefix("[AI] Read ch. 3")).toEqual({ prefix: "[AI] ", rest: "Read ch. 3" });
    expect(splitPlanPrefix("[智能规划] 读第三章")).toEqual({ prefix: "[AI] ", rest: "读第三章" });
    expect(splitPlanPrefix("Plain")).toEqual({ prefix: "", rest: "Plain" });
  });
});

describe("the translation request and reply", () => {
  const items = [{ to: "en", title: "你好", description: "" }];

  it("sends the items as JSON after a system prompt that says what to return", () => {
    const messages = translationMessages(items);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(JSON.parse(messages[1].content)).toEqual(items);
    expect(messages[0].content).toContain("JSON array");
    expect(messages[0].content).toContain("same number of items");
  });

  it("does not leak extra fields into the prompt", () => {
    const messages = translationMessages([{ from: "zh", to: "en", title: "a", description: "b" } as any]);
    expect(JSON.parse(messages[1].content)).toEqual([{ to: "en", title: "a", description: "b" }]);
  });

  it("reads a plain or fenced JSON array", () => {
    expect(parseTranslationReply('[{"title":" Hello ","description":""}]', 1)).toEqual([{ title: "Hello", description: "" }]);
    expect(parseTranslationReply('```json\n[{"title":"Hi","description":"x"}]\n```', 1)).toEqual([{ title: "Hi", description: "x" }]);
  });

  it("rejects replies that are not usable", () => {
    expect(parseTranslationReply("Sorry, I cannot do that.", 1)).toBeNull();
    expect(parseTranslationReply("[not json]", 1)).toBeNull();
    expect(parseTranslationReply('[{"title":"a","description":""}]', 2)).toBeNull(); // wrong length
    expect(parseTranslationReply('[{"description":"only"}]', 1)).toBeNull(); // no title
    expect(parseTranslationReply('{"title":"a"}', 1)).toBeNull(); // not an array
    expect(parseTranslationReply(undefined as any, 1)).toBeNull();
  });

  it("treats a missing description as empty", () => {
    expect(parseTranslationReply('[{"title":"a"}]', 1)).toEqual([{ title: "a", description: "" }]);
  });
});

describe("buildI18n", () => {
  const task = { title: "[AI] 发送邮件给老师", description: "写清楚" };

  it("keeps the original in its own language slot and puts the translation in the other, with the planner tag", () => {
    const item = translationItem(task);
    expect(buildI18n(task, item, { title: "Email the teacher", description: "Be clear" })).toEqual({
      zh: { title: "[AI] 发送邮件给老师", description: "写清楚" },
      en: { title: "[AI] Email the teacher", description: "Be clear" },
    });
  });

  it("works from English too", () => {
    const english = { title: "Quiz prep", description: null };
    expect(buildI18n(english, translationItem(english), { title: "复习小测", description: "" })).toEqual({
      en: { title: "Quiz prep", description: "" },
      zh: { title: "复习小测", description: "" },
    });
  });

  it("gives nothing when there is no usable translation", () => {
    expect(buildI18n(task, translationItem(task), null)).toBeNull();
    expect(buildI18n(task, translationItem(task), { title: "", description: "x" })).toBeNull();
    expect(buildI18n(task, translationItem(task), { title: 5 as any, description: "x" })).toBeNull();
  });
});

describe("buildTaskTranslations", () => {
  const tasks = [{ title: "发送邮件给老师", description: "" }, { title: "Quiz prep", description: "ch. 1-3" }];
  const echo = (items: any[]) => Promise.resolve(items.map((i) => ({ title: `${i.to}:${i.title}`, description: i.description ? `${i.to}:${i.description}` : "" })));

  it("returns one i18n per task, in order, from a single request", async () => {
    const translate = vi.fn(echo);
    const result = await buildTaskTranslations(tasks, translate);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual({ zh: { title: "发送邮件给老师", description: "" }, en: { title: "en:发送邮件给老师", description: "" } });
    expect(result[1]).toEqual({ en: { title: "Quiz prep", description: "ch. 1-3" }, zh: { title: "zh:Quiz prep", description: "zh:ch. 1-3" } });
  });

  it("leaves tasks untranslated (null) instead of failing when the request fails or answers badly", async () => {
    expect(await buildTaskTranslations(tasks, () => Promise.reject(new Error("offline")))).toEqual([null, null]);
    expect(await buildTaskTranslations(tasks, () => Promise.resolve(null))).toEqual([null, null]);
    expect(await buildTaskTranslations(tasks, () => Promise.resolve([{ title: "only one", description: "" }]))).toEqual([null, null]);
  });

  it("splits a long list into batches and keeps going when one batch fails", async () => {
    const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ title: `Task ${i}`, description: "" }));
    let call = 0;
    const translate = vi.fn((items: any[]) => (++call === 1 ? Promise.reject(new Error("rate limited")) : echo(items)));
    const result = await buildTaskTranslations(many, translate);
    expect(translate.mock.calls.map((c) => c[0].length)).toEqual([MAX_ITEMS, 5]);
    expect(result.slice(0, MAX_ITEMS).every((r) => r === null)).toBe(true);
    expect(result.slice(MAX_ITEMS).every((r: any) => r && r.zh.title.startsWith("zh:Task"))).toBe(true);
  });

  it("does nothing for no tasks", async () => {
    const translate = vi.fn();
    expect(await buildTaskTranslations([], translate)).toEqual([]);
    expect(translate).not.toHaveBeenCalled();
  });
});

describe("pickTaskText", () => {
  const task = { title: "发送邮件给老师", description: "写清楚", i18n: { zh: { title: "发送邮件给老师", description: "写清楚" }, en: { title: "Email the teacher", description: "Be clear" } } };

  it("shows the saved text for the language", () => {
    expect(pickTaskText(task, "en")).toEqual({ title: "Email the teacher", description: "Be clear" });
    expect(pickTaskText(task, "zh")).toEqual({ title: "发送邮件给老师", description: "写清楚" });
  });

  it("shows the task as written when it has no translations, or none for that language", () => {
    expect(pickTaskText({ title: "Old task", description: null }, "zh")).toEqual({ title: "Old task", description: "" });
    expect(pickTaskText({ title: "Old", description: "d", i18n: null }, "en")).toEqual({ title: "Old", description: "d" });
    expect(pickTaskText({ title: "A", description: "d", i18n: { zh: { title: "甲", description: "" } } }, "en")).toEqual({ title: "A", description: "d" });
  });

  it("falls back to the original for a blank saved title", () => {
    expect(pickTaskText({ title: "A", description: "d", i18n: { en: { title: "", description: "x" } } }, "en")).toEqual({ title: "A", description: "x" });
  });
});

describe("what the Worker stores", () => {
  const good = { zh: { title: "你好", description: "" }, en: { title: "Hello", description: "" } };

  it("accepts a zh/en pair (or just one of them) and nothing else", () => {
    expect(isValidI18n(good)).toBe(true);
    expect(isValidI18n({ en: good.en })).toBe(true);
    expect(isValidI18n({})).toBe(false);
    expect(isValidI18n(null)).toBe(false);
    expect(isValidI18n([])).toBe(false);
    expect(isValidI18n({ fr: good.en })).toBe(false);
    expect(isValidI18n({ en: { title: 1, description: "" } })).toBe(false);
    expect(isValidI18n({ en: { title: "x" } })).toBe(false);
    expect(isValidI18n({ en: { title: "x".repeat(301), description: "" } })).toBe(false);
    expect(isValidI18n({ en: { title: "x", description: "y".repeat(2001) } })).toBe(false);
  });

  it("round-trips through JSON text, and treats junk as no translation", () => {
    expect(parseI18n(i18nToStore(good))).toEqual(good);
    expect(i18nToStore("nope")).toBeNull();
    expect(i18nToStore(undefined)).toBeNull();
    expect(parseI18n(null)).toBeNull();
    expect(parseI18n("{broken")).toBeNull();
    expect(parseI18n('{"fr":{"title":"a","description":""}}')).toBeNull();
  });
});
