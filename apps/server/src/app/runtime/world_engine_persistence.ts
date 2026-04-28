import {
  PreparedWorldStep,
  WORLD_ENGINE_PROTOCOL_VERSION,
  WorldEngineCommitResult,
  type WorldStateDeltaOperation,
  WorldStepAbortRequest,
  WorldStepCommitRequest,
  WorldStepPrepareRequest} from '@yidhras/contracts';

import type { PackRuntimeEntityStateRecord, PackRuntimeRuleExecutionRecord } from '../../packs/runtime/core_models.js';
import { evaluateStateTransforms } from '../../packs/runtime/state_transform_evaluator.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import { listPackEntityStates, upsertPackEntityState } from '../../packs/storage/entity_state_repo.js';
import { recordPackRuleExecution } from '../../packs/storage/rule_execution_repo.js';
import { ApiError } from '../../utils/api_error.js';
import { createLogger } from '../../utils/logger.js';
import type { AppContext } from '../context.js';
import type {
  RuntimeClockProjectionSnapshot,
  WorldEngineCommitProjectionInput
} from './runtime_clock_projection.js';
import type { WorldEnginePort } from './world_engine_ports.js';

export interface PackRuntimeCoreDeltaPersistenceResult {
  persisted_revision: string;
  applied_operations: WorldStateDeltaOperation['op'][];
  persisted_entity_states: PackRuntimeEntityStateRecord[];
  persisted_rule_execution_records: PackRuntimeRuleExecutionRecord[];
  clock_delta: {
    previous_tick: string | null;
    next_tick: string | null;
    previous_revision: string | null;
    next_revision: string | null;
  } | null;
  observability: Array<{
    code: 'WORLD_CORE_DELTA_APPLIED' | 'WORLD_CORE_DELTA_ABORTED';
    attributes: Record<string, unknown>;
  }>;
}

export interface WorldEnginePersistencePort {
  persistPreparedStep(input: {
    context: AppContext;
    prepared: PreparedWorldStep;
    correlationId?: string;
  }): Promise<PackRuntimeCoreDeltaPersistenceResult>;
}

export interface WorldEngineSingleFlightState {
  pack_id: string;
  prepared_token: string;
  status: 'preparing' | 'persisting' | 'committing' | 'tainted';
  updated_at: number;
  reason?: string;
}

export class WorldEngineStepCoordinator {
  private singleFlightStates = new Map<string, WorldEngineSingleFlightState>();
  private taintedPackIds = new Set<string>();

  listTaintedPackIds(): string[] {
    return Array.from(this.taintedPackIds.values());
  }

  clearTaintedPackId(packId: string): void {
    this.taintedPackIds.delete(packId.trim());
  }

  setSingleFlightState(state: WorldEngineSingleFlightState): void {
    this.singleFlightStates.set(state.pack_id, state);
  }

  clearSingleFlightState(packId: string): void {
    this.singleFlightStates.delete(packId);
  }

  markTainted(packId: string, reason: string): void {
    this.taintedPackIds.add(packId);
    this.setSingleFlightState({
      pack_id: packId,
      prepared_token: this.singleFlightStates.get(packId)?.prepared_token ?? 'unknown',
      status: 'tainted',
      updated_at: Date.now(),
      reason
    });
  }

  assertNotTainted(packId: string): void {
    if (!this.taintedPackIds.has(packId)) {
      return;
    }

    throw new ApiError(409, 'TAINTED_SESSION', 'World engine pack session is tainted and must be reloaded before continuing', {
      pack_id: packId
    });
  }

  assertSingleFlightAvailable(packId: string): void {
    const existing = this.singleFlightStates.get(packId);
    if (!existing) {
      return;
    }

    throw new ApiError(409, 'PREPARED_STEP_CONFLICT', 'A world engine prepared step is already in flight for this pack', {
      pack_id: packId,
      prepared_token: existing.prepared_token,
      status: existing.status,
      reason: existing.reason ?? null
    });
  }
}

const defaultCoordinator = new WorldEngineStepCoordinator();

export const createWorldEngineStepCoordinator = (): WorldEngineStepCoordinator => {
  return new WorldEngineStepCoordinator();
};

