import {
  type PreparedWorldStep,
  WORLD_ENGINE_PROTOCOL_VERSION,
  type WorldEngineCommitResult,
  type WorldEngineHealthSnapshot,
  type WorldEngineLoadResult,
  type WorldEnginePackMode,
  type WorldEnginePackStatus,
  type WorldRuleExecuteObjectiveRequest,
  type WorldRuleExecuteObjectiveResult,
  type WorldStateQuery,
  type WorldStateQueryResult,
  type WorldStepAbortRequest,
  type WorldStepCommitRequest,
  type WorldStepPrepareRequest
} from '@yidhras/contracts';

import type { PackRuntimeSummary } from '../../core/pack_runtime_ports.js';
import { listPackAuthorityGrants } from '../../packs/storage/authority_repo.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import { listPackEntityStates } from '../../packs/storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../../packs/storage/mediator_repo.js';
import { listPackRuleExecutionRecords } from '../../packs/storage/rule_execution_repo.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface WorldEnginePort {
  loadPack(input: {
    pack_id: string;
    pack_ref?: string;
    mode?: WorldEnginePackMode;
    hydrate?: import('@yidhras/contracts').WorldPackHydrateRequest;
    correlation_id?: string;
    idempotency_key?: string;
  }): Promise<WorldEngineLoadResult>;
  unloadPack(input: {
    pack_id: string;
    correlation_id?: string;
    idempotency_key?: string;
  }): Promise<void>;
  prepareStep(input: WorldStepPrepareRequest): Promise<PreparedWorldStep>;
  commitPreparedStep(input: WorldStepCommitRequest): Promise<WorldEngineCommitResult>;
  abortPreparedStep(input: WorldStepAbortRequest): Promise<void>;
  queryState(input: WorldStateQuery): Promise<WorldStateQueryResult>;
  getStatus(input: { pack_id: string; correlation_id?: string }): Promise<WorldEnginePackStatus>;
  getHealth(): Promise<WorldEngineHealthSnapshot>;
  executeObjectiveRule?(input: WorldRuleExecuteObjectiveRequest): Promise<WorldRuleExecuteObjectiveResult>;
}

export interface PackHostApi {
  getPackSummary(input: { pack_id: string }): Promise<PackRuntimeSummary | null>;
  getCurrentTick(input: { pack_id: string }): Promise<string | null>;
  queryWorldState(input: WorldStateQuery): Promise<WorldStateQueryResult>;
}

interface PendingPreparedStep {
  token: string;
  packId: string;
  stepTicks: bigint;
  baseRevision: string;
  nextRevision: string;
  nextTick: string;
  summary: PreparedWorldStep['summary'];
}

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, 'PACK_SCOPE_DENIED', 'pack_id is required');
  }
  return normalized;
};

const getActiveRuntimeFacade = (context: AppContext) => context.activePackRuntime ?? context.sim;

const getActivePackId = (context: AppContext): string | null => {
  return getActiveRuntimeFacade(context).getActivePack()?.metadata.id ?? null;
};

const getActiveCurrentTick = (context: AppContext): string | null => {
  const activePackId = getActivePackId(context);
  if (!activePackId) {
    return null;
  }

  return getActiveRuntimeFacade(context).getCurrentTick().toString();
};

const getExperimentalRuntimeSummary = (context: AppContext, packId: string): PackRuntimeSummary | null => {
  const handle = context.sim.getPackRuntimeHandle(packId);
  if (!handle) {
    return null;
  }

  return {
    pack_id: handle.pack_id,
    pack_folder_name: handle.pack_folder_name,
    health_status: handle.getHealthSnapshot().status,
    current_tick: handle.getClockSnapshot().current_tick,
    runtime_ready: false
  };
};

const getPackSummary = (context: AppContext, packId: string): PackRuntimeSummary | null => {
  const normalizedPackId = normalizePackId(packId);
  const activePackId = getActivePackId(context);
  if (activePackId === normalizedPackId) {
    return {
      pack_id: normalizedPackId,
      pack_folder_name: null,
      health_status: context.getPaused() ? 'paused' : 'running',
      current_tick: getActiveCurrentTick(context),
      runtime_ready: context.getRuntimeReady()
    };
  }

  return getExperimentalRuntimeSummary(context, normalizedPackId);
};

