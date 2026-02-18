/**
 * LanceDB operations for agent memories.
 * L0/L1/L2 tiered schema with category-filtered vector search.
 */

import * as lancedb from "@lancedb/lancedb";
import { randomUUID } from "node:crypto";
import type { AgentMemoryRow, MemoryCategory, PluginLogger } from "./types.js";

const TABLE_NAME = "agent_memories";

export type MemorySearchResult = {
  entry: AgentMemoryRow;
  score: number;
};

export class MemoryDB {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
    private readonly logger: PluginLogger,
  ) {}

  private async ensureInit(): Promise<void> {
    if (this.table) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();

    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
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
    entry: Omit<AgentMemoryRow, "id" | "created_at" | "updated_at" | "active_count">,
  ): Promise<AgentMemoryRow> {
    await this.ensureInit();
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
  ): Promise<MemorySearchResult[]> {
    await this.ensureInit();

    let query = this.table!.vectorSearch(vector).limit(limit);

    if (categoryFilter) {
      query = query.where(`category = '${categoryFilter}'`);
    }

    const results = await query.toArray();

    return results
      .map((row) => {
        const distance = (row._distance as number) ?? 0;
        const score = 1 / (1 + distance);
        return {
          entry: {
            id: row.id as string,
            category: row.category as MemoryCategory,
            abstract: row.abstract as string,
            overview: row.overview as string,
            content: row.content as string,
            vector: row.vector as number[],
            source_session: row.source_session as string,
            active_count: row.active_count as number,
            created_at: row.created_at as number,
            updated_at: row.updated_at as number,
          },
          score,
        };
      })
      .filter((r) => r.score >= minScore);
  }

  async findByCategory(category: MemoryCategory): Promise<AgentMemoryRow[]> {
    await this.ensureInit();
    const results = await this.table!.query()
      .where(`category = '${category}'`)
      .limit(100)
      .toArray();

    return results.map((row) => ({
      id: row.id as string,
      category: row.category as MemoryCategory,
      abstract: row.abstract as string,
      overview: row.overview as string,
      content: row.content as string,
      vector: row.vector as number[],
      source_session: row.source_session as string,
      active_count: row.active_count as number,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    }));
  }

  async update(id: string, fields: Partial<AgentMemoryRow>): Promise<void> {
    await this.ensureInit();
    // LanceDB update: delete + re-add
    const existing = await this.table!.query()
      .where(`id = '${id}'`)
      .limit(1)
      .toArray();

    if (existing.length === 0) return;

    const row = existing[0];
    const updated = {
      ...row,
      ...fields,
      updated_at: Date.now(),
    };

    await this.table!.delete(`id = '${id}'`);
    await this.table!.add([updated]);
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    await this.table!.delete(`id = '${id}'`);
    return true;
  }

  async incrementActiveCount(id: string): Promise<void> {
    await this.ensureInit();
    const existing = await this.table!.query()
      .where(`id = '${id}'`)
      .limit(1)
      .toArray();

    if (existing.length === 0) return;

    const row = existing[0];
    await this.table!.delete(`id = '${id}'`);
    await this.table!.add([
      {
        ...row,
        active_count: ((row.active_count as number) || 0) + 1,
        updated_at: Date.now(),
      },
    ]);
  }
}
