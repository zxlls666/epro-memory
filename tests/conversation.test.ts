import { describe, it, expect } from "vitest";
import { extractConversationText } from "../index.js";

describe("extractConversationText", () => {
  it("extracts string content messages", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = extractConversationText(messages, 10000);
    expect(result).toBe("Human: Hello\n\nAssistant: Hi there");
  });

  it("extracts Anthropic content block arrays", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "What is 2+2?" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "4" }],
      },
    ];
    const result = extractConversationText(messages, 10000);
    expect(result).toBe("Human: What is 2+2?\n\nAssistant: 4");
  });

  it("skips non-text content blocks", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image", source: "data:..." },
          { type: "text", text: "Describe this" },
        ],
      },
    ];
    const result = extractConversationText(messages, 10000);
    expect(result).toBe("Human: Describe this");
  });

  it("skips system messages", () => {
    const messages = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ];
    const result = extractConversationText(messages, 10000);
    expect(result).toBe("Human: Hi");
  });

  it("truncates to maxChars with ellipsis", () => {
    const messages = [
      { role: "user", content: "A".repeat(100) },
    ];
    const result = extractConversationText(messages, 20);
    expect(result.length).toBeLessThanOrEqual(21); // 20 + ellipsis char
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("does not truncate when under maxChars", () => {
    const messages = [{ role: "user", content: "Short" }];
    const result = extractConversationText(messages, 10000);
    expect(result).toBe("Human: Short");
    expect(result.endsWith("\u2026")).toBe(false);
  });

  it("handles surrogate pairs at truncation boundary", () => {
    // \uD83D\uDE00 is 😀 (2 code units)
    const emoji = "\uD83D\uDE00";
    const messages = [{ role: "user", content: `A${emoji}B` }];
    // "Human: A😀B" = 12 code units. Truncate at 9 = "Human: A" + high surrogate
    const result = extractConversationText(messages, 9);
    // Should not end with a lone high surrogate
    const lastCode = result.charCodeAt(result.length - 2); // before ellipsis
    const isLoneSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
    expect(isLoneSurrogate).toBe(false);
  });

  it("skips null and non-object messages", () => {
    const messages = [null, undefined, "string", 42, { role: "user", content: "OK" }];
    const result = extractConversationText(messages as unknown[], 10000);
    expect(result).toBe("Human: OK");
  });

  it("returns empty string for no extractable messages", () => {
    const result = extractConversationText([], 10000);
    expect(result).toBe("");
  });
});
