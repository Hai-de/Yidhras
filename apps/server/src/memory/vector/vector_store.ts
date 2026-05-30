import type { PrismaClient } from '@prisma/client';

import type {
  MemoryBlock,
  MemoryVectorSearchInput,
  MemoryVectorSearchResult
} from '../blocks/types.js';

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((v): v is number => typeof v === 'number' && Number.isFinite(v))
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.trunc(limit), MAX_LIMIT);
}

type PrismaMemoryBlockRow = {
  id: string;
  owner_agent_id: string;
  pack_id: string | null;
  kind: string;
  status: string;
  title: string | null;
  content_text: string;
  content_structured: unknown;
  tags: string;
  keywords: string;
  source_ref: unknown;
  importance: number;
  salience: number;
  confidence: number | null;
  embedding: string | null;
  embedding_model: string | null;
  created_at_tick: bigint;
  updated_at_tick: bigint;
};

function rowToBlock(row: PrismaMemoryBlockRow): MemoryBlock {
  let tags: string[] = [];
  if (typeof row.tags === 'string' && row.tags.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        tags = parsed.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
      }
    } catch {
      // keep empty
    }
  }

  let keywords: string[] = [];
  if (typeof row.keywords === 'string' && row.keywords.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.keywords);
      if (Array.isArray(parsed)) {
        keywords = parsed.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
      }
    } catch {
      // keep empty
    }
  }

  return {
    id: row.id,
    owner_agent_id: row.owner_agent_id,
    pack_id: row.pack_id,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    kind: row.kind as MemoryBlock['kind'],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    status: row.status as MemoryBlock['status'],
    title: row.title,
    content_text: row.content_text,
    content_structured:
      row.content_structured && typeof row.content_structured === 'object' && !Array.isArray(row.content_structured)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
        ? (row.content_structured as Record<string, unknown>)
        : null,
    tags,
    keywords,
    source_ref:
      row.source_ref && typeof row.source_ref === 'object' && !Array.isArray(row.source_ref)
        ? (row.source_ref)
        : null,
    importance: row.importance,
    salience: row.salience,
    confidence: row.confidence,
    embedding: parseEmbedding(row.embedding),
    embedding_model: row.embedding_model,
    created_at_tick: row.created_at_tick.toString(),
    updated_at_tick: row.updated_at_tick.toString()
  };
}

export interface VectorStore {
  searchByEmbedding(input: MemoryVectorSearchInput): Promise<MemoryVectorSearchResult[]>;
}

export const createVectorStore = (prisma: PrismaClient): VectorStore => {
  return {
    async searchByEmbedding(input: MemoryVectorSearchInput): Promise<MemoryVectorSearchResult[]> {
      const queryEmbedding = input.query_embedding;
      if (!queryEmbedding || queryEmbedding.length === 0) {
        return [];
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      const rows = await prisma.memoryBlock.findMany({
        where: {
          owner_agent_id: input.owner_agent_id,
          ...(input.pack_id === undefined || input.pack_id === null ? {} : { pack_id: input.pack_id }),
          status: 'active',
          embedding: { not: null }
        },
        take: 200
      }) as unknown as PrismaMemoryBlockRow[];

      const threshold = input.threshold ?? DEFAULT_THRESHOLD;
      const limit = normalizeLimit(input.limit);

      const scored: MemoryVectorSearchResult[] = [];

      for (const row of rows) {
        const embedding = parseEmbedding(row.embedding);
        if (!embedding || embedding.length !== queryEmbedding.length) {
          continue;
        }

        const similarity = cosineSimilarity(queryEmbedding, embedding);
        if (similarity >= threshold) {
          scored.push({
            block: rowToBlock(row),
            similarity
          });
        }
      }

      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, limit);
    }
  };
};
