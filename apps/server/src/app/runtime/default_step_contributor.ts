import type { WorldStepPrepareRequest } from '@yidhras/contracts';

import type {
  StepContribution,
  StepContributor,
  WorldEngineSessionContext
} from './world_engine_contributors.js';

export const DEFAULT_STEP_CONTRIBUTOR_NAME = 'default_clock_advance';
export const DEFAULT_STEP_CONTRIBUTOR_PRIORITY = 100;

/**
 * Built-in step contributor that produces the baseline clock-advance delta.
 * This replaces the hollow prepareStep that previously returned empty arrays.
 */
export const createDefaultStepContributor = (): StepContributor => {
  return {
    name: DEFAULT_STEP_CONTRIBUTOR_NAME,
    priority: DEFAULT_STEP_CONTRIBUTOR_PRIORITY,
    contributePrepare(
      input: WorldStepPrepareRequest,
      context: WorldEngineSessionContext
    ): StepContribution {
      const currentTickNumber = Number(context.current_tick);
      const stepTicksNumber = Number(input.step_ticks);
      const nextTick = (currentTickNumber + stepTicksNumber).toString();
      const currentRevisionNumber = Number(context.current_revision);
      const nextRevision = (currentRevisionNumber + stepTicksNumber).toString();
      const token = `ts-prepared:${input.pack_id}:${Date.now()}`;
      const reason = input.reason ?? 'runtime_loop';

      const previousWorldState = context.entity_states.find(
        state =>
          (state as Record<string, unknown>).entity_id === '__world__' &&
          (state as Record<string, unknown>).state_namespace === 'world'
      ) ?? null;

      const previousStateJson = previousWorldState
        ? ((previousWorldState as Record<string, unknown>).state_json as Record<string, unknown> | null) ?? null
        : null;

      const nextWorldState = {
        ...(previousStateJson ?? {}),
        runtime_step: {
          prepared_token: token,
          reason,
          step_ticks: input.step_ticks,
          base_tick: context.current_tick,
          next_tick: nextTick,
          base_revision: context.current_revision,
          next_revision: nextRevision,
          transition_kind: 'clock_advance',
          session_owner: 'ts_world_engine'
        }
      };

      const ruleExecutionPayload = {
        prepared_token: token,
        reason,
        transition_kind: 'clock_advance',
        base_tick: context.current_tick,
        next_tick: nextTick,
        base_revision: context.current_revision,
        next_revision: nextRevision
      };

      const ruleExecutionRecordId = `world-step:${token}`;

      return {
        delta_operations: [
          {
            op: 'upsert_entity_state' as const,
            target_ref: '__world__',
            namespace: 'world',
            payload: {
              next: nextWorldState,
              previous: previousStateJson ?? {},
              reason
            }
          },
          {
            op: 'append_rule_execution' as const,
            target_ref: '__world__',
            namespace: 'rule_execution_records',
            payload: {
              next: {
                id: ruleExecutionRecordId,
                payload_json: ruleExecutionPayload
              },
              reason
            }
          },
          {
            op: 'set_clock' as const,
            payload: {
              next: {
                previous_tick: context.current_tick,
                next_tick: nextTick,
                previous_revision: context.current_revision,
                next_revision: nextRevision
              },
              reason
            }
          }
        ],
        emitted_events: [
          {
            event_id: `world-step-prepared:${token}`,
            pack_id: input.pack_id,
            event_type: 'world.step.prepared',
            emitted_at_tick: nextTick,
            emitted_at_revision: nextRevision,
            entity_id: '__world__',
            refs: {
              prepared_token: token,
              reason,
              entity_id: '__world__'
            },
            payload: {
              transition_kind: 'clock_advance',
              reason,
              affected_entity_ids: ['__world__']
            }
          }
        ],
        observability: [
          {
            record_id: `obs:${token}:prepared`,
            pack_id: input.pack_id,
            kind: 'diagnostic',
            level: 'info',
            code: 'WORLD_STEP_PREPARED',
            message: 'Prepared world step transition',
            recorded_at_tick: nextTick,
            attributes: {
              prepared_token: token,
              reason,
              step_ticks: input.step_ticks,
              base_tick: context.current_tick,
              next_tick: nextTick,
              base_revision: context.current_revision,
              next_revision: nextRevision,
              transition_kind: 'clock_advance',
              affected_entity_ids: ['__world__'],
              affected_entity_count: 2,
              emitted_event_count: 1
            }
          },
          {
            record_id: `obs:${token}:core-delta-built`,
            pack_id: input.pack_id,
            kind: 'diagnostic',
            level: 'info',
            code: 'WORLD_CORE_DELTA_BUILT',
            message: 'Built prepared Pack Runtime Core delta',
            recorded_at_tick: nextTick,
            attributes: {
              prepared_token: token,
              reason,
              base_tick: context.current_tick,
              next_tick: nextTick,
              base_revision: context.current_revision,
              next_revision: nextRevision,
              delta_operation_count: 3,
              mutated_entity_ids: ['__world__'],
              mutated_namespace_refs: ['__world__/world', 'rule_execution_records'],
              mutated_core_collections: ['entity_states', 'rule_execution_records'],
              appended_rule_execution_id: ruleExecutionRecordId
            }
          },
          {
            record_id: `obs:${token}:prepared-state-summary`,
            pack_id: input.pack_id,
            kind: 'diagnostic',
            level: 'info',
            code: 'WORLD_PREPARED_STATE_SUMMARY',
            message: 'Prepared state summary for Pack Runtime Core',
            recorded_at_tick: nextTick,
            attributes: {
              prepared_token: token,
              mutated_entity_count: 2,
              event_count: 1,
              delta_operation_count: 3,
              mutated_entity_ids: ['__world__'],
              mutated_namespace_refs: ['__world__/world', 'rule_execution_records']
            }
          }
        ]
      };
    }
  };
};