/**
 * Memory extraction orchestrator.
 * Pipeline: extract candidates -> dedup -> persist to LanceDB.
 * Ported from OpenViking's compressor.py.
 */

import type { MemoryDB } from "./db.js";
import type { MemoryDeduplicator } from "./deduplicator.js";
import type { Embeddings } from "./embeddings.js";
import type { LlmClient } from "./llm.js";
import { buildExtractionPrompt, buildMergePrompt } from "./prompts.js";
import {
  ALWAYS_MERGE_CATEGORIES,
  MERGE_SUPPORTED_CATEGORIES,
  MEMORY_CATEGORIES,
  type CandidateMemory,
  type ExtractionStats,
  type MemoryCategory,
  type PluginLogger,
} from "./types.js";

export class MemoryExtractor {
  constructor(
    private db: MemoryDB,
    private embeddings: Embeddings,
    private llm: LlmClient,
    private deduplicator: MemoryDeduplicator,
    private logger: PluginLogger,
  ) {}

  async extractAndPersist(
    conversationText: string,
    sessionKey: string,
    user: string,
  ): Promise<ExtractionStats> {
    const stats: ExtractionStats = { created: 0, merged: 0, skipped: 0 };

    // Step 1: LLM extraction
    const candidates = await this.extractCandidates(conversationText, user);
    if (candidates.length === 0) return stats;

    this.logger.info(
      `epro-memory: extracted ${candidates.length} candidate memories`,
    );

    // Step 2: Process each candidate
    for (const candidate of candidates) {
      try {
        await this.processCandidate(candidate, sessionKey, stats);
      } catch (err) {
        this.logger.warn(
          `epro-memory: failed to process ${candidate.category} memory: ${String(err)}`,
        );
        stats.skipped++;
      }
    }

    this.logger.info(
      `epro-memory: created=${stats.created}, merged=${stats.merged}, skipped=${stats.skipped}`,
    );
    return stats;
  }

  private async extractCandidates(
    conversationText: string,
    user: string,
  ): Promise<CandidateMemory[]> {
    const prompt = buildExtractionPrompt(conversationText, user);

    const data = await this.llm.completeJson<{
      memories: Array<{
        category: string;
        abstract: string;
        overview: string;
        content: string;
      }>;
    }>(prompt);

    if (!data?.memories) return [];

    const validCategories = new Set<string>(MEMORY_CATEGORIES);

    return data.memories
      .filter(
        (m) =>
          m.category &&
          m.abstract &&
          m.content &&
          validCategories.has(m.category),
      )
      .map((m) => ({
        category: m.category as MemoryCategory,
        abstract: m.abstract,
        overview: m.overview || "",
        content: m.content,
      }));
  }

  private async processCandidate(
    candidate: CandidateMemory,
    sessionKey: string,
    stats: ExtractionStats,
  ): Promise<void> {
    // Profile: always merge, skip dedup
    if (ALWAYS_MERGE_CATEGORIES.has(candidate.category)) {
      await this.handleProfileMerge(candidate, sessionKey);
      stats.merged++;
      return;
    }

    // Other categories: embed + dedup
    const vector = await this.embeddings.embed(
      `${candidate.abstract} ${candidate.content}`,
    );

    const result = await this.deduplicator.deduplicate(candidate, vector);

    if (result.decision === "create") {
      await this.db.store({
        category: candidate.category,
        abstract: candidate.abstract,
        overview: candidate.overview,
        content: candidate.content,
        vector,
        source_session: sessionKey,
      });
      stats.created++;
    } else if (result.decision === "merge") {
      if (
        MERGE_SUPPORTED_CATEGORIES.has(candidate.category) &&
        result.matchId
      ) {
        await this.handleMerge(candidate, result.matchId);
        stats.merged++;
      } else {
        // events/cases don't support merge, treat as skip
        stats.skipped++;
      }
    } else {
      // skip
      stats.skipped++;
    }
  }

  private async handleProfileMerge(
    candidate: CandidateMemory,
    sessionKey: string,
  ): Promise<void> {
    const existing = await this.db.findByCategory("profile");

    if (existing.length === 0) {
      const vector = await this.embeddings.embed(
        `${candidate.abstract} ${candidate.content}`,
      );
      await this.db.store({
        category: "profile",
        abstract: candidate.abstract,
        overview: candidate.overview,
        content: candidate.content,
        vector,
        source_session: sessionKey,
      });
      return;
    }

    const target = existing[0];
    const merged = await this.mergeMemory(target, candidate);
    const mergedVector = await this.embeddings.embed(
      `${merged.abstract} ${merged.content}`,
    );

    await this.db.update(target.id, {
      abstract: merged.abstract,
      overview: merged.overview,
      content: merged.content,
      vector: mergedVector,
    });
  }

  private async handleMerge(
    candidate: CandidateMemory,
    matchId: string,
  ): Promise<void> {
    const target = await this.db.getById(matchId);
    if (!target) return;

    const merged = await this.mergeMemory(target, candidate);
    const mergedVector = await this.embeddings.embed(
      `${merged.abstract} ${merged.content}`,
    );

    await this.db.update(matchId, {
      abstract: merged.abstract,
      overview: merged.overview,
      content: merged.content,
      vector: mergedVector,
    });
  }

  private async mergeMemory(
    existing: { abstract: string; overview: string; content: string },
    candidate: CandidateMemory,
  ): Promise<{ abstract: string; overview: string; content: string }> {
    const prompt = buildMergePrompt(
      existing.abstract,
      existing.overview,
      existing.content,
      candidate.abstract,
      candidate.overview,
      candidate.content,
      candidate.category,
    );
    const data = await this.llm.completeJson<{
      abstract: string;
      overview: string;
      content: string;
    }>(prompt);
    if (data?.abstract && data?.content) {
      return {
        abstract: data.abstract,
        overview: data.overview || candidate.overview,
        content: data.content,
      };
    }
    // Fallback: keep candidate's L0/L1 with candidate's L2
    return {
      abstract: candidate.abstract,
      overview: candidate.overview,
      content: candidate.content,
    };
  }
}
