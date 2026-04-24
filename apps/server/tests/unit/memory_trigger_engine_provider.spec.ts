import { describe, expect, it } from 'vitest';

import {
  buildMemoryTriggerSourceEvaluateInput,
  createMemoryTriggerEngineProvider
} from '../../src/memory/blocks/provider.js';
import type {
  MemoryBehavior,
  MemoryBlock,
  MemoryBlockRecord,
  MemoryEvaluationContext
} from '../../src/memory/blocks/types.js';

const TEST_PACK_ID = 'world-test-pack';

const buildContext = (): MemoryEvaluationContext => ({
  actor_ref: {
    identity_id: 'identity-001',
    identity_type: 'user',
    role: 'active',
    agent_id: 'agent-001',
    atmosphere_node_id: null
  },
  resolved_agent_id: 'agent-001',
  pack_id: TEST_PACK_ID,
  current_tick: '100',
  attributes: {
    scheduler_reason: 'event_followup'
  },
  pack_state: {
    actor_state: {
      murderous_intent: true
    },
    world_state: {
      investigation_heat: 2
    },
    latest_event: {
      semantic_type: 'suspicious_death_occurred'
    }
  },
  recent: {
    trace: [
      {
        id: 'trace-1',
        kind: 'trace',
        occurred_at_tick: '99',
        payload: {
          reasoning: 'Need to investigate L before the next action.'
        }
      }
    ],
    event: [
      {
        id: 'event-1',
        kind: 'event',
        occurred_at_tick: '98',
        payload: {
          semantic_type: 'suspicious_death_occurred',
          title: 'Suspicious death',
          description: 'A new suspicious death raised more questions.'
        }
      }
    ]
  }
});

const buildCandidate = (): MemoryBlockRecord => {
  const block: MemoryBlock = {
    id: 'memory-block-provider-1',
    owner_agent_id: 'agent-001',
    pack_id: TEST_PACK_ID,
    kind: 'reflection',
    status: 'active',
    title: 'Investigate L carefully',
    content_text: 'Need to investigate L before the next judgement.',
    content_structured: null,
    tags: ['investigation'],
    keywords: ['investigate', 'L'],
    source_ref: {
      source_kind: 'trace',
      source_id: 'trace-1',
      source_message_id: 'trace-1'
    },
    importance: 0.8,
    salience: 0.7,
    confidence: 0.9,
    created_at_tick: '90',
    updated_at_tick: '95'
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
      depth: 5,
      order: 1
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

  return {
    block,
    behavior,
    state: null
  };
};

describe('memory trigger engine provider', () => {
  it('falls back to TS with deprecation warning when rust_primary sidecar is unavailable', async () => {
    const provider = createMemoryTriggerEngineProvider({
      timeoutMs: 100,
      binaryPath: 'apps/server/rust/memory_trigger_sidecar/target/debug/does-not-exist',
      autoRestart: true
    });

    const result = await provider.evaluateWithMetadata(buildMemoryTriggerSourceEvaluateInput({
      evaluation_context: buildContext(),
      candidates: [buildCandidate()]
    }));

    expect(result.metadata.provider).toBe('rust_fallback_to_ts');
    expect(result.metadata.fallback).toBe(true);
    expect(result.metadata.fallback_reason).toContain('Memory trigger sidecar binary does not exist');
    expect(result.metadata.parity_status).toBe('skipped');
    expect(result.metadata.parity_diff_count).toBe(0);
    expect(result.result.records[0]?.evaluation.status).toBe('inactive');
    expect(result.result.records[0]?.evaluation.reason).toBe('trigger_rate_blocked');
  });
});
