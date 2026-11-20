import { describe, expect, it } from "vitest";

import { addMinutes, buildUpdate, isUnreadable, newTaskFromItem, normalizeItem, splitReply } from "../../frontend/js/planItems.js";

const plan = (reply: string) => {
  const r = splitReply(reply);
  return { ...r, items: r.plan ? JSON.parse(r.plan) : null };
};

describe("splitReply: the plan is taken out and no JSON reaches the person", () => {
  it("reads a plain array after a sentence", () => {
    const r = plan('Sure, here is the change.\n[{"action":"delete","taskId":4,"step":"Dentist","reason":"asked"}]');
    expect(r.text).toBe("Sure, here is the change.");
    expect(r.items).toEqual([{ action: "delete", taskId: 4, step: "Dentist", reason: "asked" }]);
    expect(r.after).toBe("");
  });

  it("drops the code fence around the plan, and keeps text after it", () => {
    const r = plan('I will move it.\n\n```json\n[{"action":"update","taskId":3,"suggestedDate":"2026-11-24 18:00"}]\n```\nTap Apply below.');
    expect(r.text).toBe("I will move it.");
    expect(r.items).toEqual([{ action: "update", taskId: 3, suggestedDate: "2026-11-24T18:00:00" }]);
    expect(r.after).toBe("Tap Apply below.");
  });

  it("reads objects that come without brackets", () => {
    const r = plan('Adding both.\n{"action":"add","step":"A","suggestedDate":"2026-11-23T10:00:00"}\n{"action":"add","step":"B"}');
    expect(r.items.map((i: any) => i.step)).toEqual(["A", "B"]);
    expect(r.text).toBe("Adding both.");
  });

  it("copes with a trailing comma and with a reply cut off in the middle of the last item", () => {
    expect(plan('Ok [{"action":"add","step":"A",},]').items.map((i: any) => i.step)).toEqual(["A"]);
    const cut = plan('Ok [{"action":"add","step":"A"},{"action":"add","step":"B","descri');
    expect(cut.items.map((i: any) => i.step)).toEqual(["A"]);
    expect(cut.text).toBe("Ok");
  });

  it("is not fooled by braces or brackets inside strings", () => {
    const r = plan('Ok [{"action":"add","step":"Fix {bug} [now]","description":"a } b"}]');
    expect(r.items).toEqual([{ action: "add", step: "Fix {bug} [now]", description: "a } b", kind: "task" }]);
  });

  it("shows plain answers untouched", () => {
    const r = plan("On Monday you have a study group at 18:00-19:30 [see list].");
    expect(r.text).toBe("On Monday you have a study group at 18:00-19:30 [see list].");
    expect(r.items).toBeNull();
  });

  it("hides JSON that holds no usable plan, and an empty plan", () => {
    expect(plan('Here you go\n```json\n{"foo": 1, "bar": [2, 3]}\n```').text).toBe("Here you go");
    const empty = plan("Nothing to change. []");
    expect(empty.items).toBeNull();
    expect(empty.text).toBe("Nothing to change.");
  });

  it("hides an update or delete that names no task", () => {
    const r = plan('Done\n[{"action":"delete","step":"Dentist"}]');
    expect(r.items).toBeNull();
    expect(r.text).not.toContain("{");
  });

  it("unwraps a JSON object that only wraps the answer", () => {
    expect(plan('{"reply": "You are free on Tuesday afternoon."}').text).toBe("You are free on Tuesday afternoon.");
    expect(plan('```json\n{"message":"Hi there"}\n```').text).toBe("Hi there");
  });

  it("says when nothing readable is left", () => {
    const original = '```json\n[{"x": 1}]\n```';
    expect(isUnreadable(original, splitReply(original))).toBe(true);
    expect(isUnreadable("Hello", splitReply("Hello"))).toBe(false);
    expect(isUnreadable("", splitReply(""))).toBe(false);
  });
});

describe("normalizeItem", () => {
  it("defaults an add to a task and clamps the fields", () => {
    expect(normalizeItem({ step: "Read", estimatedHours: "2", suggestedDate: "2026-11-23T09:00" })).toEqual({ action: "add", kind: "task", step: "Read", estimatedHours: 2, suggestedDate: "2026-11-23T09:00:00" });
    expect(normalizeItem({ action: "ADD", kind: "Event", step: "Meeting", estimatedHours: -3, suggestedDate: "tomorrow" })).toEqual({ action: "add", kind: "event", step: "Meeting" });
  });

  it("needs a task id for update and delete", () => {
    expect(normalizeItem({ action: "update", step: "x" })).toBeNull();
    expect(normalizeItem({ action: "delete", taskId: "7" })).toEqual({ action: "delete", taskId: 7 });
    expect(normalizeItem({ foo: 1 })).toBeNull();
    expect(normalizeItem("text")).toBeNull();
  });
});

describe("applying a plan", () => {
  it("gives an event an end from its start and length, and a task none", () => {
    expect(newTaskFromItem({ action: "add", kind: "event", suggestedDate: "2026-11-23T14:00:00", estimatedHours: 1.5 })).toEqual({ dueDate: "2026-11-23T14:00:00", endDate: "2026-11-23T15:30:00" });
    expect(newTaskFromItem({ action: "add", kind: "event", suggestedDate: "2026-11-23T14:00:00" }).endDate).toBe("2026-11-23T15:00:00");
    expect(newTaskFromItem({ action: "add", kind: "task", suggestedDate: "2026-11-23T14:00:00", estimatedHours: 2 }).endDate).toBeNull();
    expect(addMinutes("2026-11-23T23:30:00", 90)).toBe("2026-11-24T01:00:00");
  });

  const eventTask = { title: "Study group", description: "Room 2", dueDate: "2026-11-23T18:00", endDate: "2026-11-23T19:30" };
  const deadline = { title: "[AI] CS 225 HW", description: null, dueDate: "2026-11-23T22:00", endDate: null };

  it("moving an event keeps its length", () => {
    const { body, textChanged } = buildUpdate(eventTask, { action: "update", taskId: 3, suggestedDate: "2026-11-24T18:00:00" });
    expect(body).toEqual({ title: "Study group", description: "Room 2", dueDate: "2026-11-24T18:00:00", endDate: "2026-11-24T19:30:00" });
    expect(textChanged).toBe(false);
  });

  it("a new length changes the end, and the start stays", () => {
    expect(buildUpdate(eventTask, { action: "update", taskId: 3, estimatedHours: 2 }).body).toMatchObject({ dueDate: "2026-11-23T18:00:00", endDate: "2026-11-23T20:00:00" });
  });

  it("moving a deadline stays a deadline, and a rename keeps the planner tag and flags the text as changed", () => {
    const moved = buildUpdate(deadline, { action: "update", taskId: 1, suggestedDate: "2026-11-23T20:00:00", step: "CS 225 Homework 8" });
    expect(moved.body).toEqual({ title: "[AI] CS 225 Homework 8", description: null, dueDate: "2026-11-23T20:00:00", endDate: null });
    expect(moved.textChanged).toBe(true);
    expect(buildUpdate(deadline, { action: "update", taskId: 1, step: "CS 225 HW", suggestedDate: "2026-11-23T20:00:00" }).textChanged).toBe(false);
  });

  it("can turn a task into an event and back", () => {
    expect(buildUpdate(deadline, { action: "update", taskId: 1, kind: "event", estimatedHours: 1 }).body.endDate).toBe("2026-11-23T23:00:00");
    expect(buildUpdate(eventTask, { action: "update", taskId: 3, kind: "task" }).body.endDate).toBeNull();
  });
});
