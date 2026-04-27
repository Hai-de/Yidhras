import { beforeEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_AI_TOOLS,
  findAiModelRegistryEntry,
  findAiToolEntryByName,
  getAiProviderConfig,
  getAiRegistryConfig,
  getAiRegistryMetadata,
  getAiToolEntry,
  listAiModelRegistryEntries,
  listAiProviderConfigs,
  listAiRoutePolicies,
  listAiToolEntries,
  resetAiRegistryCache,
  resolveToolsFromRegistry
} from '../../src/ai/registry.js';

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

      expect(provider).not.toBeNull();
      expect(provider!.provider).toBe('openai');
      expect(provider!.enabled).toBe(true);
      expect(provider!.api_key_env).toBe('OPENAI_API_KEY');
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

      expect(entry).not.toBeNull();
      expect(entry!.provider).toBe('openai');
      expect(entry!.model).toBe('gpt-4.1-mini');
      expect(entry!.capabilities.structured_output).toBe('json_schema');
      expect(entry!.capabilities.tool_calling).toBe(true);
      expect(entry!.capabilities.text_generation).toBe(true);
    });

    it('finds embedding model via findAiModelRegistryEntry', () => {
      const entry = findAiModelRegistryEntry({ provider: 'openai', model: 'text-embedding-3-small' });

      expect(entry).not.toBeNull();
      expect(entry!.capabilities.embeddings).toBe(true);
      expect(entry!.capabilities.text_generation).toBe(false);
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

      expect(entry).not.toBeNull();
      expect(Array.isArray(entry!.tags)).toBe(true);
      expect(entry!.tags.length).toBeGreaterThan(0);
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
      const route = routes[0]!;
      expect(route.route_id).toBe('default.agent_decision');
      expect(Array.isArray(route.preferred_models)).toBe(true);
      expect(route.preferred_models.length).toBeGreaterThan(0);
      expect(route.preferred_models[0]?.provider).toBe('openai');
    });

    it('context_summary route supports multiple task types', () => {
      const routes = listAiRoutePolicies('context_summary');

      expect(routes.length).toBeGreaterThanOrEqual(1);
      const route = routes.find(r => r.route_id === 'default.context_summary');
      expect(route).toBeDefined();
      expect(route!.task_types.length).toBeGreaterThanOrEqual(2);
    });

    it('embedding route has no fallback models', () => {
      const routes = listAiRoutePolicies('embedding');

      expect(routes.length).toBeGreaterThanOrEqual(1);
      const route = routes.find(r => r.route_id === 'default.embedding');
      expect(route).toBeDefined();
      expect(route!.fallback_models).toHaveLength(0);
      expect(route!.defaults?.allow_fallback).toBe(false);
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

      expect(tool).not.toBeNull();
      expect(tool!.name).toBe('get_clock_state');
      expect(tool!.kind).toBe('system');
    });

    it('getAiToolEntry returns null for unknown tool_id', () => {
      expect(getAiToolEntry('nonexistent')).toBeNull();
    });

    it('findAiToolEntryByName finds a tool by name', () => {
      const tool = findAiToolEntryByName('query_memory_blocks');

      expect(tool).not.toBeNull();
      expect(tool!.tool_id).toBe('sys.query_memory_blocks');
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
      expect(resolved[0]!.tool_id).toBe('sys.get_clock_state');
      expect(resolved[1]!.tool_id).toBe('sys.get_entity');
    });

    it('resolveToolsFromRegistry filters out disabled tools', () => {
      const resolved = resolveToolsFromRegistry(['sys.get_clock_state']);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.enabled).toBe(true);
    });

    it('resolveToolsFromRegistry returns empty array for empty input', () => {
      expect(resolveToolsFromRegistry([])).toEqual([]);
    });
  });

  describe('route tool calling constraints', () => {
    it('default.agent_decision route allows tool calling', () => {
      const routes = listAiRoutePolicies('agent_decision');
      const route = routes.find(r => r.route_id === 'default.agent_decision');

      expect(route).toBeDefined();
      expect(route!.constraints?.allow_tool_calling).toBe(true);
    });

    it('other default routes do not have allow_tool_calling set', () => {
      const allRoutes = listAiRoutePolicies();
      const nonAgentRoutes = allRoutes.filter(r => r.route_id !== 'default.agent_decision');

      for (const route of nonAgentRoutes) {
        expect(route.constraints?.allow_tool_calling).toBeUndefined();
      }
    });
  });

});
