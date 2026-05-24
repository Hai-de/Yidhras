import { createHash } from 'node:crypto';

import type { AiTaskType, ModelGatewayRequest } from './types.js';

export interface PromptCacheEntry {
  key: string;
  result: unknown;
  createdAt: number;
  ttlMs: number;
}

export interface PromptCache {
  get(key: string): PromptCacheEntry | null;
  set(key: string, entry: PromptCacheEntry): void;
  invalidate(key: string): void;
  stats(): { size: number; hits: number; misses: number };
}

// per-task-type TTL（ms）
const TASK_TTL_OVERRIDES: Partial<Record<AiTaskType, number>> = {
  agent_decision: 60_000,
  intent_grounding_assist: 60_000,
  context_summary: 300_000,
  memory_compaction: 600_000,
  embedding: 3_600_000,
  moderation: 120_000,
  classification: 180_000,
};

const CACHE_DEFAULT_TTL_MS = 120_000; // 2 分钟

const resolveTtl = (taskType: string): number => {
   
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  return TASK_TTL_OVERRIDES[taskType as AiTaskType] ?? CACHE_DEFAULT_TTL_MS;
};

export const buildCacheKey = (request: ModelGatewayRequest, packId?: string | null): string => {
  const payload = JSON.stringify({
    provider: request.provider_hint ?? null,
    model: request.model_hint ?? null,
    messages: request.messages.map(m => ({
      role: m.role,
      parts: m.parts.map(p => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        if (p.type === 'json') return { type: 'json', json: p.json };
        return { type: p.type };
      })
    })),
    temperature: request.sampling?.temperature ?? 0,
    response_mode: request.response_mode,
    structured_output_schema: request.structured_output?.json_schema ?? null,
    tools: request.tools?.map(t => t.name) ?? null,
    tool_policy: request.tool_policy?.mode ?? null,
    task_type: request.task_type,
    pack_id: packId ?? null
  });

  return createHash('sha256').update(payload).digest('hex');
};

export const resolveCacheTtl = (taskType: string): number => {
  return resolveTtl(taskType);
};

// ── In-memory LRU cache ────────────────────────────────────────────────

interface LruEntry {
  key: string;
  result: unknown;
  createdAt: number;
  ttlMs: number;
  prev: string | null;
  next: string | null;
}

export const createInMemoryPromptCache = (maxSize = 500): PromptCache => {
  const store = new Map<string, LruEntry>();
  let head: string | null = null;
  let tail: string | null = null;
  let hits = 0;
  let misses = 0;

  const evictExpired = (): void => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.createdAt > entry.ttlMs) {
        removeNode(key);
        store.delete(key);
      }
    }
  };

  const removeNode = (key: string): void => {
    const entry = store.get(key);
    if (!entry) return;

    if (entry.prev) {
      const prev = store.get(entry.prev);
      if (prev) prev.next = entry.next;
    } else {
      head = entry.next;
    }

    if (entry.next) {
      const next = store.get(entry.next);
      if (next) next.prev = entry.prev;
    } else {
      tail = entry.prev;
    }
  };

  const addToFront = (key: string): void => {
    const entry = store.get(key);
    if (!entry) return;

    entry.prev = null;
    entry.next = head;

    if (head) {
      const headEntry = store.get(head);
      if (headEntry) headEntry.prev = key;
    }
    head = key;

    if (!tail) {
      tail = key;
    }
  };

  const evictLru = (): void => {
    if (!tail) return;
    const toRemove = tail;
    removeNode(toRemove);
    store.delete(toRemove);
  };

  return {
    get(key) {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry) {
        misses += 1;
        return null;
      }

      if (now - entry.createdAt > entry.ttlMs) {
        removeNode(key);
        store.delete(key);
        misses += 1;
        return null;
      }

      // LRU: 移到最前
      removeNode(key);
      addToFront(key);

      hits += 1;
      return {
        key: entry.key,
        result: entry.result,
        createdAt: entry.createdAt,
        ttlMs: entry.ttlMs
      };
    },

    set(key, entry) {
      // 先清理过期
      if (store.size >= maxSize) {
        evictExpired();
      }

      // 如果还是满的，淘汰最旧
      if (store.size >= maxSize) {
        evictLru();
      }

      // 删除旧值（如果存在）
      if (store.has(key)) {
        removeNode(key);
        store.delete(key);
      }

      store.set(key, {
        key,
        result: entry.result,
        createdAt: entry.createdAt,
        ttlMs: entry.ttlMs,
        prev: null,
        next: null
      });

      addToFront(key);
    },

    invalidate(key) {
      if (store.has(key)) {
        removeNode(key);
        store.delete(key);
      }
    },

    stats() {
      return {
        size: store.size,
        hits,
        misses
      };
    }
  };
};
