import { describe, it, expect } from "vitest";
import { assertCategory, assertUuid } from "../db.js";

describe("assertCategory", () => {
  const validCategories = [
    "profile",
    "preferences",
    "entities",
    "events",
    "cases",
    "patterns",
  ];

  for (const cat of validCategories) {
    it(`accepts: ${cat}`, () => {
      expect(() => assertCategory(cat)).not.toThrow();
    });
  }

  it("rejects SQL injection string", () => {
    expect(() => assertCategory("profile' OR '1'='1")).toThrow(
      "Invalid memory category",
    );
  });

  it("rejects empty string", () => {
    expect(() => assertCategory("")).toThrow("Invalid memory category");
  });

  it("rejects arbitrary string", () => {
    expect(() => assertCategory("notacategory")).toThrow(
      "Invalid memory category",
    );
  });

  it("rejects category with whitespace", () => {
    expect(() => assertCategory(" profile")).toThrow(
      "Invalid memory category",
    );
  });

  it("rejects uppercase variant", () => {
    expect(() => assertCategory("Profile")).toThrow(
      "Invalid memory category",
    );
  });
});

describe("assertUuid", () => {
  it("accepts valid UUID v4", () => {
    expect(() =>
      assertUuid("550e8400-e29b-41d4-a716-446655440000"),
    ).not.toThrow();
  });

  it("accepts uppercase UUID", () => {
    expect(() =>
      assertUuid("550E8400-E29B-41D4-A716-446655440000"),
    ).not.toThrow();
  });

  it("accepts mixed case UUID", () => {
    expect(() =>
      assertUuid("550e8400-E29B-41d4-a716-446655440000"),
    ).not.toThrow();
  });

  it("rejects SQL injection string", () => {
    expect(() =>
      assertUuid("'; DROP TABLE agent_memories; --"),
    ).toThrow("Invalid UUID");
  });

  it("rejects empty string", () => {
    expect(() => assertUuid("")).toThrow("Invalid UUID");
  });

  it("rejects partial UUID", () => {
    expect(() => assertUuid("550e8400-e29b")).toThrow("Invalid UUID");
  });

  it("rejects UUID without dashes", () => {
    expect(() =>
      assertUuid("550e8400e29b41d4a716446655440000"),
    ).toThrow("Invalid UUID");
  });

  it("rejects UUID with extra characters", () => {
    expect(() =>
      assertUuid("550e8400-e29b-41d4-a716-446655440000x"),
    ).toThrow("Invalid UUID");
  });
});
