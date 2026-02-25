/**
 * LanceDB operations for agent memories.
 * L0/L1/L2 tiered schema with category-filtered vector search.
 */

import * as lancedb from "@lancedb/lancedb";
import { randomUUID } from "node:crypto";
import {
  MEMORY_CATEGORIES,
  type AgentMemoryRow,
  type MemoryCategory,
  type PluginLogger,
} from "./types.js";
import { type DecayConfigType, DEFAULTS } from "./config.js";

const TABLE_NAME = "agent_memories";

// --- Input sanitization (CRITICAL: prevents LanceDB filter injection) ---
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = new Set<string>(MEMORY_CATEGORIES);

export function assertCategory(value: string): void {
  if (!VALID_CATEGORIES.has(value)) {
    throw new Error(`Invalid memory category: ${value}`);
  }
}

export function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid UUID: ${value}`);
  }
}

function rowToEntry(row: Record<string, unknown>): AgentMemoryRow {
  return {
    id: row.id as string,
    category: row.category as MemoryCategory,
    abstract: row.abstract as string,
    overview: row.overview as string,
    content: row.content as string,
    vector: Array.from(row.vector as Iterable<number>),
    source_session: row.source_session as string,
    active_count: row.active_count as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

/**
 * Computes decay-adjusted score for memory search results.
 *
 * Formula:
 *   decayScore = vectorScore * timeDecay * activeBoost
 *
 * Where:
 *   - timeDecay = 2^(-ageDays / halfLifeDays)  (exponential decay)
 *   - activeBoost = 1 + activeWeight * log(1 + activeCount)  (logarithmic boost)
 *
 * @param vectorScore - Original similarity score from vector search (0-1)
 * @param createdAt - Memory creation timestamp in milliseconds
 * @param activeCount - Number of times this memory was activated/recalled
 * @param config - Decay configuration
 * @returns Decay-adjusted score
 */
export function computeDecayScore(
  vectorScore: number,
  createdAt: number,
  activeCount: number,
  config: Required<DecayConfigType>,
): number {
  if (!config.enabled) return vectorScore;

  const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  const timeDecay = Math.pow(2, -ageDays / config.halfLifeDays);
  const activeBoost = 1 + config.activeWeight * Math.log(1 + activeCount);

  return vectorScore * timeDecay * activeBoost;
}

export type MemorySearchResult = {
  entry: AgentMemoryRow;
  score: number;
};

export class MemoryDB {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly decayConfig: Required<DecayConfigType>;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
    private readonly logger: PluginLogger,
    decayConfig?: DecayConfigType,
  ) {
    // Merge provided config with defaults
    this.decayConfig = {
      enabled: decayConfig?.enabled ?? DEFAULTS.decay.enabled,
      halfLifeDays: decayConfig?.halfLifeDays ?? DEFAULTS.decay.halfLifeDays,
      activeWeight: decayConfig?.activeWeight ?? DEFAULTS.decay.activeWeight,
    };
  }

  /** Serialize all write operations to prevent concurrent read-modify-write races. */
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let resolve!: () => void;
    this.writeLock = new Promise<void>((r) => {
      resolve = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
    }
  }

  private async ensureInit(): Promise<void> {
    if (this.table) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();

    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);

      // Verify existing table's vector dimensions match configured dimensions
      const sample = await this.table.query().limit(1).toArray();
      if (sample.length > 0) {
        const existingDim = (sample[0].vector as number[]).length;
        if (existingDim !== this.vectorDim) {
          throw new Error(
            `epro-memory: vector dimension mismatch — DB has ${existingDim}-dim vectors ` +
              `but config expects ${this.vectorDim}. ` +
              `Change embedding.dimensions or delete the DB to recreate.`,
          );
        }
      }
    } else {
      // Create table with schema row then delete it
      this.table = await this.db.createTable(TABLE_NAME, [
        {
          id: "__schema__",
          category: "patterns",
          abstract: "",
          overview: "",
          content: "",
          vector: new Array(this.vectorDim).fill(0),
          source_session: "",
          active_count: 0,
          created_at: 0,
          updated_at: 0,
        },
      ]);
      await this.table.delete('id = "__schema__"');
      this.logger.info("epro-memory: created agent_memories table");
    }
  }

  async store(
    entry: Omit<
      AgentMemoryRow,
      "id" | "created_at" | "updated_at" | "active_count"
    >,
  ): Promise<AgentMemoryRow> {
    await this.ensureInit();

    // Validate vector dimensions before storing
    if (entry.vector.length !== this.vectorDim) {
      throw new Error(
        `epro-memory: vector dimension mismatch — got ${entry.vector.length}-dim vector ` +
          `but DB expects ${this.vectorDim}`,
      );
    }

    const now = Date.now();
    const row: AgentMemoryRow = {
      ...entry,
      id: randomUUID(),
      active_count: 0,
      created_at: now,
      updated_at: now,
    };
    await this.table!.add([row]);
    return row;
  }

  async search(
    vector: number[],
    limit: number = 5,
    minScore: number = 0.3,
    categoryFilter?: MemoryCategory,
    skipDecay?: boolean,
  ): Promise<MemorySearchResult[]> {
    await this.ensureInit();

    // When decay is active, over-fetch to compensate for re-ranking
    const useDecay = !skipDecay && this.decayConfig.enabled;
    const fetchLimit = useDecay ? Math.max(limit * 3, 20) : limit;

    let query = this.table!.vectorSearch(vector).limit(fetchLimit);

    if (categoryFilter) {
      assertCategory(categoryFilter);
      query = query.where(`category = '${categoryFilter}'`);
    }

    const results = await query.toArray();

    return results
      .map((row) => {
        const distance = (row._distance as number) ?? 0;
        const vectorScore = 1 / (1 + distance);
        const entry = rowToEntry(row as Record<string, unknown>);

        const score = useDecay
          ? computeDecayScore(vectorScore, entry.created_at, entry.active_count, this.decayConfig)
          : vectorScore;

        return { entry, score };
      })
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= minScore)
      .slice(0, limit);
  }

  async findByCategory(category: MemoryCategory): Promise<AgentMemoryRow[]> {
    await this.ensureInit();
    assertCategory(category);
    const results = await this.table!.query()
      .where(`category = '${category}'`)
      .limit(100)
      .toArray();

    return results.map((row) => rowToEntry(row as Record<string, unknown>));
  }

  async getById(id: string): Promise<AgentMemoryRow | null> {
    await this.ensureInit();
    assertUuid(id);
    const results = await this.table!.query()
      .where(`id = '${id}'`)
      .limit(1)
      .toArray();
    if (results.length === 0) return null;
    return rowToEntry(results[0] as Record<string, unknown>);
  }

  async update(id: string, fields: Partial<AgentMemoryRow>): Promise<void> {
    await this.ensureInit();
    assertUuid(id);
    await this.withWriteLock(async () => {
      const existing = await this.table!.query()
        .where(`id = '${id}'`)
        .limit(1)
        .toArray();

      if (existing.length === 0) return;

      // Strip Arrow/Lance internal fields via rowToEntry before writing back
      const clean = rowToEntry(existing[0] as Record<string, unknown>);
      // Prevent callers from overwriting immutable fields
      const {
        id: _id,
        created_at: _ca,
        source_session: _ss,
        ...safeFields
      } = fields;
      const updated = { ...clean, ...safeFields, updated_at: Date.now() };
      // Delete then add with same ID; restore original on add failure
      await this.table!.delete(`id = '${id}'`);
      try {
        await this.table!.add([updated]);
      } catch (err) {
        await this.table!.add([clean]);
        throw err;
      }
    });
  }

  async incrementActiveCount(id: string): Promise<void> {
    await this.ensureInit();
    assertUuid(id);
    await this.withWriteLock(async () => {
      const existing = await this.table!.query()
        .where(`id = '${id}'`)
        .limit(1)
        .toArray();

      if (existing.length === 0) return;

      // Strip Arrow/Lance internal fields via rowToEntry before writing back
      const clean = rowToEntry(existing[0] as Record<string, unknown>);
      const updated = {
        ...clean,
        active_count: (clean.active_count || 0) + 1,
        updated_at: Date.now(),
      };
      // Delete then add with same ID; restore original on add failure
      await this.table!.delete(`id = '${id}'`);
      try {
        await this.table!.add([updated]);
      } catch (err) {
        await this.table!.add([clean]);
        throw err;
      }
    });
  }

  /**
   * Get all memories from the database.
   * Used by QMD projection to generate daily summaries.
   *
   * @param maxLimit - Maximum number of records to return (default: 10000)
   * @returns Array of all memory entries
   */
  async getAll(maxLimit: number = 10000): Promise<AgentMemoryRow[]> {
    await this.ensureInit();
    const results = await this.table!.query().limit(maxLimit).toArray();
    return results.map((row) => rowToEntry(row as Record<string, unknown>));
  }
}
