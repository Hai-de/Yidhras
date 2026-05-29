import { describe, expect, it, vi } from 'vitest';

import {
  createNoopLongTermMemoryStore,
  createPrismaLongTermMemoryStore
} from '../../../src/memory/long_term_store.js';
import type { AppInfrastructure } from '../../../src/app/context.js';
import type { InferenceActorRef } from '../../../src/inference/types.js';

function makeActorRef(overrides: Partial<InferenceActorRef> = {}): InferenceActorRef {
  return {
    identity_id: 'id-1',
    identity_type: 'agent',
    role: 'active',
    agent_id: 'agent-1',
    atmosphere_node_id: null,
    ...overrides
  };
}

function makeMemoryBlockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    owner_agent_id: 'agent-1',
    kind: 'fact',
    title: 'Test Title',
    content_text: 'Some content',
    content_structured: { key: 'value' },
    tags: '["tag1","tag2"]',
    importance: 0.8,
    salience: 0.7,
    confidence: 0.9,
    created_at_tick: 100n,
    updated_at_tick: 200n,
    ...overrides
  };
}

function makeMockContext(findManyResult: unknown[] = []): AppInfrastructure {
  return {
    prisma: {
      memoryBlock: {
        findMany: vi.fn().mockResolvedValue(findManyResult)
      }
    }
  } as unknown as AppInfrastructure;
}

describe('memory/long_term_store', () => {
  describe('createNoopLongTermMemoryStore', () => {
    it('should return empty array from search', async () => {
      const store = createNoopLongTermMemoryStore();
      const result = await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 10
      });
      expect(result).toEqual([]);
    });

    it('should resolve void from save', async () => {
      const store = createNoopLongTermMemoryStore();
      await expect(store.save([])).resolves.toBeUndefined();
    });
  });

  describe('createPrismaLongTermMemoryStore', () => {
    it('should return empty array when agent_id is empty', async () => {
      const ctx = makeMockContext();
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef({ agent_id: '' }),
        query_text: 'test',
        limit: 10
      });
      expect(result).toEqual([]);
      expect(ctx.prisma.memoryBlock.findMany).not.toHaveBeenCalled();
    });

    it('should return empty array when agent_id is whitespace', async () => {
      const ctx = makeMockContext();
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef({ agent_id: '   ' }),
        query_text: 'test',
        limit: 10
      });
      expect(result).toEqual([]);
    });

    it('should query memoryBlock with correct filter', async () => {
      const ctx = makeMockContext([]);
      const store = createPrismaLongTermMemoryStore(ctx);
      await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 5
      });
      expect(ctx.prisma.memoryBlock.findMany).toHaveBeenCalledWith({
        where: { owner_agent_id: 'agent-1', status: 'active' },
        orderBy: [{ updated_at_tick: 'desc' }, { created_at_tick: 'desc' }, { id: 'desc' }],
        take: 5
      });
    });

    it('should map rows to MemoryEntry with title prefix', async () => {
      const ctx = makeMockContext([makeMemoryBlockRow()]);
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 10
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-1');
      expect(result[0]!.scope).toBe('long_term');
      expect(result[0]!.content.text).toBe('Test Title\nSome content');
      expect(result[0]!.content.structured).toEqual({ key: 'value' });
      expect(result[0]!.tags).toContain('memory_block');
      expect(result[0]!.tags).toContain('memory_kind:fact');
      expect(result[0]!.tags).toContain('tag1');
      expect(result[0]!.importance).toBe(0.8);
      expect(result[0]!.confidence).toBe(0.9);
    });

    it('should handle null title', async () => {
      const ctx = makeMockContext([makeMemoryBlockRow({ title: null })]);
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 10
      });
      expect(result[0]!.content.text).toBe('Some content');
    });

    it('should handle empty tags string', async () => {
      const ctx = makeMockContext([makeMemoryBlockRow({ tags: '' })]);
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 10
      });
      expect(result[0]!.tags).toEqual(['memory_block', 'memory_kind:fact']);
    });

    it('should handle invalid tags JSON', async () => {
      const ctx = makeMockContext([makeMemoryBlockRow({ tags: 'not-json' })]);
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 10
      });
      expect(result[0]!.tags).toEqual(['memory_block', 'memory_kind:fact']);
    });

    it('should handle null content_structured', async () => {
      const ctx = makeMockContext([makeMemoryBlockRow({ content_structured: null })]);
      const store = createPrismaLongTermMemoryStore(ctx);
      const result = await store.search({
        actor_ref: makeActorRef(),
        query_text: 'test',
        limit: 10
      });
      expect(result[0]!.content.structured).toBeUndefined();
    });

    it('should resolve void from save', async () => {
      const ctx = makeMockContext();
      const store = createPrismaLongTermMemoryStore(ctx);
      await expect(store.save([])).resolves.toBeUndefined();
    });
  });
});
