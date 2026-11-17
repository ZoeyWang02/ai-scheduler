import { describe, expect, it, vi } from "vitest";

import { dispatch, initActions, parseArgs } from "../../frontend/js/actions.js";

/** A stand-in for a DOM element: attributes, an optional value, and a parent chain for closest(). */
function el(attrs: Record<string, string>, value?: string, parent?: any): any {
  const node: any = {
    value,
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    closest(selector: string) {
      const name = /^\[(.+)\]$/.exec(selector)![1];
      for (let n: any = node; n; n = n.parent) if (name in n.attrs) return n;
      return null;
    },
    attrs,
    parent,
  };
  return node;
}

describe("parseArgs", () => {
  it("reads a JSON array and substitutes the element and its value", () => {
    const e = el({}, "dark");
    expect(parseArgs('["day", "@this", "@value", 3, null]', e)).toEqual(["day", e, "dark", 3, null]);
    expect(parseArgs(null, e)).toEqual([]);
    expect(parseArgs("", e)).toEqual([]);
  });

  it("ignores broken or non-array data instead of throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseArgs("[not json", el({}))).toEqual([]);
    expect(parseArgs('{"a":1}', el({}))).toEqual([]);
    error.mockRestore();
  });
});

describe("dispatch", () => {
  it("calls the named action with its arguments", () => {
    const setAuthMode = vi.fn();
    const button = el({ "data-click": "setAuthMode", "data-args": '["signin"]' });
    expect(dispatch({ setAuthMode }, button, "data-click")).toBe(true);
    expect(setAuthMode).toHaveBeenCalledWith("signin");
  });

  it("finds the nearest element with the attribute, so a click on a child (an icon) still works", () => {
    const close = vi.fn();
    const outer = el({ "data-click": "close" });
    const inner = el({}, undefined, outer);
    expect(dispatch({ close }, inner, "data-click")).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("passes the element for '@this' and the value for '@value'", () => {
    const seen: unknown[] = [];
    const registry = { period: (...a: unknown[]) => seen.push(a), theme: (...a: unknown[]) => seen.push(a) };
    const tab = el({ "data-click": "period", "data-args": '["week", "@this"]' });
    dispatch(registry, tab, "data-click");
    const select = el({ "data-change": "theme", "data-args": '["@value"]' }, "stardew-night");
    dispatch(registry, select, "data-change");
    expect(seen).toEqual([["week", tab], ["stardew-night"]]);
  });

  it("does nothing when there is no matching element", () => {
    const action = vi.fn();
    expect(dispatch({ action }, el({}), "data-click")).toBe(false);
    expect(dispatch({ action }, null, "data-click")).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("only reaches functions in the registry, never inherited ones or anything else", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = { allowed: vi.fn() };
    for (const name of ["missing", "constructor", "toString", "__proto__", "hasOwnProperty", "alert", "eval"]) {
      expect(dispatch(registry, el({ "data-click": name }), "data-click"), name).toBe(false);
    }
    expect(registry.allowed).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("initActions", () => {
  function fakeRoot() {
    const listeners: Record<string, (event: any) => void> = {};
    return { addEventListener: (type: string, fn: (event: any) => void) => { listeners[type] = fn; }, fire: (type: string, event: any) => listeners[type](event) };
  }

  it("wires click, change and Enter, and nothing else", () => {
    const send = vi.fn(), open = vi.fn(), theme = vi.fn();
    const root = fakeRoot();
    initActions({ send, open, theme }, root as any);

    root.fire("click", { target: el({ "data-click": "open" }) });
    root.fire("change", { target: el({ "data-change": "theme", "data-args": '["@value"]' }, "stardew") });
    expect(open).toHaveBeenCalledTimes(1);
    expect(theme.mock.calls).toEqual([["stardew"]]);

    const input = el({ "data-enter": "send" });
    root.fire("keydown", { key: "a", target: input });
    expect(send).not.toHaveBeenCalled();
    root.fire("keydown", { key: "Enter", target: input });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
