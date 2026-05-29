import { beforeEach,describe, expect, it } from 'vitest';

import {
  BUILTIN_SLOT_IDS,
  findAiModelRegistryEntry,
  findAiToolEntryByName,
  getAiProviderConfig,
  getAiRegistryConfig,
  getAiRegistryMetadata,
  getAiToolEntry,
  getDynamicModelsMetadata,
  getPromptSlotRegistry,
  getPromptSlotRegistryMetadata,
  listAiModelRegistryEntries,
  listAiProviderConfigs,
  listAiRoutePolicies,
  listAiToolEntries,
  listDynamicSlots,
  registerDynamicSlot,
  resetAiRegistryCache,
  resetPromptSlotRegistryCache,
  resolveToolsFromRegistry,
  resolveToolSpecsFromRegistry,
  setSlotEnabled,
  unregisterDynamicSlot} from '../../../src/ai/registry.js';

// ---------------------------------------------------------------------------
// AI Registry Config
// ---------------------------------------------------------------------------
describe('AI registry config', () => {
  beforeEach(() => {
    resetAiRegistryCache();
  });

  describe('getAiRegistryConfig', () => {
    it('returns a config with providers, models, routes, tools arrays', () => {
      const config = getAiRegistryConfig();
      expect(config).toBeDefined();
      expect(config.version).toBe(1);
      expect(Array.isArray(config.providers)).toBe(true);
      expect(Array.isArray(config.models)).toBe(true);
      expect(Array.isArray(config.routes)).toBe(true);
      expect(Array.isArray(config.tools)).toBe(true);
    });

    it('includes builtin providers', () => {
      const config = getAiRegistryConfig();
      const providerNames = config.providers.map(p => p.provider);
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('anthropic');
    });

    it('includes builtin models', () => {
      const config = getAiRegistryConfig();
      expect(config.models.length).toBeGreaterThan(0);
      const first = config.models[0];
      expect(first.provider).toBeDefined();
      expect(first.model).toBeDefined();
      expect(first.endpoint_kind).toBeDefined();
      expect(first.capabilities).toBeDefined();
    });

    it('includes builtin routes', () => {
      const config = getAiRegistryConfig();
      expect(config.routes.length).toBeGreaterThan(0);
      const first = config.routes[0];
      expect(first.route_id).toBeDefined();
      expect(first.task_types).toBeDefined();
    });

    it('includes builtin tools', () => {
      const config = getAiRegistryConfig();
      expect((config.tools ?? []).length).toBeGreaterThan(0);
    });
  });

  describe('getDynamicModelsMetadata', () => {
    it('returns metadata with count and lastFetchedAt', () => {
      const meta = getDynamicModelsMetadata();
      expect(meta).toBeDefined();
      expect(typeof meta.count).toBe('number');
      expect(meta.count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAiRegistryMetadata', () => {
    it('returns metadata with workspaceRoot and configPath', () => {
      const meta = getAiRegistryMetadata();
      expect(meta).toBeDefined();
      expect(typeof meta.workspaceRoot).toBe('string');
      expect(typeof meta.configPath).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// Provider Config Queries
// ---------------------------------------------------------------------------
describe('AI provider config queries', () => {
  beforeEach(() => {
    resetAiRegistryCache();
  });

  describe('listAiProviderConfigs', () => {
    it('returns an array of provider configs', () => {
      const providers = listAiProviderConfigs();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
      for (const p of providers) {
        expect(p.provider).toBeDefined();
        expect(typeof p.enabled).toBe('boolean');
      }
    });
  });

  describe('getAiProviderConfig', () => {
    it('returns config for known provider', () => {
      const config = getAiProviderConfig('openai');
      expect(config).not.toBeNull();
      expect(config!.provider).toBe('openai');
      expect(config!.enabled).toBe(true);
    });

    it('returns null for unknown provider', () => {
      const config = getAiProviderConfig('nonexistent_provider_xyz');
      expect(config).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Model Registry Queries
// ---------------------------------------------------------------------------
describe('AI model registry queries', () => {
  beforeEach(() => {
    resetAiRegistryCache();
  });

  describe('listAiModelRegistryEntries', () => {
    it('returns all model entries', () => {
      const models = listAiModelRegistryEntries();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('findAiModelRegistryEntry', () => {
    it('finds a known model by provider+model', () => {
      const config = getAiRegistryConfig();
      const first = config.models[0];
      const found = findAiModelRegistryEntry({ provider: first.provider, model: first.model });
      expect(found).not.toBeNull();
      expect(found!.provider).toBe(first.provider);
      expect(found!.model).toBe(first.model);
    });

    it('returns null for unknown model', () => {
      const found = findAiModelRegistryEntry({ provider: 'nope', model: 'nope' });
      expect(found).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Route Policy Queries
// ---------------------------------------------------------------------------
describe('AI route policy queries', () => {
  beforeEach(() => {
    resetAiRegistryCache();
  });

  describe('listAiRoutePolicies', () => {
    it('returns all routes when no filter', () => {
      const routes = listAiRoutePolicies();
      expect(Array.isArray(routes)).toBe(true);
      expect(routes.length).toBeGreaterThan(0);
    });

    it('filters routes by task type', () => {
      const allRoutes = listAiRoutePolicies();
      const first = allRoutes[0];
      if (first.task_types.length > 0) {
        const filtered = listAiRoutePolicies(first.task_types[0]);
        expect(filtered.length).toBeGreaterThanOrEqual(1);
        for (const r of filtered) {
          expect(r.task_types).toContain(first.task_types[0]);
        }
      }
    });

    it('returns empty array for non-existent task type', () => {
      const filtered = listAiRoutePolicies('nonexistent_task_type_xyz');
      expect(filtered).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool Registry Queries
// ---------------------------------------------------------------------------
describe('AI tool registry queries', () => {
  beforeEach(() => {
    resetAiRegistryCache();
  });

  describe('listAiToolEntries', () => {
    it('returns all tool entries', () => {
      const tools = listAiToolEntries();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('getAiToolEntry', () => {
    it('finds a tool by tool_id', () => {
      const tools = listAiToolEntries();
      const first = tools[0];
      const found = getAiToolEntry(first.tool_id);
      expect(found).not.toBeNull();
      expect(found!.tool_id).toBe(first.tool_id);
    });

    it('returns null for unknown tool_id', () => {
      const found = getAiToolEntry('nonexistent_tool_id');
      expect(found).toBeNull();
    });
  });

  describe('findAiToolEntryByName', () => {
    it('finds a tool by name', () => {
      const tools = listAiToolEntries();
      const first = tools[0];
      const found = findAiToolEntryByName(first.name);
      expect(found).not.toBeNull();
      expect(found!.name).toBe(first.name);
    });

    it('returns null for unknown tool name', () => {
      const found = findAiToolEntryByName('nonexistent_tool_xyz');
      expect(found).toBeNull();
    });
  });

  describe('resolveToolsFromRegistry', () => {
    it('resolves enabled tools by tool_id', () => {
      const tools = listAiToolEntries();
      const enabledTools = tools.filter(t => t.enabled);
      if (enabledTools.length > 0) {
        const ids = enabledTools.map(t => t.tool_id);
        const resolved = resolveToolsFromRegistry(ids);
        expect(resolved.length).toBe(enabledTools.length);
        for (const r of resolved) {
          expect(r.enabled).toBe(true);
          expect(ids).toContain(r.tool_id);
        }
      }
    });

    it('skips disabled tools', () => {
      const tools = listAiToolEntries();
      const disabledTools = tools.filter(t => !t.enabled);
      if (disabledTools.length > 0) {
        const ids = disabledTools.map(t => t.tool_id);
        const resolved = resolveToolsFromRegistry(ids);
        expect(resolved.length).toBe(0);
      }
    });

    it('skips unknown tool ids', () => {
      const resolved = resolveToolsFromRegistry(['nonexistent_id']);
      expect(resolved).toEqual([]);
    });
  });

  describe('resolveToolSpecsFromRegistry', () => {
    it('returns tool specs with expected shape', () => {
      const tools = listAiToolEntries();
      const enabledTools = tools.filter(t => t.enabled);
      if (enabledTools.length > 0) {
        const ids = enabledTools.map(t => t.tool_id);
        const specs = resolveToolSpecsFromRegistry(ids);
        expect(specs.length).toBe(enabledTools.length);
        for (const spec of specs) {
          expect(spec.name).toBeDefined();
          expect(spec.description).toBeDefined();
          expect(spec.input_schema).toBeDefined();
        }
      }
    });

    it('returns empty array for unknown ids', () => {
      const specs = resolveToolSpecsFromRegistry(['nonexistent_id']);
      expect(specs).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Prompt Slot Registry
// ---------------------------------------------------------------------------
describe('Prompt Slot Registry', () => {
  beforeEach(() => {
    resetPromptSlotRegistryCache();
  });

  describe('getPromptSlotRegistry', () => {
    it('returns version and slots', () => {
      const registry = getPromptSlotRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.version).toBe('number');
      expect(registry.version).toBeGreaterThan(0);
      expect(typeof registry.slots).toBe('object');
    });

    it('includes builtin slot ids in slots', () => {
      const registry = getPromptSlotRegistry();
      for (const builtinId of BUILTIN_SLOT_IDS) {
        expect(registry.slots[builtinId]).toBeDefined();
        expect(registry.slots[builtinId].id).toBe(builtinId);
        expect(typeof registry.slots[builtinId].enabled).toBe('boolean');
        expect(typeof registry.slots[builtinId].include_in_combined).toBe('boolean');
        expect(typeof registry.slots[builtinId].default_priority).toBe('number');
      }
    });
  });

  describe('getPromptSlotRegistryMetadata', () => {
    it('returns metadata with workspaceRoot', () => {
      const meta = getPromptSlotRegistryMetadata();
      expect(meta).toBeDefined();
      expect(typeof meta.workspaceRoot).toBe('string');
    });
  });

  describe('registerDynamicSlot', () => {
    it('registers a new dynamic slot', () => {
      const result = registerDynamicSlot({
        id: 'test_dynamic_slot',
        display_name: 'Test Dynamic Slot',
        default_priority: 99,
        include_in_combined: false,
        enabled: true
      });
      expect(result).toBe(true);

      const registry = getPromptSlotRegistry();
      expect(registry.slots['test_dynamic_slot']).toBeDefined();
      expect(registry.slots['test_dynamic_slot'].display_name).toBe('Test Dynamic Slot');
    });

    it('rejects builtin slot ids', () => {
      const builtinId = [...BUILTIN_SLOT_IDS][0];
      const result = registerDynamicSlot({
        id: builtinId,
        display_name: 'Should Fail',
        default_priority: 99,
        include_in_combined: false,
        enabled: true
      });
      expect(result).toBe(false);
    });

    it('rejects duplicate when yaml slot exists', () => {
      const builtinId = [...BUILTIN_SLOT_IDS][0];
      const result = registerDynamicSlot({
        id: builtinId,
        display_name: 'Duplicate',
        default_priority: 99,
        include_in_combined: false,
        enabled: true
      });
      expect(result).toBe(false);
    });
  });

  describe('unregisterDynamicSlot', () => {
    it('unregisters a previously registered dynamic slot', () => {
      registerDynamicSlot({
        id: 'temp_slot_unregister',
        display_name: 'Temp',
        default_priority: 99,
        include_in_combined: false,
        enabled: true
      });
      const result = unregisterDynamicSlot('temp_slot_unregister');
      expect(result).toBe(true);

      const registry = getPromptSlotRegistry();
      expect(registry.slots['temp_slot_unregister']).toBeUndefined();
    });

    it('returns false for non-existent dynamic slot', () => {
      const result = unregisterDynamicSlot('nonexistent_slot');
      expect(result).toBe(false);
    });

    it('rejects unregistering builtin slot ids', () => {
      const builtinId = [...BUILTIN_SLOT_IDS][0];
      const result = unregisterDynamicSlot(builtinId);
      expect(result).toBe(false);
    });
  });

  describe('setSlotEnabled', () => {
    it('toggles enabled state for a dynamic slot', () => {
      registerDynamicSlot({
        id: 'temp_slot_toggle',
        display_name: 'Toggle',
        default_priority: 99,
        include_in_combined: false,
        enabled: true
      });

      const disabled = setSlotEnabled('temp_slot_toggle', false);
      expect(disabled).toBe(true);

      const registry = getPromptSlotRegistry();
      expect(registry.slots['temp_slot_toggle'].enabled).toBe(false);

      // Re-enable
      setSlotEnabled('temp_slot_toggle', true);
      const registry2 = getPromptSlotRegistry();
      expect(registry2.slots['temp_slot_toggle'].enabled).toBe(true);
    });

    it('toggles enabled state for a yaml slot', () => {
      const builtinId = [...BUILTIN_SLOT_IDS][0];
      const result = setSlotEnabled(builtinId, false);
      expect(result).toBe(true);

      const registry = getPromptSlotRegistry();
      expect(registry.slots[builtinId].enabled).toBe(false);

      // Re-enable
      setSlotEnabled(builtinId, true);
    });

    it('returns false for non-existent slot', () => {
      const result = setSlotEnabled('nonexistent_slot_xyz', false);
      expect(result).toBe(false);
    });
  });

  describe('listDynamicSlots', () => {
    it('returns only dynamic slots, not yaml slots', () => {
      // Ensure empty first
      for (const slot of listDynamicSlots()) {
        unregisterDynamicSlot(slot.id);
      }
      expect(listDynamicSlots()).toHaveLength(0);

      registerDynamicSlot({
        id: 'dynamic_list_test',
        display_name: 'List Test',
        default_priority: 50,
        include_in_combined: false,
        enabled: true
      });

      const dynamic = listDynamicSlots();
      expect(dynamic.length).toBeGreaterThanOrEqual(1);
      const found = dynamic.find(s => s.id === 'dynamic_list_test');
      expect(found).toBeDefined();

      // Cleanup
      unregisterDynamicSlot('dynamic_list_test');
    });
  });
});
