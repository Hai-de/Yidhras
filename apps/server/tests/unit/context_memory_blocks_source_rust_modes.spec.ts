import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { buildContextNodesFromMemoryBlocks } from '../../src/context/sources/memory_blocks.js';
import type { IdentityContext } from '../../src/identity/types.js';
import type { InferencePackStateSnapshot } from '../../src/inference/types.js';
import type { LongMemoryBlockStore, MemoryBehavior, MemoryBlock, MemoryRuntimeState } from '../../src/memory/blocks/types.js';

const TEST_PACK_ID = 'world-test-pack';

const buildContext = (): AppContext => ({
  prisma: {
    policy: {
      findMany: async () => [{ field: '*', effect: 'allow', conditions: {}, priority: 1 }]
    },
    inferenceTrace: {
      findMany: async () => [
        {
          id: 'trace-1',
          actor_ref: {
            agent_id: 'agent-001'
          },
          strategy: 'rule_based',
          provider: 'rule_based',
          decision: {
            reasoning: 'Need to investigate L before the next action.'
          },
          updated_at: 999n
        }
      ]
    },
    actionIntent: {
      findMany: async () => []
    },
    event: {
      findMany: async () => [
        {
          id: 'event-1',
          title: 'Suspicious death',
          description: 'A new suspicious death raised more questions.',
          type: 'history',
          impact_data: JSON.stringify({ semantic_type: 'suspicious_death_occurred' }),
          tick: 999n,
          source_action_intent: {
            actor_ref: {
              agent_id: 'agent-001'
            }
          }
        }
      ]
    }
  } as unknown as AppContext['prisma'],
  sim: {
    getCurrentTick() {
      return 1000n;
    }
  } as AppContext['sim'],
  notifications: {
    push(level, content) {
      return { id: 'noop', level, content, timestamp: Date.now() };
    },
    getMessages() {
      return [];
    },
    clear() {
      // noop
    }
  },
  startupHealth: {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: [TEST_PACK_ID],
    errors: []
  },
  getRuntimeReady() {
    return true;
  },
  setRuntimeReady() {
    // noop
  },
  getPaused() {
    return false;
  },
  setPaused() {
    // noop
  },
  assertRuntimeReady() {
    // noop
  }
});

const buildLongMemoryBlockStoreStub = (updates: MemoryRuntimeState[] = []): LongMemoryBlockStore => ({
  async listCandidateBlocks() {
    const block: MemoryBlock = {
      id: 'memory-block-1',
      owner_agent_id: 'agent-001',
      pack_id: TEST_PACK_ID,
      kind: 'reflection',
      status: 'active',
      title: 'Long suspicion memo',
      content_text: 'Need to investigate L before the next judgement.',
      content_structured: { risk: 'high' },
      tags: ['memory-block', 'suspicion'],
      keywords: ['investigate', 'death'],
      source_ref: {
        source_kind: 'trace',
        source_id: 'trace-1',
        source_message_id: 'trace-1'
      },
      importance: 0.88,
      salience: 0.77,
      confidence: 0.81,
      created_at_tick: '900',
      updated_at_tick: '999'
    };

    const behavior: MemoryBehavior = {
      mutation: {
        allow_insert: true,
        allow_rewrite: true,
        allow_delete: true
      },
      placement: {
        slot: 'memory_long_term',
        anchor: null,
        mode: 'append',
        depth: 10,
        order: 2
      },
      activation: {
        mode: 'hybrid',
        trigger_rate: 0.5,
        min_score: 3,
        triggers: [
          {
            type: 'keyword',
            match: 'any',
            keywords: ['investigate'],
            fields: ['content_text', 'recent_trace_reasoning'],
            score: 1
          },
          {
            type: 'logic',
            expr: {
              op: 'and',
              items: [
                { op: 'eq', path: 'pack_state.actor_state.murderous_intent', value: true },
                { op: 'gt', path: 'pack_state.world_state.investigation_heat', value: 1 }
              ]
            },
            score: 1
          },
          {
            type: 'recent_source',
            source: 'event',
            match: {
              field: 'semantic_type',
              op: 'eq',
              value: 'suspicious_death_occurred'
            },
            score: 1
          }
        ]
      },
      retention: {
        retain_rounds_after_trigger: 2,
        cooldown_rounds_after_insert: 3,
        delay_rounds_before_insert: 0
      }
    };

    return [{ block, behavior, state: null }];
  },
  async upsertBlock() {
    throw new Error('unexpected upsertBlock call in test');
  },
  async updateRuntimeState(state: MemoryRuntimeState) {
    updates.push(state);
    return state;
  },
  async hardDeleteBlock() {
    throw new Error('unexpected hardDeleteBlock call in test');
  }
});

