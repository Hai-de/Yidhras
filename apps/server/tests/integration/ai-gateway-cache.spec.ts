import { describe, expect, it } from 'vitest';

import { buildCacheKey, createInMemoryPromptCache, resolveCacheTtl } from '../../src/ai/cache.js';
import type { ModelGatewayRequest } from '../../src/ai/types.js';

const buildRequest = (overrides?: Partial<ModelGatewayRequest>): ModelGatewayRequest => ({
  invocation_id: 'test-inv-1',
  task_id: 'test-task-1',
  task_type: 'agent_decision',
  messages: [
    {
      role: 'system',
      parts: [{ type: 'text', text: 'You are an agent.' }]
    },
    {
      role: 'user',
      parts: [{ type: 'text', text: 'What should I do?' }]
    }
  ],
  response_mode: 'json_object',
  sampling: { temperature: 0 },
  ...overrides
});

describe('InMemoryPromptCache', () => {
  it('returns null for a cache miss', () => {
    const cache = createInMemoryPromptCache(10);
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns a cached entry on hit', () => {
    const cache = createInMemoryPromptCache(10);
    const entry = { key: 'k1', result: { value: 42 }, createdAt: Date.now(), ttlMs: 60000 };
    cache.set('k1', entry);
    const hit = cache.get('k1');
    expect(hit).not.toBeNull();
    expect(hit?.result).toEqual({ value: 42 });
  });

  it('evicts expired entries on get', () => {
    const cache = createInMemoryPromptCache(10);
    const entry = { key: 'k1', result: { value: 42 }, createdAt: Date.now() - 120000, ttlMs: 1000 };
    cache.set('k1', entry);
    expect(cache.get('k1')).toBeNull();
  });

  it('evicts LRU entry when at capacity', () => {
    const cache = createInMemoryPromptCache(2);
    cache.set('k1', { key: 'k1', result: 1, createdAt: Date.now(), ttlMs: 60000 });
    cache.set('k2', { key: 'k2', result: 2, createdAt: Date.now(), ttlMs: 60000 });
    cache.set('k3', { key: 'k3', result: 3, createdAt: Date.now(), ttlMs: 60000 });

    expect(cache.get('k1')).toBeNull(); // LRU evicted
    expect(cache.get('k2')).not.toBeNull();
    expect(cache.get('k3')).not.toBeNull();
  });

  it('moves accessed entry to front (LRU)', () => {
    const cache = createInMemoryPromptCache(2);
    cache.set('k1', { key: 'k1', result: 1, createdAt: Date.now(), ttlMs: 60000 });
    cache.set('k2', { key: 'k2', result: 2, createdAt: Date.now(), ttlMs: 60000 });
    cache.get('k1'); // access k1, making k2 the LRU
    cache.set('k3', { key: 'k3', result: 3, createdAt: Date.now(), ttlMs: 60000 });

    expect(cache.get('k1')).not.toBeNull();
    expect(cache.get('k2')).toBeNull(); // k2 evicted
    expect(cache.get('k3')).not.toBeNull();
  });

  it('reports hit/miss stats', () => {
    const cache = createInMemoryPromptCache(10);
    cache.get('k1');
    cache.get('k2');
    const entry = { key: 'k1', result: 1, createdAt: Date.now(), ttlMs: 60000 };
    cache.set('k1', entry);
    cache.get('k1');

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });
});

describe('buildCacheKey', () => {
  it('produces identical keys for identical requests', () => {
    const req = buildRequest();
    expect(buildCacheKey(req, 'pack-a')).toBe(buildCacheKey(req, 'pack-a'));
  });

  it('produces different keys for different pack_ids', () => {
    const req = buildRequest();
    expect(buildCacheKey(req, 'pack-a')).not.toBe(buildCacheKey(req, 'pack-b'));
  });

  it('produces different keys for different temperatures', () => {
    const a = buildRequest({ sampling: { temperature: 0 } });
    const b = buildRequest({ sampling: { temperature: 0.5 } });
    expect(buildCacheKey(a, 'pack-a')).not.toBe(buildCacheKey(b, 'pack-a'));
  });

  it('produces different keys for different response_modes', () => {
    const a = buildRequest({ response_mode: 'json_object' });
    const b = buildRequest({ response_mode: 'free_text' });
    expect(buildCacheKey(a, 'pack-a')).not.toBe(buildCacheKey(b, 'pack-a'));
  });

  it('produces different keys for different tool sets', () => {
    const a = buildRequest({ tools: [{ name: 'get_weather', description: '', input_schema: {} }] });
    const b = buildRequest({ tools: [{ name: 'get_time', description: '', input_schema: {} }] });
    expect(buildCacheKey(a, 'pack-a')).not.toBe(buildCacheKey(b, 'pack-a'));
  });

  it('produces different keys for different messages', () => {
    const a = buildRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
    });
    const b = buildRequest({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'World' }] }]
    });
    expect(buildCacheKey(a, 'pack-a')).not.toBe(buildCacheKey(b, 'pack-a'));
  });

  it('null pack_id produces consistent keys', () => {
    const req = buildRequest();
    expect(buildCacheKey(req, null)).toBe(buildCacheKey(req, null));
    expect(buildCacheKey(req, null)).not.toBe(buildCacheKey(req, 'pack-a'));
  });

  it('includes structured_output schema in key', () => {
    const a = buildRequest({
      response_mode: 'json_schema',
      structured_output: { schema_name: 'test', json_schema: { type: 'object', properties: { x: { type: 'string' } } } }
    });
    const b = buildRequest({
      response_mode: 'json_schema',
      structured_output: { schema_name: 'test', json_schema: { type: 'object', properties: { y: { type: 'number' } } } }
    });
    expect(buildCacheKey(a, 'p1')).not.toBe(buildCacheKey(b, 'p1'));
  });
});

describe('resolveCacheTtl', () => {
  it('returns per-task-type TTL for agent_decision', () => {
    expect(resolveCacheTtl('agent_decision')).toBe(60000);
  });

  it('returns per-task-type TTL for embedding', () => {
    expect(resolveCacheTtl('embedding')).toBe(3600000);
  });

  it('returns default TTL for unknown task type', () => {
    expect(resolveCacheTtl('unknown_task')).toBe(120000);
  });

  it('returns per-task-type TTL for context_summary', () => {
    expect(resolveCacheTtl('context_summary')).toBe(300000);
  });

  it('returns per-task-type TTL for memory_compaction', () => {
    expect(resolveCacheTtl('memory_compaction')).toBe(600000);
  });
});
