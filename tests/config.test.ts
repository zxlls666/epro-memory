import { describe, it, expect } from "vitest";
import { parseConfig, DEFAULTS, vectorDimsForModel } from "../config.js";

describe("parseConfig", () => {
  it("throws when embedding.apiKey is missing", () => {
    expect(() => parseConfig({})).toThrow("embedding.apiKey is required");
  });

  it("throws when embedding.apiKey is empty string", () => {
    expect(() =>
      parseConfig({ embedding: { apiKey: "" }, llm: { apiKey: "k" } }),
    ).toThrow("embedding.apiKey is required");
  });

  it("throws when llm.apiKey is missing", () => {
    expect(() => parseConfig({ embedding: { apiKey: "k" } })).toThrow(
      "llm.apiKey is required",
    );
  });

  it("throws when llm.apiKey is empty string", () => {
    expect(() =>
      parseConfig({ embedding: { apiKey: "k" }, llm: { apiKey: "" } }),
    ).toThrow("llm.apiKey is required");
  });

  it("returns config with valid keys", () => {
    const cfg = parseConfig({
      embedding: { apiKey: "embed-key" },
      llm: { apiKey: "llm-key" },
    });
    expect(cfg.embedding.apiKey).toBe("embed-key");
    expect(cfg.llm.apiKey).toBe("llm-key");
  });

  it("preserves optional values", () => {
    const cfg = parseConfig({
      embedding: { apiKey: "k", model: "custom" },
      llm: { apiKey: "k" },
      recallLimit: 10,
      autoRecall: false,
    });
    expect(cfg.embedding.model).toBe("custom");
    expect(cfg.recallLimit).toBe(10);
    expect(cfg.autoRecall).toBe(false);
  });
});

describe("vectorDimsForModel", () => {
  it("returns 1536 for text-embedding-3-small", () => {
    expect(vectorDimsForModel("text-embedding-3-small")).toBe(1536);
  });

  it("returns 3072 for text-embedding-3-large", () => {
    expect(vectorDimsForModel("text-embedding-3-large")).toBe(3072);
  });

  it("returns 1536 as fallback for unknown model", () => {
    expect(vectorDimsForModel("nomic-embed-text")).toBe(1536);
  });
});

describe("DEFAULTS", () => {
  it("has expected values", () => {
    expect(DEFAULTS.embeddingModel).toBe("text-embedding-3-small");
    expect(DEFAULTS.llmModel).toBe("gpt-4o-mini");
    expect(DEFAULTS.autoCapture).toBe(true);
    expect(DEFAULTS.autoRecall).toBe(true);
    expect(DEFAULTS.recallLimit).toBe(5);
    expect(DEFAULTS.recallMinScore).toBe(0.3);
    expect(DEFAULTS.extractMinMessages).toBe(4);
    expect(DEFAULTS.extractMaxChars).toBe(8000);
  });
});