const getContextCoordinator = (context: AppContext): WorldEngineStepCoordinator => {
  if (context.worldEngineStepCoordinator) {
    return context.worldEngineStepCoordinator;
  }

  throw new ApiError(
    500,
    'WORLD_ENGINE_COORDINATOR_NOT_READY',
    'World engine step coordinator is not configured on AppContext'
  );
};

export const listTaintedWorldEnginePackIds = (): string[] => {
  return defaultCoordinator.listTaintedPackIds();
};

export const clearTaintedWorldEnginePackId = (packId: string): void => {
  defaultCoordinator.clearTaintedPackId(packId);
};

const buildPackEntityStateId = (packId: string, entityId: string, namespace: string): string => {
  return `${packId}:state:${entityId}:${namespace}`;
};

const parseBigIntLike = (value: unknown, field: string): bigint => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(500, 'HOST_PERSIST_FAILED', `Missing ${field} for world engine core delta apply`, {
      field,
      value
    });
  }

  try {
    return BigInt(value);
  } catch {
    throw new ApiError(500, 'HOST_PERSIST_FAILED', `Invalid bigint string for ${field}`, {
      field,
      value
    });
  }
};

const applyPreparedWorldStateDelta = async (input: {
  context: AppContext;
  prepared: PreparedWorldStep;
}): Promise<PackRuntimeCoreDeltaPersistenceResult> => {
  const appliedOperations: WorldStateDeltaOperation['op'][] = [];
  const persistedEntityStates: PackRuntimeEntityStateRecord[] = [];
  const persistedRuleExecutionRecords: PackRuntimeRuleExecutionRecord[] = [];
  let clockDelta: PackRuntimeCoreDeltaPersistenceResult['clock_delta'] = null;
  let mutatedNamespaceRefs: string[] = [];

  for (const operation of input.prepared.state_delta.operations) {
    switch (operation.op) {
      case 'upsert_entity_state': {
        const entityId = operation.target_ref?.trim() ?? '';
        const namespace = operation.namespace?.trim() ?? '';
        const nextState = operation.payload.next;
        if (entityId.length === 0 || namespace.length === 0 || !nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
          throw new ApiError(500, 'HOST_PERSIST_FAILED', 'Invalid upsert_entity_state payload for Host delta apply', {
            operation
          });
        }

        const existingStates = await listPackEntityStates(input.prepared.pack_id);
        const existing = existingStates.find(item => item.entity_id === entityId && item.state_namespace === namespace) ?? null;
        const persisted = await upsertPackEntityState({
          id: existing?.id ?? buildPackEntityStateId(input.prepared.pack_id, entityId, namespace),
          pack_id: input.prepared.pack_id,
          entity_id: entityId,
          state_namespace: namespace,
          state_json: nextState as Record<string, unknown>,
          now: parseBigIntLike(input.prepared.next_revision, 'prepared.next_revision')
        });
        persistedEntityStates.push(persisted);
        appliedOperations.push(operation.op);
        mutatedNamespaceRefs = Array.from(new Set([...mutatedNamespaceRefs, `${entityId}/${namespace}`]));
        break;
      }
      case 'append_rule_execution': {
        const nextRecord = operation.payload.next;
        if (!nextRecord || typeof nextRecord !== 'object' || Array.isArray(nextRecord)) {
          throw new ApiError(500, 'HOST_PERSIST_FAILED', 'Invalid append_rule_execution payload for Host delta apply', {
            operation
          });
        }

        const recordObject = nextRecord as Record<string, unknown>;
        const recordId = typeof recordObject.id === 'string' ? recordObject.id.trim() : '';
        const payloadJson = recordObject.payload_json;
        if (recordId.length === 0) {
          throw new ApiError(500, 'HOST_PERSIST_FAILED', 'append_rule_execution requires payload.next.id', {
            operation
          });
        }

        const persisted = await recordPackRuleExecution({
          id: recordId,
          pack_id: input.prepared.pack_id,
          rule_id: 'world_step.advance_clock',
          capability_key: null,
          mediator_id: null,
          subject_entity_id: '__world__',
          target_entity_id: '__world__',
          execution_status: 'applied',
          payload_json: payloadJson && typeof payloadJson === 'object' && !Array.isArray(payloadJson)
            ? (payloadJson as Record<string, unknown>)
            : null,
          emitted_events_json: input.prepared.emitted_events,
          now: parseBigIntLike(input.prepared.next_revision, 'prepared.next_revision')
        });
        persistedRuleExecutionRecords.push(persisted);
        appliedOperations.push(operation.op);
        mutatedNamespaceRefs = Array.from(new Set([...mutatedNamespaceRefs, 'rule_execution_records']));
        break;
      }
      case 'set_clock': {
        const nextClock = operation.payload.next;
        if (!nextClock || typeof nextClock !== 'object' || Array.isArray(nextClock)) {
          throw new ApiError(500, 'HOST_PERSIST_FAILED', 'Invalid set_clock payload for Host delta apply', {
            operation
          });
        }

        const clockObject = nextClock as Record<string, unknown>;
        clockDelta = {
          previous_tick: typeof clockObject.previous_tick === 'string' ? clockObject.previous_tick : null,
          next_tick: typeof clockObject.next_tick === 'string' ? clockObject.next_tick : null,
          previous_revision: typeof clockObject.previous_revision === 'string' ? clockObject.previous_revision : null,
          next_revision: typeof clockObject.next_revision === 'string' ? clockObject.next_revision : null
        };
        appliedOperations.push(operation.op);
        break;
      }
      default:
        break;
    }
  }

  return {
    persisted_revision: input.prepared.next_revision,
    applied_operations: appliedOperations,
    persisted_entity_states: persistedEntityStates,
    persisted_rule_execution_records: persistedRuleExecutionRecords,
    clock_delta: clockDelta,
    observability: [{
      code: 'WORLD_CORE_DELTA_APPLIED',
      attributes: {
        pack_id: input.prepared.pack_id,
        prepared_token: input.prepared.prepared_token,
        applied_operations: appliedOperations,
        persisted_entity_state_count: persistedEntityStates.length,
        persisted_rule_execution_record_count: persistedRuleExecutionRecords.length,
        mutated_namespace_refs: mutatedNamespaceRefs,
        persisted_revision: input.prepared.next_revision
      }
    }]
  };
};

