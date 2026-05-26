import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PartialModelEntry } from '../../src/ai/providers/types.js';
import {
  BUILTIN_AI_TOOLS,
  findAiModelRegistryEntry,
  findAiToolEntryByName,
  getAiProviderConfig,
  getAiRegistryConfig,
  getAiRegistryMetadata,
  getAiToolEntry,
  getDynamicModelsMetadata,
  listAiModelRegistryEntries,
  listAiProviderConfigs,
  listAiRoutePolicies,
  listAiToolEntries,
  refreshDynamicModels,
  resetAiRegistryCache,
  resolveToolsFromRegistry
} from '../../src/ai/registry.js';
import type { AiProviderConfig } from '../../src/ai/types.js';
import { expectArrayElement, expectDefined } from '../helpers/assertions.js';

const DYNAMIC_MODEL_ID = 'test-model-dynamic';

const mockDynamicModel: PartialModelEntry = {
  provider: 'openai',
  model: DYNAMIC_MODEL_ID,
  endpoint_kind: 'chat_completions',
  capabilities: {
    text_generation: true,
    structured_output: 'json_object',
    tool_calling: true,
    vision_input: false,
    embeddings: false,
    rerank: false
  },
  tags: ['dynamic'],
  availability: 'active'
};

const mockAdapterWithListModels = {
  provider: 'openai',
  execute: vi.fn(),
  listModels: vi.fn(async (_providerConfig: AiProviderConfig) => [mockDynamicModel])
};

const mockAdapterWithoutListModels = {
  provider: 'no-list-models',
  execute: vi.fn()
};

vi.mock('../../src/ai/providers/adapter_registry.js', () => ({
  buildAdaptersFromRegistry: vi.fn(() => [mockAdapterWithListModels, mockAdapterWithoutListModels]),
  listBuiltinAdapterNames: vi.fn(() => [])
}));

