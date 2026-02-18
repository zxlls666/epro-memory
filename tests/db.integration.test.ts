import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDB } from "../db.js";
import type { MemoryCategory, PluginLogger } from "../types.js";

/**
 * Real LanceDB integration tests.
 *
 * Run with:
 *   RUN_LANCEDB_INTEGRATION=1 npm run test:integration
 *
 * Default `npm test` will skip this file.
 */
const describeIfIntegration =
  process.env.RUN_LANCEDB_INTEGRATION === "1" ? describe : describe.skip;

const logger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

let dbPath = "";
let db: MemoryDB;

function makeEntry(category: MemoryCategory, n: number) {
  return {
    category,
    abstract: `${category}-abstract-${n}`,
    overview: `## ${category} overview ${n}`,
    content: `${category} content ${n}`,
    vector: [n, n + 0.1, n + 0.2],
    source_session: `session-${n}`,
  };
}

describeIfIntegration("MemoryDB (LanceDB integration)", () => {
  beforeEach(async () => {
    dbPath = await mkdtemp(join(tmpdir(), "epro-memory-it-"));
    db = new MemoryDB(dbPath, 3, logger);
  });

  afterEach(async () => {
    if (!dbPath) return;
    await rm(dbPath, { recursive: true, force: true }).catch(() => {});
  });

  it("stores and reads back a row by id", async () => {
    const stored = await db.store(makeEntry("events", 1));
    const loaded = await db.getById(stored.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(stored.id);
    expect(loaded?.category).toBe("events");
    expect(loaded?.abstract).toBe("events-abstract-1");
  });

  it("findByCategory returns only matching category rows", async () => {
    await db.store(makeEntry("events", 1));
    await db.store(makeEntry("events", 2));
    await db.store(makeEntry("profile", 3));

    const events = await db.findByCategory("events");
    const profiles = await db.findByCategory("profile");

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((r) => r.category === "events")).toBe(true);
    expect(profiles.length).toBeGreaterThanOrEqual(1);
    expect(profiles.every((r) => r.category === "profile")).toBe(true);
  });

  it("search returns nearest rows with score filtering", async () => {
    const a = await db.store(makeEntry("events", 1));
    await db.store(makeEntry("events", 10));

    const hits = await db.search([1, 1.1, 1.2], 5, 0.1, "events");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.entry.id === a.id)).toBe(true);
    expect(hits.every((h) => h.entry.category === "events")).toBe(true);
    expect(hits.every((h) => h.score >= 0.1)).toBe(true);
  });

  it("incrementActiveCount increments count without schema error", async () => {
    const stored = await db.store(makeEntry("events", 1));
    await db.incrementActiveCount(stored.id);

    const loaded = await db.getById(stored.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.active_count).toBe(1);
    expect(loaded!.id).toBe(stored.id);
  });

  it("update persists changed fields with stable ID", async () => {
    const stored = await db.store(makeEntry("events", 1));
    await db.update(stored.id, { abstract: "updated-abstract" });

    const loaded = await db.getById(stored.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.abstract).toBe("updated-abstract");
    expect(loaded!.id).toBe(stored.id);
  });

  it("update ignores attempts to overwrite id, created_at, source_session", async () => {
    const stored = await db.store(makeEntry("events", 1));
    const originalId = stored.id;
    const originalCreatedAt = stored.created_at;
    const originalSession = stored.source_session;

    await db.update(stored.id, {
      abstract: "changed",
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      created_at: 0,
      source_session: "hijacked",
    } as any);

    const loaded = await db.getById(originalId);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(originalId);
    expect(loaded!.created_at).toBe(originalCreatedAt);
    expect(loaded!.source_session).toBe(originalSession);
    expect(loaded!.abstract).toBe("changed");
  });

  it("concurrent incrementActiveCount is lossless", async () => {
    const stored = await db.store(makeEntry("events", 1));
    const burst = 20;

    await Promise.all(
      Array.from({ length: burst }, () => db.incrementActiveCount(stored.id)),
    );

    // Write lock serializes all increments; ID stays stable throughout.
    const loaded = await db.getById(stored.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(stored.id);
    expect(loaded!.active_count).toBe(burst);
  });
});
