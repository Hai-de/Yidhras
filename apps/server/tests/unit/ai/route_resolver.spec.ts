import { describe, expect, it } from 'vitest';

import { resolveAiRoute } from '../../../src/ai/route_resolver.js';
import type { AiRegistryConfig } from '../../../src/ai/types.js';

const makeRegistry = (overrides: Partial<AiRegistryConfig> = {}): AiRegistryConfig => ({
  version: 1,
  providers: [
    { provider: 'openai', enabled: true },
    { provider: 'local', enabled: true }
  ],
  models: [
    {
      provider: 'openai',
      model: 'gpt-4',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: true,
        vision_input: true,
        embeddings: false,
        rerank: false
      },
      tags: ['cloud'],
      availability: 'active'
    },
    {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'json_object',
        tool_calling: true,
        vision_input: false,
        embeddings: false,
        rerank: false
      },
      tags: ['cloud', 'fast'],
      availability: 'active'
    },
    {
      provider: 'local',
      model: 'llama-3',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'none',
        tool_calling: false,
        vision_input: false,
        embeddings: false,
        rerank: false
      },
      tags: ['local', 'on_device'],
      availability: 'active'
    },
    {
      provider: 'openai',
      model: 'text-embedding-3-small',
      endpoint_kind: 'embeddings',
      capabilities: {
        text_generation: false,
        structured_output: 'none',
        tool_calling: false,
        vision_input: false,
        embeddings: true,
        rerank: false
      },
      tags: ['cloud'],
      availability: 'active'
    },
    {
      provider: 'openai',
      model: 'disabled-model',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: true,
        vision_input: false,
        embeddings: false,
        rerank: false
      },
      tags: ['cloud'],
      availability: 'disabled'
    }
  ],
  routes: [
    {
      route_id: 'default-agent',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4' }],
      fallback_models: [{ provider: 'openai', model: 'gpt-3.5-turbo' }]
    },
    {
      route_id: 'embedding-route',
      task_types: ['embedding'],
      preferred_models: [{ provider: 'openai', model: 'text-embedding-3-small' }],
      fallback_models: []
    },
    {
      route_id: 'local-route',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'local' }],
      fallback_models: [],
      constraints: { require_local_only: true }
    },
    {
      route_id: 'pack-specific-route',
      task_types: ['agent_decision'],
      pack_id: 'special-pack',
      preferred_models: [{ provider: 'openai', model: 'gpt-4' }],
      fallback_models: []
    }
  ],
  ...overrides
});

