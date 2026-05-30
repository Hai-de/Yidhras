import { describe, expect, it } from 'vitest';

import type { VariableContextInput } from '../../../../src/inference/context/types.js';
import { assembleVariableContext } from '../../../../src/inference/context/variable_context_assembler.js';
import { expectDefined } from '../../../helpers/assertions.js';
import { makeMockConfig } from '../../../helpers/inference-mocks.js';

const baseInput: VariableContextInput = {
  pack: {
    metadata: { id: 'pack-1', name: 'Test Pack', version: '0.1.0' },
    variables: { world_setting: 'fantasy' },
    prompts: { greeting: 'Hello {{name}}' },
    ai: { default_model: 'gpt-4' }
  },
  strategy: 'model_routed',
  attributes: { role: 'player' },
  actor: {
    identity: { id: 'id-1', type: 'agent', name: 'Hero', provider: 'local', status: 'active', claims: null },
    actor_display_name: 'Hero',
    actor_ref: {
      identity_id: 'id-1',
      identity_type: 'agent',
      role: 'active',
      agent_id: 'agent-1',
      atmosphere_node_id: null
    },
    binding_ref: {
      binding_id: 'bind-1',
      role: 'active',
      status: 'active',
      agent_id: 'agent-1',
      atmosphere_node_id: null
    },
    resolved_agent_id: 'agent-1',
    agent_snapshot: { id: 'agent-1', name: 'Hero', type: 'agent', snr: 0.8, is_pinned: false }
  },
  packState: {
    actor_roles: ['hero'],
    actor_state: { health: 100 },
    owned_artifacts: [{ id: 'sword', state: { durability: 80 } }],
    world_state: { season: 'summer' },
    latest_event: null,
    recent_events: []
  },
  packRuntime: {},
  requestInput: {
    agent_id: 'agent-1',
    identity_id: 'id-1',
    idempotency_key: 'ik-1'
  },
  currentTick: '1000'
};