const identity: IdentityContext = {
  id: 'identity-001',
  type: 'user',
  name: 'Tester',
  provider: 'test',
  status: 'active',
  claims: null
};

const packState: InferencePackStateSnapshot = {
  actor_roles: ['planner'],
  actor_state: {
    murderous_intent: true
  },
  owned_artifacts: [],
  world_state: {
    investigation_heat: 2
  },
  latest_event: {
    event_id: 'evt-1',
    title: 'Suspicious death occurred',
    type: 'history',
    semantic_type: 'suspicious_death_occurred',
    created_at: '999'
  }
};

describe('memory blocks source rust modes', () => {
  it('uses TS mode and returns active memory block nodes with engine metadata', async () => {
    resetRuntimeConfigCache();
    process.env.MEMORY_TRIGGER_ENGINE_MODE = 'ts';
    const updates: MemoryRuntimeState[] = [];

    const result = await buildContextNodesFromMemoryBlocks({
      context: buildContext(),
      actor_ref: {
        identity_id: 'identity-001',
        identity_type: 'user',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      identity,
      resolved_agent_id: 'agent-001',
      pack_id: TEST_PACK_ID,
      tick: 1000n,
      attributes: {},
      pack_state: packState,
      longMemoryBlockStore: buildLongMemoryBlockStoreStub(updates)
    });

    expect(result.evaluation_metadata).toEqual({
      provider: 'ts',
      fallback: false,
      fallback_reason: null,
      parity_status: 'skipped',
      parity_diff_count: 0
    });
    expect(result.ignored_feature_counts).toEqual({ trigger_rate_ignored_count: 1 });
    expect(result.evaluations).toEqual([
      expect.objectContaining({ memory_id: 'memory-block-1', status: 'active', activation_score: 3 })
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.metadata?.memory_block_id).toBe('memory-block-1');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.currently_active).toBe(true);

    delete process.env.MEMORY_TRIGGER_ENGINE_MODE;
    resetRuntimeConfigCache();
  });

  it('falls back to TS metadata when rust_primary sidecar is unavailable', async () => {
    resetRuntimeConfigCache();
    process.env.MEMORY_TRIGGER_ENGINE_MODE = 'rust_primary';
    process.env.MEMORY_TRIGGER_ENGINE_BINARY_PATH = 'apps/server/rust/memory_trigger_sidecar/target/debug/does-not-exist';
    const updates: MemoryRuntimeState[] = [];

    const result = await buildContextNodesFromMemoryBlocks({
      context: buildContext(),
      actor_ref: {
        identity_id: 'identity-001',
        identity_type: 'user',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      identity,
      resolved_agent_id: 'agent-001',
      pack_id: TEST_PACK_ID,
      tick: 1000n,
      attributes: {},
      pack_state: packState,
      longMemoryBlockStore: buildLongMemoryBlockStoreStub(updates)
    });

    expect(result.evaluation_metadata?.provider).toBe('rust_fallback_to_ts');
    expect(result.evaluation_metadata?.fallback).toBe(true);
    expect(result.evaluation_metadata?.fallback_reason).toContain('Memory trigger sidecar binary does not exist');
    expect(result.evaluations[0]?.status).toBe('active');
    expect(result.nodes).toHaveLength(1);

    delete process.env.MEMORY_TRIGGER_ENGINE_MODE;
    delete process.env.MEMORY_TRIGGER_ENGINE_BINARY_PATH;
    resetRuntimeConfigCache();
  });
});
