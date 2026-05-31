import type { PrismaClient } from '@prisma/client';
import type { DbContext } from '../../../utils/db_context.js';

import { createPrismaLongMemoryBlockStore } from '../../../memory/blocks/store.js';
import type {
  DeleteMemoryBlockInput,
  LongMemoryBlockStore,
  MemoryBlockCandidateQuery,
  MemoryBlockRecord,
  MemoryBlockUpsertInput,
  MemoryRuntimeState,
  MemoryVectorSearchInput,
  MemoryVectorSearchResult
} from '../../../memory/blocks/types.js';
import { createPrismaLongTermMemoryStore } from '../../../memory/long_term_store.js';
import type {
  LongTermMemorySearchInput,
  LongTermMemoryStore,
  MemoryEntry
} from '../../../memory/types.js';
import { createVectorStore, type VectorStore } from '../../../memory/vector/vector_store.js';

export type {
  LongTermMemorySearchInput,
  MemoryBlockCandidateQuery,
  MemoryBlockRecord,
  MemoryBlockUpsertInput,
  MemoryEntry
};

export interface MemoryRepository {
  listCandidateBlocks(input: MemoryBlockCandidateQuery): Promise<MemoryBlockRecord[]>;
  upsertBlock(input: MemoryBlockUpsertInput): Promise<MemoryBlockRecord>;
  updateRuntimeState(state: MemoryRuntimeState): Promise<MemoryRuntimeState>;
  hardDeleteBlock(input: DeleteMemoryBlockInput): Promise<void>;
  searchLongTerm(input: LongTermMemorySearchInput): Promise<MemoryEntry[]>;

  // Compaction state
  getCompactionState(agentId: string): Promise<{ agent_id: string; inference_count_since_summary: number; inference_count_since_compaction: number; last_summary_tick: bigint | null; last_compaction_tick: bigint | null; updated_at_tick: bigint } | null>;
  upsertCompactionState(input: { agent_id: string; pack_id?: string | null; inference_count_since_summary: number; inference_count_since_compaction: number; updated_at_tick: bigint }): Promise<{ inference_count_since_summary: number; inference_count_since_compaction: number; last_summary_tick: bigint | null; last_compaction_tick: bigint | null }>;
  updateCompactionState(agentId: string, data: Record<string, unknown>): Promise<{ inference_count_since_summary: number; inference_count_since_compaction: number; last_summary_tick: bigint | null; last_compaction_tick: bigint | null }>;
  listActiveMemoryBlocks(packId?: string | null, limit?: number): Promise<Array<{ id: string; kind: string; title: string | null; content_text: string; tags: string; created_at_tick: bigint; updated_at_tick: bigint }>>;

  searchBySimilarity(input: MemoryVectorSearchInput): Promise<MemoryVectorSearchResult[]>;
}

export class PrismaMemoryRepository implements MemoryRepository {
  private readonly blockStore: LongMemoryBlockStore;
  private readonly longTermStore: LongTermMemoryStore;
  private readonly vectorStore: VectorStore;

  constructor(private readonly prisma: PrismaClient) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const ctx = { prisma } as DbContext;
    this.blockStore = createPrismaLongMemoryBlockStore(ctx);
    this.longTermStore = createPrismaLongTermMemoryStore(ctx);
    this.vectorStore = createVectorStore(prisma);
  }

  async listCandidateBlocks(input: MemoryBlockCandidateQuery): Promise<MemoryBlockRecord[]> {
    return this.blockStore.listCandidateBlocks(input);
  }

  async upsertBlock(input: MemoryBlockUpsertInput): Promise<MemoryBlockRecord> {
    return this.blockStore.upsertBlock(input);
  }

  async updateRuntimeState(state: MemoryRuntimeState): Promise<MemoryRuntimeState> {
    return this.blockStore.updateRuntimeState(state);
  }

  async hardDeleteBlock(input: DeleteMemoryBlockInput): Promise<void> {
    return this.blockStore.hardDeleteBlock(input);
  }

  async searchLongTerm(input: LongTermMemorySearchInput): Promise<MemoryEntry[]> {
    return this.longTermStore.search(input);
  }

  // -- Compaction state --

  async getCompactionState(agentId: string): Promise<{ agent_id: string; inference_count_since_summary: number; inference_count_since_compaction: number; last_summary_tick: bigint | null; last_compaction_tick: bigint | null; updated_at_tick: bigint } | null> {
    return this.prisma.memoryCompactionState.findUnique({ where: { agent_id: agentId } });
  }

  async upsertCompactionState(input: { agent_id: string; pack_id?: string | null; inference_count_since_summary: number; inference_count_since_compaction: number; updated_at_tick: bigint }): Promise<{ inference_count_since_summary: number; inference_count_since_compaction: number; last_summary_tick: bigint | null; last_compaction_tick: bigint | null }> {
    return this.prisma.memoryCompactionState.upsert({
      where: { agent_id: input.agent_id },
      update: {
        pack_id: input.pack_id ?? null,
        inference_count_since_summary: { increment: input.inference_count_since_summary },
        inference_count_since_compaction: { increment: input.inference_count_since_compaction },
        updated_at_tick: input.updated_at_tick
      },
      create: {
        agent_id: input.agent_id,
        pack_id: input.pack_id ?? null,
        inference_count_since_summary: input.inference_count_since_summary,
        inference_count_since_compaction: input.inference_count_since_compaction,
        updated_at_tick: input.updated_at_tick
      }
    });
  }

  async updateCompactionState(agentId: string, data: Record<string, unknown>): Promise<{ inference_count_since_summary: number; inference_count_since_compaction: number; last_summary_tick: bigint | null; last_compaction_tick: bigint | null }> {
    return this.prisma.memoryCompactionState.update({
      where: { agent_id: agentId },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      data: data as never
    });
  }

  async listActiveMemoryBlocks(packId?: string | null, limit?: number): Promise<Array<{ id: string; kind: string; title: string | null; content_text: string; tags: string; created_at_tick: bigint; updated_at_tick: bigint }>> {
    return this.prisma.memoryBlock.findMany({
      where: { ...(packId ? { pack_id: packId } : {}), status: 'active' },
      orderBy: [{ updated_at_tick: 'desc' }, { created_at_tick: 'desc' }],
      take: limit ?? 10
    });
  }

  async searchBySimilarity(input: MemoryVectorSearchInput): Promise<MemoryVectorSearchResult[]> {
    return this.vectorStore.searchByEmbedding(input);
  }
}
