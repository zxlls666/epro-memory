import { describe, it, expect } from "vitest";
import { parseJsonFromResponse } from "../llm.js";

describe("parseJsonFromResponse", () => {
  // --- Direct JSON ---
  it("parses clean JSON object", () => {
    expect(parseJsonFromResponse('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses clean JSON array", () => {
    expect(parseJsonFromResponse("[1, 2]")).toEqual([1, 2]);
  });

  // --- Markdown fence ---
  it("parses JSON in ```json fence", () => {
    expect(
      parseJsonFromResponse('```json\n{"x": "hello"}\n```'),
    ).toEqual({ x: "hello" });
  });

  it("parses JSON in bare ``` fence", () => {
    expect(
      parseJsonFromResponse('```\n{"x": 1}\n```'),
    ).toEqual({ x: 1 });
  });

  // --- Balanced brace extraction ---
  it("extracts JSON from mixed text", () => {
    const input = 'Here is my answer:\n{"decision": "create", "reason": "new"}\nDone.';
    expect(parseJsonFromResponse(input)).toEqual({
      decision: "create",
      reason: "new",
    });
  });

  it("handles nested braces correctly", () => {
    const input = 'Result: {"a": {"b": 2}} end';
    expect(parseJsonFromResponse(input)).toEqual({ a: { b: 2 } });
  });

  it("handles trailing text with braces after valid JSON", () => {
    const input = '{"decision": "skip"} Note: threshold } was exceeded';
    expect(parseJsonFromResponse(input)).toEqual({ decision: "skip" });
  });

  it("handles deeply nested objects", () => {
    const input = '{"a":{"b":{"c":{"d":1}}}}';
    expect(parseJsonFromResponse(input)).toEqual({
      a: { b: { c: { d: 1 } } },
    });
  });

  // --- Failure cases ---
  it("returns null for garbage text", () => {
    expect(parseJsonFromResponse("this is not json at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJsonFromResponse("")).toBeNull();
  });

  it("returns null for unbalanced braces with invalid JSON", () => {
    expect(parseJsonFromResponse("{not: valid json}")).toBeNull();
  });

  // --- Edge cases ---
  it("handles JSON with string values containing braces", () => {
    const input = '{"code": "if (x) { return y; }"}';
    expect(parseJsonFromResponse(input)).toEqual({
      code: "if (x) { return y; }",
    });
  });

  it("prefers direct parse over fence extraction", () => {
    // Input is valid JSON on its own
    const input = '{"a": 1}';
    expect(parseJsonFromResponse(input)).toEqual({ a: 1 });
  });
});