describe('resolveAiRoute', () => {
  describe('route selection', () => {
    it('selects route matching task type', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({ task_type: 'agent_decision' }, registry);
      expect(result.route.route_id).toBe('default-agent');
    });

    it('selects embedding route for embedding task', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({ task_type: 'embedding' }, registry);
      expect(result.route.route_id).toBe('embedding-route');
    });

    it('throws when no route matches task type', () => {
      const registry = makeRegistry();
      expect(() => resolveAiRoute({ task_type: 'memory_compaction' }, registry)).toThrow(/No AI route/);
    });

    it('selects explicit route by route_id from route_hint', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        route_hint: { route_id: 'local-route' }
      }, registry);
      expect(result.route.route_id).toBe('local-route');
    });

    it('throws when task_override route_id does not support task type', () => {
      const registry = makeRegistry();
      expect(() => resolveAiRoute({
        task_type: 'agent_decision',
        task_override: { route: { route_id: 'embedding-route' } }
      }, registry)).toThrow(/does not support the requested task type/);
    });

    it('throws when explicit route not found', () => {
      const registry = makeRegistry();
      expect(() => resolveAiRoute({
        task_type: 'agent_decision',
        route_hint: { route_id: 'nonexistent' }
      }, registry)).toThrow(/does not exist/);
    });

    it('prefers pack-specific route over generic', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        pack_id: 'special-pack'
      }, registry);
      expect(result.route.route_id).toBe('pack-specific-route');
    });
  });

  describe('model resolution', () => {
    it('returns primary and fallback candidates', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({ task_type: 'agent_decision' }, registry);
      expect(result.primary_model_candidates.length).toBeGreaterThan(0);
      expect(result.primary_model_candidates[0].model).toBe('gpt-4');
      expect(result.fallback_model_candidates.length).toBeGreaterThan(0);
      expect(result.fallback_model_candidates[0].model).toBe('gpt-3.5-turbo');
    });

    it('filters disabled models', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({ task_type: 'agent_decision' }, registry);
      const allModels = [...result.primary_model_candidates, ...result.fallback_model_candidates];
      expect(allModels.every(m => m.availability !== 'disabled')).toBe(true);
    });

    it('throws when no primary model candidates', () => {
      const registry = makeRegistry({
        models: [
          {
            provider: 'openai',
            model: 'disabled-model',
            endpoint_kind: 'chat_completions',
            capabilities: {
              text_generation: true,
              structured_output: 'json_schema',
              tool_calling: true,
              vision_input: false,
              embeddings: false,
              rerank: false
            },
            tags: ['cloud'],
            availability: 'disabled'
          }
        ]
      });
      expect(() => resolveAiRoute({ task_type: 'agent_decision' }, registry)).toThrow(/no usable primary model/);
    });

    it('returns embedding model for embedding task', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({ task_type: 'embedding' }, registry);
      expect(result.primary_model_candidates[0].model).toBe('text-embedding-3-small');
      expect(result.primary_model_candidates[0].capabilities.embeddings).toBe(true);
    });
  });

  describe('route constraints', () => {
    it('filters models by require_local_only constraint', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        route_hint: { route_id: 'local-route' }
      }, registry);
      expect(result.primary_model_candidates.every(m => m.tags.includes('local') || m.tags.includes('on_device'))).toBe(true);
    });

    it('filters by response mode support', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        response_mode: 'json_schema'
      }, registry);
      // gpt-4 supports json_schema, gpt-3.5-turbo only supports json_object
      const primaryModels = result.primary_model_candidates;
      expect(primaryModels.some(m => m.model === 'gpt-4')).toBe(true);
    });

    it('filters out models without required response mode support', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        response_mode: 'tool_call'
      }, registry);
      // local model doesn't support tool_calling
      expect(result.primary_model_candidates.some(m => m.provider === 'local')).toBe(false);
    });
  });

  describe('route hint prioritization', () => {
    it('prioritizes model matching route hint', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        route_hint: { model: 'gpt-3.5-turbo' }
      }, registry);
      // gpt-3.5-turbo should be first in fallback candidates
      expect(result.fallback_model_candidates[0]?.model).toBe('gpt-3.5-turbo');
    });

    it('prioritizes provider matching route hint', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        route_hint: { provider: 'openai' }
      }, registry);
      expect(result.primary_model_candidates.every(m => m.provider === 'openai')).toBe(true);
    });

    it('falls back to all entries when hint does not match', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        route_hint: { provider: 'nonexistent' }
      }, registry);
      expect(result.primary_model_candidates.length).toBeGreaterThan(0);
    });
  });

  describe('result structure', () => {
    it('includes applied_override from task_override', () => {
      const registry = makeRegistry();
      const override = { prompt: { system_append: 'extra context' } };
      const result = resolveAiRoute({
        task_type: 'agent_decision',
        task_override: override
      }, registry);
      expect(result.applied_override).toEqual(override);
    });

    it('applied_override is null when no task_override', () => {
      const registry = makeRegistry();
      const result = resolveAiRoute({ task_type: 'agent_decision' }, registry);
      expect(result.applied_override).toBeNull();
    });

    it('deduplicates models by provider:model key', () => {
      const registry = makeRegistry({
        routes: [
          {
            route_id: 'dup-route',
            task_types: ['agent_decision'],
            preferred_models: [
              { provider: 'openai', model: 'gpt-4' },
              { provider: 'openai', model: 'gpt-4' }
            ],
            fallback_models: []
          }
        ]
      });
      const result = resolveAiRoute({ task_type: 'agent_decision' }, registry);
      expect(result.primary_model_candidates.length).toBe(1);
    });
  });
});
