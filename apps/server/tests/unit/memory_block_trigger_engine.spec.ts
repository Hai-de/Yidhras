import { describe, expect, it } from 'vitest';

import { evaluateMemoryLogicExpr } from '../../src/memory/blocks/logic_dsl.js';
import {
  applyMemoryActivationToRuntimeState,
  evaluateMemoryBlockActivation
} from '../../src/memory/blocks/trigger_engine.js';

const TEST_PACK_ID = 'world-test-pack';

describe('memory block trigger engine', () => {
  it('evaluates logic DSL expressions over pack state and recent sources', () => {
    const root = {
      pack_state: {
        actor_state: {
          murderous_intent: true
        },
        world_state: {
          investigation_heat: 2
        }
      },
      recent: {
        event: [
          {
            payload: {
              semantic_type: 'suspicious_death_occurred'
            }
          }
        ]
      }
    };

    expect(evaluateMemoryLogicExpr({
      op: 'and',
      items: [
        { op: 'eq', path: 'pack_state.actor_state.murderous_intent', value: true },
        { op: 'gt', path: 'pack_state.world_state.investigation_heat', value: 1 }
      ]
    }, root)).toBe(true);

    expect(evaluateMemoryLogicExpr({
      op: 'eq',
      path: 'recent.event.*.payload.semantic_type',
      value: 'suspicious_death_occurred'
    }, root)).toBe(true);
  });

  it('evaluates always, keyword, logic and recent_source triggers and updates runtime state', () => {
    const context = {
      actor_ref: {
        identity_id: 'identity-001',
        identity_type: 'user' as const,
        role: 'active' as const,
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
            id: 'trace-001-message',
            kind: 'trace' as const,
            occurred_at_tick: '99',
            payload: {
              reasoning: 'Need to investigate L before writing the next name.'
            }
          }
        ],
        intent: [
          {
            id: 'intent-001',
            kind: 'intent' as const,
            occurred_at_tick: '98',
            payload: {
              intent_type: 'observe'
            }
          }
        ],
        event: [
          {
            id: 'event-001',
            kind: 'event' as const,
            occurred_at_tick: '97',
            payload: {
              semantic_type: 'suspicious_death_occurred',
              title: 'Suspicious death',
              description: 'A new suspicious death raised more questions.'
            }
          }
        ]
      }
    };

    const block = {
      id: 'memory-block-logic-001',
      owner_agent_id: 'agent-001',
      pack_id: TEST_PACK_ID,
      kind: 'reflection' as const,
      status: 'active' as const,
      title: 'Investigate L carefully',
      content_text: 'Need to investigate L before the next judgement.',
      content_structured: null,
      tags: ['investigation'],
      keywords: ['investigate', 'L'],
      source_ref: {
        source_kind: 'trace' as const,
        source_id: 'trace-001-message',
        source_message_id: 'trace-001-message'
      },
      importance: 0.8,
      salience: 0.7,
      confidence: 0.9,
      created_at_tick: '90',
      updated_at_tick: '95'
    };

    const behavior = {
      mutation: {
        allow_insert: true,
        allow_rewrite: true,
        allow_delete: true
      },
      placement: {
        slot: 'memory_long_term' as const,
        anchor: null,
        mode: 'append' as const,
        depth: 5,
        order: 1
      },
      activation: {
        mode: 'hybrid' as const,
        trigger_rate: 1,
        min_score: 3,
        triggers: [
          {
            type: 'keyword' as const,
            match: 'any' as const,
            keywords: ['investigate'],
            fields: ['content_text', 'recent_trace_reasoning'],
            score: 1
          },
          {
            type: 'logic' as const,
            expr: {
              op: 'and' as const,
              items: [
                { op: 'eq' as const, path: 'pack_state.actor_state.murderous_intent', value: true },
                { op: 'gt' as const, path: 'pack_state.world_state.investigation_heat', value: 1 }
              ]
            },
            score: 1
          },
          {
            type: 'recent_source' as const,
            source: 'event' as const,
            match: {
              field: 'semantic_type',
              op: 'eq' as const,
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

    const evaluation = evaluateMemoryBlockActivation({
      block,
      behavior,
      context
    });

    expect(evaluation.status).toBe('active');
    expect(evaluation.activation_score).toBe(3);
    expect(evaluation.matched_triggers).toHaveLength(3);
    expect(evaluation.recent_distance_from_latest_message).toBe(0);

    const nextState = applyMemoryActivationToRuntimeState({
      behavior,
      evaluation,
      currentTick: '100'
    });

    expect(nextState.trigger_count).toBe(1);
    expect(nextState.last_triggered_tick).toBe('100');
    expect(nextState.last_inserted_tick).toBe('100');
    expect(nextState.retain_until_tick).toBe('102');
    expect(nextState.cooldown_until_tick).toBe('103');
  });
});