const assertPackAvailable = (context: AppContext, packId: string): { packId: string; mode: WorldEnginePackMode } => {
  const normalizedPackId = normalizePackId(packId);
  const activePackId = getActivePackId(context);
  if (activePackId === normalizedPackId) {
    return { packId: normalizedPackId, mode: 'active' };
  }

  if (context.sim.getPackRuntimeHandle(normalizedPackId)) {
    return { packId: normalizedPackId, mode: 'experimental' };
  }

  throw new ApiError(404, 'PACK_NOT_LOADED', 'World engine pack session is not loaded', {
    pack_id: normalizedPackId
  });
};

const applyQueryLimit = <T>(items: T[], limit?: number): T[] => {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return items;
  }
  return items.slice(0, limit);
};

const getSelectorIds = (query: WorldStateQuery): string[] | null => {
  if (!Array.isArray(query.selector.ids) || query.selector.ids.length === 0) {
    return null;
  }
  return query.selector.ids.map(item => item.trim()).filter(item => item.length > 0);
};

const resolveQueryStateData = async (context: AppContext, packId: string, query: WorldStateQuery) => {
  switch (query.query_name) {
    case 'pack_summary':
      return {
        summary: getPackSummary(context, packId)
      };
    case 'world_entities': {
      const selectorIds = getSelectorIds(query);
      const items = applyQueryLimit(
        (await listPackWorldEntities(packId)).filter(item => {
          if (selectorIds && !selectorIds.includes(item.id)) {
            return false;
          }
          if (typeof query.selector.entity_kind === 'string' && query.selector.entity_kind.trim().length > 0) {
            if (item.entity_kind !== query.selector.entity_kind.trim()) {
              return false;
            }
          }
          if (typeof query.selector.entity_type === 'string' && query.selector.entity_type.trim().length > 0) {
            if (item.entity_type !== query.selector.entity_type.trim()) {
              return false;
            }
          }
          return true;
        }),
        query.limit
      );
      return {
        items,
        total_count: items.length
      };
    }
    case 'entity_state': {
      const entityId = typeof query.selector.entity_id === 'string' ? query.selector.entity_id.trim() : '';
      const stateNamespace = typeof query.selector.state_namespace === 'string' ? query.selector.state_namespace.trim() : '';
      if (entityId.length === 0 || stateNamespace.length === 0) {
        throw new ApiError(400, 'INVALID_QUERY', 'entity_state query requires selector.entity_id and selector.state_namespace', {
          pack_id: packId,
          selector: query.selector
        });
      }

      const items = await listPackEntityStates(packId);
      const matched = items.find(item => item.entity_id === entityId && item.state_namespace === stateNamespace) ?? null;
      return {
        entity_id: entityId,
        state_namespace: stateNamespace,
        state: matched?.state_json ?? null
      };
    }
    case 'authority_grants': {
      const items = applyQueryLimit(
        (await listPackAuthorityGrants(packId)).filter(item => {
          if (typeof query.selector.source_entity_id === 'string' && query.selector.source_entity_id.trim().length > 0) {
            if (item.source_entity_id !== query.selector.source_entity_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.capability_key === 'string' && query.selector.capability_key.trim().length > 0) {
            if (item.capability_key !== query.selector.capability_key.trim()) {
              return false;
            }
          }
          if (typeof query.selector.mediated_by_entity_id === 'string' && query.selector.mediated_by_entity_id.trim().length > 0) {
            if (item.mediated_by_entity_id !== query.selector.mediated_by_entity_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.status === 'string' && query.selector.status.trim().length > 0) {
            if (item.status !== query.selector.status.trim()) {
              return false;
            }
          }
          return true;
        }),
        query.limit
      );
      return {
        items,
        total_count: items.length
      };
    }
    case 'mediator_bindings': {
      const items = applyQueryLimit(
        (await listPackMediatorBindings(packId)).filter(item => {
          if (typeof query.selector.mediator_id === 'string' && query.selector.mediator_id.trim().length > 0) {
            if (item.mediator_id !== query.selector.mediator_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.subject_entity_id === 'string' && query.selector.subject_entity_id.trim().length > 0) {
            if (item.subject_entity_id !== query.selector.subject_entity_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.binding_kind === 'string' && query.selector.binding_kind.trim().length > 0) {
            if (item.binding_kind !== query.selector.binding_kind.trim()) {
              return false;
            }
          }
          if (typeof query.selector.status === 'string' && query.selector.status.trim().length > 0) {
            if (item.status !== query.selector.status.trim()) {
              return false;
            }
          }
          return true;
        }),
        query.limit
      );
      return {
        items,
        total_count: items.length
      };
    }
    case 'rule_execution_summary': {
      const items = applyQueryLimit(
        (await listPackRuleExecutionRecords(packId)).filter(item => {
          if (typeof query.selector.rule_id === 'string' && query.selector.rule_id.trim().length > 0) {
            if (item.rule_id !== query.selector.rule_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.subject_entity_id === 'string' && query.selector.subject_entity_id.trim().length > 0) {
            if (item.subject_entity_id !== query.selector.subject_entity_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.target_entity_id === 'string' && query.selector.target_entity_id.trim().length > 0) {
            if (item.target_entity_id !== query.selector.target_entity_id.trim()) {
              return false;
            }
          }
          if (typeof query.selector.execution_status === 'string' && query.selector.execution_status.trim().length > 0) {
            if (item.execution_status !== query.selector.execution_status.trim()) {
              return false;
            }
          }
          return true;
        }),
        query.limit
      );
      return {
        items,
        total_count: items.length
      };
    }
  }
};

export const createTsWorldEngineAdapter = (context: AppContext): WorldEnginePort => {
  const pendingPreparedSteps = new Map<string, PendingPreparedStep>();

  return {
    async loadPack(input) {
      const packId = normalizePackId(input.pack_id);
      const requestedMode = input.mode ?? 'active';

      if (requestedMode === 'active') {
        const packRef = input.pack_ref?.trim() || packId;
        void input.hydrate;
        await getActiveRuntimeFacade(context).init(packRef);
        const activePackId = getActivePackId(context);
        if (!activePackId || activePackId !== packId) {
          throw new ApiError(409, 'PACK_SCOPE_DENIED', 'Loaded active pack does not match requested pack_id', {
            requested_pack_id: packId,
            active_pack_id: activePackId
          });
        }

        return {
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: activePackId,
          mode: 'active',
          session_status: 'ready',
          hydrated_from_persistence: true,
          current_tick: getActiveCurrentTick(context),
          current_revision: getActiveCurrentTick(context)
        };
      }

      const packRef = input.pack_ref?.trim() || packId;
      const result = await context.sim.loadExperimentalPackRuntime(packRef);
      return {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: result.handle.pack_id,
        mode: 'experimental',
        session_status: 'ready',
        hydrated_from_persistence: result.loaded || result.already_loaded,
        current_tick: result.handle.getClockSnapshot().current_tick,
        current_revision: result.handle.getClockSnapshot().current_tick
      };
    },

    async unloadPack(input) {
      const packId = normalizePackId(input.pack_id);
      if (getActivePackId(context) === packId) {
        throw new ApiError(409, 'PACK_SCOPE_DENIED', 'Active pack session cannot be unloaded from the TS adapter', {
          pack_id: packId
        });
      }

      await context.sim.unloadExperimentalPackRuntime(packId);
    },

    async prepareStep(input) {
      const packId = normalizePackId(input.pack_id);
      const availability = assertPackAvailable(context, packId);
      if (availability.mode !== 'active') {
        throw new ApiError(409, 'PACK_SCOPE_DENIED', 'TS world engine adapter only supports prepareStep on the active pack', {
          pack_id: packId,
          mode: availability.mode
        });
      }

      if (pendingPreparedSteps.has(packId)) {
        throw new ApiError(409, 'PREPARED_STEP_CONFLICT', 'A prepared step is already in flight for this pack', {
          pack_id: packId
        });
      }

      const stepTicks = BigInt(input.step_ticks);
      const currentTick = getActiveRuntimeFacade(context).getCurrentTick();
      const baseRevision = input.base_revision ?? currentTick.toString();
      const nextTick = (currentTick + stepTicks).toString();
      const nextRevision = nextTick;
      const token = `ts-prepared:${packId}:${Date.now()}`;
      const pending: PendingPreparedStep = {
        token,
        packId,
        stepTicks,
        baseRevision,
        nextRevision,
        nextTick,
        summary: {
          applied_rule_count: 0,
          event_count: 0,
          mutated_entity_count: 0
        }
      };
      pendingPreparedSteps.set(packId, pending);

      return {
        prepared_token: token,
        pack_id: packId,
        base_revision: baseRevision,
        next_revision: nextRevision,
        next_tick: nextTick,
        state_delta: {
          operations: [],
          metadata: {
            pack_id: packId,
            adapter: 'ts_compat',
            reason: input.reason,
            base_tick: currentTick.toString(),
            next_tick: nextTick,
            base_revision: baseRevision,
            next_revision: nextRevision,
            mutated_entity_ids: [],
            mutated_namespace_refs: [],
            delta_operation_count: 0
          }
        },
        emitted_events: [],
        observability: [],
        summary: pending.summary
      };
    },

    async commitPreparedStep(input) {
      const pending = Array.from(pendingPreparedSteps.values()).find(candidate => candidate.token === input.prepared_token);
      if (!pending) {
        throw new ApiError(404, 'PREPARED_STEP_NOT_FOUND', 'Prepared step token not found', {
          prepared_token: input.prepared_token
        });
      }

      await getActiveRuntimeFacade(context).step(pending.stepTicks);
      pendingPreparedSteps.delete(pending.packId);
      const committedTick = getActiveRuntimeFacade(context).getCurrentTick().toString();

      return {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: pending.packId,
        prepared_token: pending.token,
        committed_revision: input.persisted_revision,
        committed_tick: committedTick,
        summary: pending.summary
      };
    },

    async abortPreparedStep(input) {
      const pending = Array.from(pendingPreparedSteps.values()).find(candidate => candidate.token === input.prepared_token);
      if (!pending) {
        return;
      }

      pendingPreparedSteps.delete(pending.packId);
    },

    async queryState(input) {
      const packId = normalizePackId(input.pack_id);
      const data = await resolveQueryStateData(context, packId, input);
      const summary = getPackSummary(context, packId);

      return {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: packId,
        query_name: input.query_name,
        current_tick: summary?.current_tick ?? null,
        current_revision: summary?.current_tick ?? null,
        data,
        next_cursor: null,
        warnings: []
      };
    },

    async getStatus(input) {
      const packId = normalizePackId(input.pack_id);
      const summary = getPackSummary(context, packId);
      if (!summary) {
        return {
          protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
          pack_id: packId,
          mode: 'experimental',
          session_status: 'not_loaded',
          runtime_ready: false,
          current_tick: null,
          current_revision: null,
          pending_prepared_token: null,
          message: 'Pack session is not loaded'
        };
      }

      return {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: packId,
        mode: getActivePackId(context) === packId ? 'active' : 'experimental',
        session_status: 'ready',
        runtime_ready: summary.runtime_ready ?? false,
        current_tick: summary.current_tick ?? null,
        current_revision: summary.current_tick ?? null,
        pending_prepared_token: pendingPreparedSteps.get(packId)?.token ?? null,
        message: null
      };
    },

    async getHealth() {
      const activePackId = getActivePackId(context);
      const experimentalPackIds = context.sim.listLoadedPackRuntimeIds();
      const loadedPackIds = activePackId
        ? Array.from(new Set([activePackId, ...experimentalPackIds]))
        : experimentalPackIds;

      return {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        transport: 'stdio_jsonrpc',
        engine_status: context.getRuntimeReady() ? 'ready' : 'degraded',
        engine_instance_id: 'ts-world-engine-adapter',
        uptime_ms: 0,
        loaded_pack_ids: loadedPackIds,
        tainted_pack_ids: [],
        last_error_code: null,
        message: 'TS compatibility adapter'
      };
    }
  };
};

export const createPackHostApi = (context: AppContext): PackHostApi => {
  const worldEngine = context.worldEngine ?? createTsWorldEngineAdapter(context);

  return {
    async getPackSummary(input) {
      return getPackSummary(context, input.pack_id);
    },

    async getCurrentTick(input) {
      return getPackSummary(context, input.pack_id)?.current_tick ?? null;
    },

    async queryWorldState(input) {
      return worldEngine.queryState(input);
    }
  };
};