export const createDefaultWorldEnginePersistencePort = (): WorldEnginePersistencePort => {
  return {
    async persistPreparedStep({ context, prepared }) {
      try {
        return await applyPreparedWorldStateDelta({
          context,
          prepared
        });
      } catch (error) {
        const errorWithDetails = error instanceof ApiError
          ? error
          : new ApiError(
              500,
              'HOST_PERSIST_FAILED',
              error instanceof Error ? error.message : String(error),
              {
                cause: error instanceof Error ? error.message : String(error)
              }
            );

        errorWithDetails.details = {
          ...(errorWithDetails.details && typeof errorWithDetails.details === 'object' ? errorWithDetails.details : {}),
          observability: [{
            code: 'WORLD_CORE_DELTA_ABORTED',
            attributes: {
              pack_id: prepared.pack_id,
              prepared_token: prepared.prepared_token,
              failed_operation_count: prepared.state_delta.operations.length,
              reason: errorWithDetails.message
            }
          }]
        };

        throw errorWithDetails;
      }
    }
  };
};

const applyCommittedClockProjection = (input: {
  context: AppContext;
  packId: string;
  committed: WorldEngineCommitResult;
  persisted: PackRuntimeCoreDeltaPersistenceResult;
}): RuntimeClockProjectionSnapshot | null => {
  const projectionPort = input.context.runtimeClockProjection;
  if (!projectionPort) {
    return null;
  }

  const projectionInput: WorldEngineCommitProjectionInput = {
    pack_id: input.packId,
    committed_tick: input.committed.committed_tick,
    committed_revision: input.committed.committed_revision,
    clock_delta: input.persisted.clock_delta,
    source: 'world_engine_commit'
  };

  const snapshot = projectionPort.applyWorldEngineCommitProjection(projectionInput);
  input.context.sim.applyClockProjection(snapshot);
  return snapshot;
};

