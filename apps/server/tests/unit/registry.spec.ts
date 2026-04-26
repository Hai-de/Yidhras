import { describe, expect, it } from 'vitest';

import {
  aiRegistryConfigSchema,
  BUILTIN_AI_REGISTRY_CONFIG,
  mergeAiRegistryConfig,
  resetAiRegistryCache,
} from '../../src/ai/registry.js';
import type { AiRegistryConfig } from '../../src/ai/types.js';

describe('AI registry', () => {
  describe('BUILTIN_AI_REGISTRY_CONFIG', () => {
    it('has version 1', () => {
      expect(BUILTIN_AI_REGISTRY_CONFIG.version).toBe(1);
    });

    it('has at least one provider', () => {
      expect(BUILTIN_AI_REGISTRY_CONFIG.providers.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one model', () => {
      expect(BUILTIN_AI_REGISTRY_CONFIG.models.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one route', () => {
      expect(BUILTIN_AI_REGISTRY_CONFIG.routes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('aiRegistryConfigSchema', () => {
    it('accepts builtin config', () => {
      const result = aiRegistryConfigSchema.safeParse(BUILTIN_AI_REGISTRY_CONFIG);
      expect(result.success).toBe(true);
    });

    it('accepts empty config with defaults', () => {
      const result = aiRegistryConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects invalid provider type', () => {
      const result = aiRegistryConfigSchema.safeParse({
        providers: [{ provider: '' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts override with extra models', () => {
      const override = {
        version: 1,
        models: [
          {
            provider: 'test',
            model: 'test-model',
            endpoint_kind: 'chat_completions',
            capabilities: {
              text_generation: true,
              structured_output: 'none',
              tool_calling: false,
              vision_input: false,
              embeddings: false,
              rerank: false,
            },
            tags: [],
            availability: 'active',
          },
        ],
      };
      const result = aiRegistryConfigSchema.safeParse(override);
      expect(result.success).toBe(true);
    });
  });

  describe('mergeAiRegistryConfig', () => {
    it('merges providers using provider key', () => {
      const base: AiRegistryConfig = {
        version: 1,
        providers: [{ provider: 'openai', enabled: true }],
        models: [],
        routes: [],
      };
      const override: AiRegistryConfig = {
        version: 1,
        providers: [{ provider: 'openai', enabled: false, api_key_env: 'MY_KEY' }],
        models: [],
        routes: [],
      };
      const merged = mergeAiRegistryConfig(base, override);
      expect(merged.providers).toHaveLength(1);
      expect(merged.providers[0]?.enabled).toBe(false);
      expect(merged.providers[0]?.api_key_env).toBe('MY_KEY');
    });

    it('adds new provider if not in base', () => {
      const base: AiRegistryConfig = { version: 1, providers: [], models: [], routes: [] };
      const override: AiRegistryConfig = {
        version: 1,
        providers: [{ provider: 'anthropic', enabled: true }],
        models: [],
        routes: [],
      };
      const merged = mergeAiRegistryConfig(base, override);
      expect(merged.providers).toHaveLength(1);
      expect(merged.providers[0]?.provider).toBe('anthropic');
    });

    it('merges models using provider:model key', () => {
      const base: AiRegistryConfig = {
        version: 1,
        providers: [],
        models: [
          {
            provider: 'openai',
            model: 'gpt-4',
            endpoint_kind: 'chat_completions',
            capabilities: { text_generation: true, structured_output: 'json_schema', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
            tags: ['fast'],
            availability: 'active',
          },
        ],
        routes: [],
      };
      const override: AiRegistryConfig = {
        version: 1,
        providers: [],
        models: [
          {
            provider: 'openai',
            model: 'gpt-4',
            endpoint_kind: 'chat_completions',
            capabilities: { text_generation: true, structured_output: 'json_object', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
            tags: ['slow'],
            availability: 'active',
          },
        ],
        routes: [],
      };
      const merged = mergeAiRegistryConfig(base, override);
      expect(merged.models).toHaveLength(1);
      expect(merged.models[0]?.capabilities.structured_output).toBe('json_object');
      expect(merged.models[0]?.tags).toEqual(['slow']);
    });

    it('merges routes using route_id key', () => {
      const base: AiRegistryConfig = {
        version: 1,
        providers: [],
        models: [],
        routes: [
          {
            route_id: 'default.agent_decision',
            task_types: ['agent_decision'],
            preferred_models: [],
            fallback_models: [],
            defaults: { timeout_ms: 30000, retry_limit: 1 },
          },
        ],
      };
      const override: AiRegistryConfig = {
        version: 1,
        providers: [],
        models: [],
        routes: [
          {
            route_id: 'default.agent_decision',
            task_types: ['agent_decision'],
            preferred_models: [],
            fallback_models: [],
            defaults: { timeout_ms: 60000, retry_limit: 3 },
          },
        ],
      };
      const merged = mergeAiRegistryConfig(base, override);
      expect(merged.routes).toHaveLength(1);
      expect(merged.routes[0]?.defaults?.timeout_ms).toBe(60000);
      expect(merged.routes[0]?.defaults?.retry_limit).toBe(3);
    });
  });

  describe('resetAiRegistryCache', () => {
    it('clears the cache without throwing', () => {
      expect(() => resetAiRegistryCache()).not.toThrow();
    });
  });
});
