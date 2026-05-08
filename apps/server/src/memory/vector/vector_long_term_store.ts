import type { MemoryBlock } from '../blocks/types.js';
import type { LongTermMemorySearchInput, LongTermMemoryStore, MemoryEntry } from '../types.js';
import type { VectorStore } from './vector_store.js';

function blockToMemoryEntry(block: MemoryBlock): MemoryEntry {
  const titlePrefix = block.title && block.title.trim().length > 0 ? `${block.title.trim()}\n` : '';

  return {
    id: block.id,
    scope: 'long_term',
    actor_ref: null,
    source_kind: 'manual',
    source_ref: null,
    content: {
      text: `${titlePrefix}${block.content_text}`,
      ...(block.content_structured ? { structured: block.content_structured } : {})
    },
    tags: ['memory_block', `memory_kind:${block.kind}`, ...block.tags],
    importance: block.importance,
    salience: block.salience,
    confidence: block.confidence,
    visibility: {
      policy_gate: 'allow'
    },
    created_at: block.created_at_tick,
    occurred_at: block.updated_at_tick,
    metadata: {
      owner_agent_id: block.owner_agent_id,
      memory_kind: block.kind,
      title: block.title
    }
  };
}

export interface VectorLongTermMemoryStoreOptions {
  vectorStore: VectorStore;
  fallback: LongTermMemoryStore;
}

export const createVectorLongTermMemoryStore = ({
  vectorStore,
  fallback
}: VectorLongTermMemoryStoreOptions): LongTermMemoryStore => {
  return {
    async search(input: LongTermMemorySearchInput): Promise<MemoryEntry[]> {
      if (input.query_embedding && input.query_embedding.length > 0) {
        const agentId = input.actor_ref.agent_id;
        if (typeof agentId !== 'string' || agentId.trim().length === 0) {
          return [];
        }

        const results = await vectorStore.searchByEmbedding({
          owner_agent_id: agentId,
          query_embedding: input.query_embedding,
          limit: input.limit
        });

        if (results.length > 0) {
          return results.map(r => blockToMemoryEntry(r.block));
        }
      }

      return fallback.search(input);
    },
    save(entries: MemoryEntry[]): Promise<void> {
      return fallback.save(entries);
    }
  };
};
