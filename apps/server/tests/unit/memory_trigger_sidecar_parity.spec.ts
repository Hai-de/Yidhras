import { afterAll, describe, expect, it } from 'vitest';

import {
  buildMemoryTriggerSourceEvaluateInput,
  createMemoryTriggerEngineProvider
} from '../../src/memory/blocks/provider.js';
import { createMemoryTriggerSidecarClient } from '../../src/memory/blocks/rust_sidecar_client.js';
import type {
  MemoryBehavior,
  MemoryBlock,
  MemoryBlockRecord,
  MemoryEvaluationContext
} from '../../src/memory/blocks/types.js';

const buildContext = (): MemoryEvaluationContext => ({
  actor_ref: {
    identity_id: 'identity-001',
    identity_type: 'user',
    role: 'active',
    agent_id: 'agent-001',
    atmosphere_node_id: null
  },
  resolved_agent_id: 'agent-001',
  pack_id: 'world-death-note',
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

const buildCandidates = (): MemoryBlockRecord[] => {
  const baseBehavior: MemoryBehavior = {
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
      min_score: 2,
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

  const primaryBlock: MemoryBlock = {
    id: 'memory-block-parity-active',
    owner_agent_id: 'agent-001',
    pack_id: 'world-death-note',
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

  const delayedBlock: MemoryBlock = {
    id: 'memory-block-parity-delayed',
    owner_agent_id: 'agent-001',
    pack_id: 'world-death-note',
    kind: 'reminder',
    status: 'active',
    title: 'Delay before reveal',
    content_text: 'Investigate but do not reveal immediately.',
    content_structured: null,
    tags: ['delay'],
    keywords: ['investigate'],
    source_ref: {
      source_kind: 'trace',
      source_id: 'trace-1',
      source_message_id: 'trace-1'
    },
    importance: 0.6,
    salience: 0.5,
    confidence: 0.7,
    created_at_tick: '91',
    updated_at_tick: '96'
  };

  return [
    {
      block: primaryBlock,
      behavior: baseBehavior,
      state: null
    },
    {
      block: delayedBlock,
      behavior: {
        ...baseBehavior,
        retention: {
          retain_rounds_after_trigger: 0,
          cooldown_rounds_after_insert: 0,
          delay_rounds_before_insert: 2
        }
      },
      state: null
    }
  ];
};

const sidecarClient = createMemoryTriggerSidecarClient({
  binaryPath: '',
  timeoutMs: 5000,
  autoRestart: true
});

afterAll(async () => {
  await sidecarClient.stop();
});

describe('memory trigger sidecar parity', () => {
  it('matches TS provider output for evaluate source across active and delayed candidates', async () => {
    const input = buildMemoryTriggerSourceEvaluateInput({
      evaluation_context: buildContext(),
      candidates: buildCandidates()
    });

    const tsProvider = createMemoryTriggerEngineProvider({
      timeoutMs: 5000,
      binaryPath: '',
      autoRestart: true
    });

    const tsResult = await tsProvider.evaluateWithMetadata(input);
    const rustResult = await sidecarClient.evaluateSource(input);

    expect(rustResult.protocol_version).toBe('memory_trigger/v1alpha1');
    expect(rustResult.records).toEqual(tsResult.result.records);
    expect(rustResult.diagnostics).toEqual(tsResult.result.diagnostics);
    expect(rustResult.records[0]?.evaluation.reason).toBe('trigger_rate_blocked');
    expect(rustResult.records[0]?.trigger_rate).toMatchObject({
      present: true,
      value: 0.5,
      applied: true,
      passed: false
    });
    expect(rustResult.diagnostics.trigger_rate.blocked_count).toBeGreaterThanOrEqual(1);
  });

  it('supports handshake and health against the real Rust sidecar process', async () => {
    const handshake = await sidecarClient.getHandshake();
    expect(handshake.accepted).toBe(true);
    expect(handshake.protocol_version).toBe('memory_trigger/v1alpha1');
    expect(handshake.supported_methods).toContain('memory_trigger.source.evaluate');

    const health = await sidecarClient.getHealth();
    expect(health.protocol_version).toBe('memory_trigger/v1alpha1');
    expect(health.transport).toBe('stdio_jsonrpc');
    expect(health.status).toBe('ready');
  });
});
