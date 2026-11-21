import { describe, expect, it } from "vitest";

import { splitDescription } from "../../frontend/js/descriptionParts.js";

describe("splitDescription", () => {
  it("puts the app's notes apart from what the AI wrote", () => {
    const text = 'Search for and buy round-trip tickets.\nFrom chat: "I want to travel to New York"\nEstimated: 3 h';
    expect(splitDescription(text)).toEqual({ main: "Search for and buy round-trip tickets.", notes: 'From chat: "I want to travel to New York"\nEstimated: 3 h' });
  });

  it("knows the Chinese notes too", () => {
    expect(splitDescription("复习第三章\n来自对话：\"帮我安排复习\"\n预计耗时 2 小时")).toEqual({ main: "复习第三章", notes: "来自对话：\"帮我安排复习\"\n预计耗时 2 小时" });
  });

  it("leaves a plain description whole, and handles notes without a description", () => {
    expect(splitDescription("Room 204\nBring laptop")).toEqual({ main: "Room 204\nBring laptop", notes: "" });
    expect(splitDescription("Estimated: 1 h")).toEqual({ main: "", notes: "Estimated: 1 h" });
    expect(splitDescription(null)).toEqual({ main: "", notes: "" });
  });
});