export const executeWorldEnginePreparedStep = async (input: {
  context: AppContext;
  worldEngine: WorldEnginePort;
  persistence: WorldEnginePersistencePort;
  prepareInput: WorldStepPrepareRequest;
  coordinator?: WorldEngineStepCoordinator;
}): Promise<WorldEngineCommitResult> => {
  const coordinator = input.coordinator ?? getContextCoordinator(input.context);
  const packId = input.prepareInput.pack_id.trim();
  coordinator.assertNotTainted(packId);
  coordinator.assertSingleFlightAvailable(packId);

  let prepared: PreparedWorldStep | null = null;

  try {
    prepared = await input.worldEngine.prepareStep(input.prepareInput);
    coordinator.setSingleFlightState({
      pack_id: packId,
      prepared_token: prepared.prepared_token,
      status: 'persisting',
      updated_at: Date.now()
    });

    // Evaluate state_transforms: compute range-based derived state keys
    // for all actors and append the resulting delta operations before persist.
    const logger = createLogger('state_transform_evaluator');
    const [worldEntities, entityStates] = await Promise.all([
      listPackWorldEntities(packId),
      listPackEntityStates(packId)
    ]);

    const actorEntityIds = new Set(
      worldEntities
        .filter(e => {
          const kind = typeof e.entity_kind === 'string' ? e.entity_kind : '';
          return kind === 'actor' || kind.startsWith('actor:');
        })
        .map(e => e.id)
    );

    const actorStates = entityStates
      .filter(
        s =>
          s.state_namespace === 'core' &&
          actorEntityIds.has(s.entity_id) &&
          typeof s.state_json === 'object' &&
          s.state_json !== null &&
          !Array.isArray(s.state_json)
      )
      .map(s => ({
        entity_id: s.entity_id,
        state_json: s.state_json as Record<string, unknown>
      }));

    const transformDefs = worldEntities
      .filter(e => e.entity_kind === 'state_transform')
      .map(e => {
        const payload = (e.payload_json ?? {}) as Record<string, unknown>;
        return {
          source: typeof payload.source === 'string' ? payload.source : '',
          ranges: (Array.isArray(payload.ranges) ? payload.ranges : []) as Array<{
            min: number;
            max: number;
            label: string;
          }>,
          target: typeof payload.target === 'string' ? payload.target : ''
        };
      })
      .filter(t => t.source.length > 0 && t.target.length > 0 && t.ranges.length > 0);

    if (transformDefs.length > 0 && actorStates.length > 0) {
      const transformOps = evaluateStateTransforms({
        packId,
        actorStates,
        transformDefs,
        logDebug: (message, meta) => logger.debug(message, meta),
        logWarn: (message, meta) => logger.warn(message, meta)
      });

      if (transformOps.length > 0) {
        prepared.state_delta.operations.push(...transformOps);
      }
    }

    const persisted = await input.persistence.persistPreparedStep({
      context: input.context,
      prepared,
      correlationId: input.prepareInput.correlation_id
    });

    coordinator.setSingleFlightState({
      pack_id: packId,
      prepared_token: prepared.prepared_token,
      status: 'committing',
      updated_at: Date.now()
    });

    const commitInput: WorldStepCommitRequest = {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: packId,
      prepared_token: prepared.prepared_token,
      persisted_revision: persisted.persisted_revision,
      correlation_id: input.prepareInput.correlation_id,
      idempotency_key: input.prepareInput.idempotency_key
    };

    const committed = await input.worldEngine.commitPreparedStep(commitInput);
    applyCommittedClockProjection({ context: input.context, packId, committed, persisted });
    coordinator.clearSingleFlightState(packId);
    coordinator.clearTaintedPackId(packId);
    return committed;
  } catch (error) {
    if (prepared) {
      try {
        const abortInput: WorldStepAbortRequest = {
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: packId,
          prepared_token: prepared.prepared_token,
          correlation_id: input.prepareInput.correlation_id,
          idempotency_key: input.prepareInput.idempotency_key,
          reason: error instanceof Error ? error.message : String(error)
        };
        await input.worldEngine.abortPreparedStep(abortInput);
        coordinator.clearSingleFlightState(packId);
      } catch (abortError) {
        coordinator.markTainted(packId, abortError instanceof Error ? abortError.message : String(abortError));
      }
    } else {
      coordinator.clearSingleFlightState(packId);
    }

    throw error;
  }
};