describe('assembleVariableContext', () => {
  // ── Standard 6 layers ─────────────────────────────────────
  describe('standard 6 layers', () => {
    it('returns all 6 default layers when fully enabled', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      expect(result.layers).toHaveLength(6);

      const namespaces = result.layers.map((l) => l.namespace);
      expect(namespaces).toEqual(['system', 'app', 'pack', 'runtime', 'actor', 'request']);
    });

    it('includes correct system layer values', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const systemLayer = expectDefined(result.layers.find((l) => l.namespace === 'system'));
      expect(systemLayer.values.name).toBe('Yidhras');
      expect(systemLayer.values.timezone).toBe('Asia/Shanghai');
    });

    it('resolves pack layer values from runtime objects', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const packLayer = expectDefined(result.layers.find((l) => l.namespace === 'pack'));
      // metadata is injected from input.pack, so it should be the actual object
      expect(packLayer.values.metadata).toEqual({
        id: 'pack-1',
        name: 'Test Pack',
        version: '0.1.0'
      });
    });

    it('resolves runtime layer values', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const runtimeLayer = expectDefined(result.layers.find((l) => l.namespace === 'runtime'));
      expect(runtimeLayer.values.current_tick).toBe('1000');
    });

    it('resolves actor layer values', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const actorLayer = expectDefined(result.layers.find((l) => l.namespace === 'actor'));
      expect(actorLayer.values.display_name).toBe('Hero');
    });

    it('request layer has mutable=true metadata', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const requestLayer = expectDefined(result.layers.find((l) => l.namespace === 'request'));
      expect(requestLayer.metadata?.mutable).toBe(true);
    });
  });

  // ── Disabled layer filtering ──────────────────────────────
  describe('disabled layer filtering', () => {
    it('filters out disabled layers', () => {
      const config = makeMockConfig({
        variableLayers: {
          layers: {
            system: { enabled: false, values: {}, alias_values: {} },
            app: { enabled: true, values: { startup_health: '{{app.startup_health}}' } },
            pack: { enabled: false, values: {}, alias_values: {} },
            runtime: { enabled: true, values: { current_tick: '{{runtime.current_tick}}' } },
            actor: { enabled: false, values: {}, alias_values: {} },
            request: { enabled: true, values: { strategy: '{{request.strategy}}' } }
          }
        }
      });

      const result = assembleVariableContext(baseInput, config);

      expect(result.layers).toHaveLength(3);
      const namespaces = result.layers.map((l) => l.namespace);
      expect(namespaces).toEqual(['app', 'runtime', 'request']);
    });

    it('filters out missing layer configs', () => {
      const config = makeMockConfig({
        variableLayers: {
          layers: {
            system: { enabled: true, values: { name: 'Yidhras' } }
          }
        }
      });

      const result = assembleVariableContext(baseInput, config);

      // Only 'system' has config; other 5 layers in LAYER_ORDER are missing
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].namespace).toBe('system');
    });
  });

  // ── previous_agent_output layer ───────────────────────────
  describe('previous_agent_output', () => {
    it('appends 7th layer when previous_agent_output has data', () => {
      const config = makeMockConfig();
      const inputWithPrev: VariableContextInput = {
        ...baseInput,
        requestInput: {
          ...baseInput.requestInput,
          previous_agent_output: {
            'step-agent-2-1': {
              source_type: 'previous_agent_output' as const,
              workflow_run_id: 'wf-1',
              step_id: 'step-1',
              agent_id: 'agent-2',
              content: {
                reasoning: 'dragon is a threat',
                decision_summary: 'attack the dragon',
                grounding_result_type: 'exact' as const,
                semantic_intent: 'combat'
              }
            }
          }
        }
      };

      const result = assembleVariableContext(inputWithPrev, config);

      expect(result.layers).toHaveLength(7);
      const lastLayer = result.layers[6];
      expect(lastLayer.namespace).toBe('previous_agent_output');
      expect(lastLayer.values).toBeDefined();
    });

    it('does NOT append previous_agent_output layer when empty', () => {
      const config = makeMockConfig();
      // baseInput has no previous_agent_output
      const result = assembleVariableContext(baseInput, config);

      const prevLayer = result.layers.find((l) => l.namespace === 'previous_agent_output');
      expect(prevLayer).toBeUndefined();
      expect(result.layers).toHaveLength(6);
    });
  });

  // ── Empty config → empty context ───────────────────────────
  describe('empty layers config', () => {
    it('returns empty context when no layers configured', () => {
      const config = makeMockConfig({
        variableLayers: { layers: {} }
      });

      const result = assembleVariableContext(baseInput, config);

      expect(result.layers).toHaveLength(0);
    });

    it('returns empty context when variable_context is not present in config', () => {
      const config = { config_version: 1 } as const;

      const result = assembleVariableContext(baseInput, config as never);

      // No variable_context → no layers configured → empty context
      expect(result.layers).toHaveLength(0);
    });
  });

  // ── Request layer mutable flag ────────────────────────────
  describe('request layer metadata', () => {
    it('marks request layer as mutable: true', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const reqLayer = expectDefined(result.layers.find((l) => l.namespace === 'request'));
      expect(reqLayer.metadata?.mutable).toBe(true);
    });

    it('marks non-request layers without mutable flag', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      const nonRequestLayers = result.layers.filter((l) => l.namespace !== 'request');
      for (const layer of nonRequestLayers) {
        expect(layer.metadata?.mutable).toBeUndefined();
      }
    });

    it('all layers have trusted: true', () => {
      const config = makeMockConfig();
      const result = assembleVariableContext(baseInput, config);

      for (const layer of result.layers) {
        expect(layer.metadata?.trusted).toBe(true);
      }
    });
  });

  // ── No config ─────────────────────────────────────────────
  describe('no config', () => {
    it('returns empty layers when no config is passed', () => {
      const result = assembleVariableContext(baseInput);

      expect(result.layers).toHaveLength(0);
    });
  });
});