describe('ai registry', () => {
  beforeEach(() => {
    resetAiRegistryCache();
  });

  describe('getAiRegistryConfig', () => {
    it('returns a config with version, providers, models, routes', () => {
      const config = getAiRegistryConfig();

      expect(config.version).toBe(1);
      expect(Array.isArray(config.providers)).toBe(true);
      expect(Array.isArray(config.models)).toBe(true);
      expect(Array.isArray(config.routes)).toBe(true);
    });

    it('has at least one provider', () => {
      const config = getAiRegistryConfig();

      expect(config.providers.length).toBeGreaterThanOrEqual(1);
      expect(config.providers[0]?.provider).toBe('openai');
    });

    it('has at least three models', () => {
      const config = getAiRegistryConfig();

      expect(config.models.length).toBeGreaterThanOrEqual(3);
    });

    it('has the expected default routes', () => {
      const config = getAiRegistryConfig();
      const routeIds = config.routes.map(route => route.route_id).sort();

      expect(routeIds).toContain('default.agent_decision');
      expect(routeIds).toContain('default.context_summary');
      expect(routeIds).toContain('default.moderation');
      expect(routeIds).toContain('default.embedding');
    });
  });

  describe('getAiRegistryMetadata', () => {
    it('returns metadata with workspaceRoot and configPath', () => {
      const metadata = getAiRegistryMetadata();

      expect(typeof metadata.workspaceRoot).toBe('string');
      expect(typeof metadata.configPath).toBe('string');
      expect(metadata.configPath.length).toBeGreaterThan(0);
      expect(typeof metadata.loadedFromFile).toBe('boolean');
    });
  });

  describe('provider queries', () => {
    it('listAiProviderConfigs returns an array', () => {
      const providers = listAiProviderConfigs();

      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThanOrEqual(1);
    });

    it('getAiProviderConfig returns openai provider', () => {
      const provider = getAiProviderConfig('openai');

      const openaiProvider = expectDefined(provider, 'openai provider');
      expect(openaiProvider.provider).toBe('openai');
      expect(openaiProvider.enabled).toBe(true);
      expect(openaiProvider.api_key_env).toBe('OPENAI_API_KEY');
    });

    it('getAiProviderConfig returns null for unknown provider', () => {
      const provider = getAiProviderConfig('nonexistent');

      expect(provider).toBeNull();
    });
  });

  describe('model queries', () => {
    it('listAiModelRegistryEntries returns at least three models', () => {
      const models = listAiModelRegistryEntries();

      expect(models.length).toBeGreaterThanOrEqual(3);
    });

    it('finds gpt-4.1-mini via findAiModelRegistryEntry', () => {
      const entry = findAiModelRegistryEntry({ provider: 'openai', model: 'gpt-4.1-mini' });

      const model = expectDefined(entry, 'gpt-4.1-mini model');
      expect(model.provider).toBe('openai');
      expect(model.model).toBe('gpt-4.1-mini');
      expect(model.capabilities.structured_output).toBe('json_schema');
      expect(model.capabilities.tool_calling).toBe(true);
      expect(model.capabilities.text_generation).toBe(true);
    });

    it('finds embedding model via findAiModelRegistryEntry', () => {
      const entry = findAiModelRegistryEntry({ provider: 'openai', model: 'text-embedding-3-small' });

      const model = expectDefined(entry, 'text-embedding-3-small model');
      expect(model.capabilities.embeddings).toBe(true);
      expect(model.capabilities.text_generation).toBe(false);
    });

    it('returns null for unknown model', () => {
      const entry = findAiModelRegistryEntry({ provider: 'unknown', model: 'nonexistent' });

      expect(entry).toBeNull();
    });

    it('returns null when provider matches but model does not', () => {
      const entry = findAiModelRegistryEntry({ provider: 'openai', model: 'nonexistent' });

      expect(entry).toBeNull();
    });

    it('gpt-4.1 model exists and has tags', () => {
      const entry = findAiModelRegistryEntry({ provider: 'openai', model: 'gpt-4.1' });

      const model = expectDefined(entry, 'gpt-4.1 model');
      expect(Array.isArray(model.tags)).toBe(true);
      expect(model.tags.length).toBeGreaterThan(0);
    });
  });

  describe('route queries', () => {
    it('listAiRoutePolicies without filter returns all routes', () => {
      const routes = listAiRoutePolicies();

      expect(routes.length).toBeGreaterThanOrEqual(4);
    });

    it('listAiRoutePolicies filters by task type', () => {
      const routes = listAiRoutePolicies('agent_decision');

      expect(routes.length).toBeGreaterThanOrEqual(1);
      for (const route of routes) {
        expect(route.task_types).toContain('agent_decision');
      }
    });

    it('listAiRoutePolicies returns empty array for unknown task type', () => {
      const routes = listAiRoutePolicies('unknown_task_type');

      expect(Array.isArray(routes)).toBe(true);
      expect(routes.length).toBe(0);
    });

    it('agent_decision route has preferred models', () => {
      const routes = listAiRoutePolicies('agent_decision');

      expect(routes.length).toBeGreaterThan(0);
      const route = expectArrayElement(routes, 0, 'agent decision routes');
      expect(route.route_id).toBe('default.agent_decision');
      expect(Array.isArray(route.preferred_models)).toBe(true);
      expect(route.preferred_models.length).toBeGreaterThan(0);
      expect(route.preferred_models[0]?.provider).toBe('openai');
    });

    it('context_summary route supports multiple task types', () => {
      const routes = listAiRoutePolicies('context_summary');

      expect(routes.length).toBeGreaterThanOrEqual(1);
      const route = routes.find(r => r.route_id === 'default.context_summary');
      const contextSummaryRoute = expectDefined(route, 'context summary route');
      expect(contextSummaryRoute.task_types.length).toBeGreaterThanOrEqual(2);
    });

    it('embedding route has ollama fallback model', () => {
      const routes = listAiRoutePolicies('embedding');

      expect(routes.length).toBeGreaterThanOrEqual(1);
      const route = routes.find(r => r.route_id === 'default.embedding');
      const embeddingRoute = expectDefined(route, 'embedding route');
      expect(embeddingRoute.fallback_models.length).toBeGreaterThanOrEqual(1);
      expect(embeddingRoute.fallback_models.some(m => m.provider === 'ollama')).toBe(true);
      expect(embeddingRoute.defaults?.allow_fallback).toBe(true);
    });

    it('all default routes have non-empty task_types', () => {
      const routes = listAiRoutePolicies();

      for (const route of routes) {
        expect(Array.isArray(route.task_types)).toBe(true);
        expect(route.task_types.length).toBeGreaterThan(0);
        expect(typeof route.route_id).toBe('string');
        expect(route.route_id.length).toBeGreaterThan(0);
      }
    });
  });

  describe('cache behavior', () => {
    it('returns the same config object on subsequent calls (caching)', () => {
      const config1 = getAiRegistryConfig();
      const config2 = getAiRegistryConfig();

      expect(config1).toBe(config2);
    });

    it('resetAiRegistryCache invalidates the cache', () => {
      const before = getAiRegistryConfig();
      resetAiRegistryCache();
      const after = getAiRegistryConfig();

      expect(before).not.toBe(after);
      expect(before.version).toBe(after.version);
    });
  });

  describe('builtin tools', () => {
    it('BUILTIN_AI_TOOLS contains five system tools', () => {
      expect(BUILTIN_AI_TOOLS).toHaveLength(5);
    });

    it('all builtin tools have sys.* tool_id prefix', () => {
      for (const tool of BUILTIN_AI_TOOLS) {
        expect(tool.tool_id.startsWith('sys.')).toBe(true);
      }
    });

    it('all builtin tools are system kind and enabled', () => {
      for (const tool of BUILTIN_AI_TOOLS) {
        expect(tool.kind).toBe('system');
        expect(tool.enabled).toBe(true);
      }
    });

    it('each builtin tool has a name, description, and input_schema', () => {
      for (const tool of BUILTIN_AI_TOOLS) {
        expect(typeof tool.tool_id).toBe('string');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.input_schema).toBe('object');
        expect(tool.input_schema.type).toBe('object');
      }
    });
  });

  describe('tool queries', () => {
    it('listAiToolEntries returns the builtin tools', () => {
      const tools = listAiToolEntries();

      expect(tools.length).toBeGreaterThanOrEqual(5);
      const toolIds = tools.map(t => t.tool_id);
      expect(toolIds).toContain('sys.query_memory_blocks');
      expect(toolIds).toContain('sys.get_entity');
      expect(toolIds).toContain('sys.list_active_agents');
      expect(toolIds).toContain('sys.get_relationship');
      expect(toolIds).toContain('sys.get_clock_state');
    });

    it('getAiToolEntry finds a tool by tool_id', () => {
      const tool = getAiToolEntry('sys.get_clock_state');

      const clockTool = expectDefined(tool, 'clock tool');
      expect(clockTool.name).toBe('get_clock_state');
      expect(clockTool.kind).toBe('system');
    });

    it('getAiToolEntry returns null for unknown tool_id', () => {
      expect(getAiToolEntry('nonexistent')).toBeNull();
    });

    it('findAiToolEntryByName finds a tool by name', () => {
      const tool = findAiToolEntryByName('query_memory_blocks');

      const memoryTool = expectDefined(tool, 'memory tool');
      expect(memoryTool.tool_id).toBe('sys.query_memory_blocks');
    });

    it('findAiToolEntryByName returns null for unknown name', () => {
      expect(findAiToolEntryByName('nonexistent')).toBeNull();
    });

    it('resolveToolsFromRegistry resolves tool IDs to entries', () => {
      const resolved = resolveToolsFromRegistry([
        'sys.get_clock_state',
        'sys.get_entity',
        'sys.nonexistent'
      ]);

      expect(resolved).toHaveLength(2);
      expect(expectArrayElement(resolved, 0, 'resolved tools').tool_id).toBe('sys.get_clock_state');
      expect(expectArrayElement(resolved, 1, 'resolved tools').tool_id).toBe('sys.get_entity');
    });

    it('resolveToolsFromRegistry filters out disabled tools', () => {
      const resolved = resolveToolsFromRegistry(['sys.get_clock_state']);

      expect(resolved).toHaveLength(1);
      expect(expectArrayElement(resolved, 0, 'resolved tools').enabled).toBe(true);
    });

    it('resolveToolsFromRegistry returns empty array for empty input', () => {
      expect(resolveToolsFromRegistry([])).toEqual([]);
    });
  });

  describe('route tool calling constraints', () => {
    it('default.agent_decision route allows tool calling', () => {
      const routes = listAiRoutePolicies('agent_decision');
      const route = routes.find(r => r.route_id === 'default.agent_decision');

      const agentDecisionRoute = expectDefined(route, 'agent decision route');
      expect(agentDecisionRoute.constraints?.allow_tool_calling).toBe(true);
    });

    it('other default routes do not have allow_tool_calling set', () => {
      const allRoutes = listAiRoutePolicies();
      const nonAgentRoutes = allRoutes.filter(r => r.route_id !== 'default.agent_decision');

      for (const route of nonAgentRoutes) {
        expect(route.constraints?.allow_tool_calling).toBeUndefined();
      }
    });
  });

  describe('dynamic models', () => {
    beforeEach(() => {
      resetAiRegistryCache();
      vi.resetAllMocks();
      mockAdapterWithListModels.listModels = vi.fn(async (_providerConfig: AiProviderConfig) => [mockDynamicModel]);
    });

    it('getDynamicModelsMetadata returns zero count when no models fetched', () => {
      const meta = getDynamicModelsMetadata();

      expect(meta.count).toBe(0);
      expect(meta.lastFetchedAt).toBeNull();
    });

    it('getAiRegistryConfig returns only static models before dynamic refresh', () => {
      const config = getAiRegistryConfig();
      const modelIds = config.models.map(m => `${m.provider}:${m.model}`);

      expect(modelIds).not.toContain(`openai:${DYNAMIC_MODEL_ID}`);
    });

    it('refreshDynamicModels populates dynamic models and getAiRegistryConfig includes them', async () => {
      await refreshDynamicModels();

      const config = getAiRegistryConfig();
      const modelIds = config.models.map(m => `${m.provider}:${m.model}`);

      expect(modelIds).toContain(`openai:${DYNAMIC_MODEL_ID}`);
    });

    it('dynamic models have dynamic tag', async () => {
      await refreshDynamicModels();

      const config = getAiRegistryConfig();
      const dynamicModel = config.models.find(m => m.model === DYNAMIC_MODEL_ID);

      const foundDynamic = expectDefined(dynamicModel, 'dynamic model');
      expect(foundDynamic.tags).toContain('dynamic');
    });

    it('getDynamicModelsMetadata reflects fetched models', async () => {
      await refreshDynamicModels();

      const meta = getDynamicModelsMetadata();

      expect(meta.count).toBeGreaterThanOrEqual(1);
      expect(meta.lastFetchedAt).toBeGreaterThan(0);
    });

    it('static models take priority over dynamic models with same key', async () => {
      // First, verify gpt-4.1-mini exists in static config
      const staticConfig = getAiRegistryConfig();
      const gpt4Mini = staticConfig.models.find(
        m => m.provider === 'openai' && m.model === 'gpt-4.1-mini'
      );
      const staticGpt4Mini = expectDefined(gpt4Mini, 'static gpt-4.1-mini');
      expect(staticGpt4Mini.capabilities.structured_output).toBe('json_schema');

      // Now set up mock to return a model with same key but different capabilities
      mockAdapterWithListModels.listModels = vi.fn(async (_providerConfig: AiProviderConfig) => [
        {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          endpoint_kind: 'chat_completions',
          capabilities: {
            text_generation: true,
            structured_output: 'none' as const,
            tool_calling: false,
            vision_input: false,
            embeddings: false,
            rerank: false
          },
          tags: ['dynamic'],
          availability: 'active' as const
        }
      ] as PartialModelEntry[]);

      await refreshDynamicModels();

      // Static entry should NOT be overwritten — structured_output stays 'json_schema'
      const mergedConfig = getAiRegistryConfig();
      const mergedGpt4Mini = mergedConfig.models.find(
        m => m.provider === 'openai' && m.model === 'gpt-4.1-mini'
      );

      const resolvedMerged = expectDefined(mergedGpt4Mini, 'merged gpt-4.1-mini');
      expect(resolvedMerged.capabilities.structured_output).toBe('json_schema');
    });

    it('resetAiRegistryCache clears dynamic models', async () => {
      await refreshDynamicModels();

      const metaBefore = getDynamicModelsMetadata();
      expect(metaBefore.count).toBeGreaterThanOrEqual(1);

      resetAiRegistryCache();

      const metaAfter = getDynamicModelsMetadata();
      expect(metaAfter.count).toBe(0);
      expect(metaAfter.lastFetchedAt).toBeNull();
    });

    it('listModels is not called for adapter without listModels method', async () => {
      await refreshDynamicModels();

      // The mock adapter without listModels should not cause errors
      const config = getAiRegistryConfig();
      const models = config.models;

      // no-list-models adapter should not contribute models
      const modelsFromNoList = models.filter(m => m.provider === 'no-list-models');
      expect(modelsFromNoList).toHaveLength(0);
    });
  });

});
