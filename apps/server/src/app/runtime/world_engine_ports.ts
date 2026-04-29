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

/**
 * Host-facing control / compute contract for the world-engine kernel.
 *
 * This interface is intentionally owned by the TS host runtime kernel and is
 * used by orchestration paths such as bootstrap, runtime loop, persistence
 * coordination and objective execution bridging. It is not a plugin-facing or
 * route-facing contract.
 */
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
  executeObjectiveRule(input: WorldRuleExecuteObjectiveRequest): Promise<WorldRuleExecuteObjectiveResult>;
}

/**
 * Long-term host-mediated read contract for pack runtime data.
 *
 * PackHostApi is the read-plane companion to WorldEnginePort:
 * - WorldEnginePort = control / compute plane for host orchestration
 * - PackHostApi = host-owned read plane for plugins, workflow host, routes and
 *   other upper-layer consumers
 *
 * Returned values represent host-accepted / host-projected truth rather than
 * raw sidecar-internal state. Consumers should extend this contract instead of
 * depending on raw sidecar transport details.
 */
export interface PackHostApi {
  getPackSummary(input: { pack_id: string }): Promise<PackRuntimeSummary | null>;
  getCurrentTick(input: { pack_id: string }): Promise<string | null>;
  queryWorldState(input: WorldStateQuery): Promise<WorldStateQueryResult>;
}

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, 'PACK_SCOPE_DENIED', 'pack_id is required');
  }
  return normalized;
};

const getActiveRuntimeFacade = (context: AppContext, feature: string) => {
  if (context.activePackRuntime) {
    return context.activePackRuntime;
  }

  throw new ApiError(
    503,
    'ACTIVE_PACK_RUNTIME_NOT_READY',
    'activePackRuntime is required for world engine host operations',
    {
      feature,
      fallback_blocked: true
    }
  );
};

const getActivePackId = (context: AppContext): string | null => {
  return getActiveRuntimeFacade(context, 'world_engine_ports.getActivePackId').getActivePack()?.metadata.id ?? null;
};

const getProjectedCurrentTick = (context: AppContext, packId: string): string | null => {
  const projected = context.runtimeClockProjection?.getSnapshot(packId);
  if (!projected) {
    return null;
  }

  return projected.current_tick;
};

const getActiveCurrentTick = (context: AppContext): string | null => {
  const activePackId = getActivePackId(context);
  if (!activePackId) {
    return null;
  }

  return getActiveRuntimeFacade(context, 'world_engine_ports.getActiveCurrentTick').getCurrentTick().toString();
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
    const projectedTick = getProjectedCurrentTick(context, normalizedPackId);
    return {
      pack_id: normalizedPackId,
      pack_folder_name: null,
      health_status: context.getPaused() ? 'paused' : 'running',
      current_tick: projectedTick ?? getActiveCurrentTick(context),
      runtime_ready: context.getRuntimeReady()
    };
  }

  return getExperimentalRuntimeSummary(context, normalizedPackId);
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
        (await listPackWorldEntities(context.packStorageAdapter, packId)).filter(item => {
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

      const items = await listPackEntityStates(context.packStorageAdapter, packId);
      const matched = items.find(item => item.entity_id === entityId && item.state_namespace === stateNamespace) ?? null;
      return {
        entity_id: entityId,
        state_namespace: stateNamespace,
        state: matched?.state_json ?? null
      };
    }
    case 'authority_grants': {
      const items = applyQueryLimit(
        (await listPackAuthorityGrants(context.packStorageAdapter, packId)).filter(item => {
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
        (await listPackMediatorBindings(context.packStorageAdapter, packId)).filter(item => {
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
        (await listPackRuleExecutionRecords(context.packStorageAdapter, packId)).filter(item => {
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

export const createPackHostApi = (context: AppContext): PackHostApi => {
  return {
    getPackSummary(input) {
      return Promise.resolve(getPackSummary(context, input.pack_id));
    },

    getCurrentTick(input) {
      return Promise.resolve(getPackSummary(context, input.pack_id)?.current_tick ?? null);
    },

    async queryWorldState(input) {
      const packId = normalizePackId(input.pack_id);
      const data = await resolveQueryStateData(context, packId, input);
      const summary = getPackSummary(context, packId);

      return {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: packId,
        query_name: input.query_name,
        current_tick: summary?.current_tick ?? null,
        current_revision: context.activePackRuntime?.getCurrentRevision().toString() ?? null,
        data,
        next_cursor: null,
        warnings: []
      };
    }
  };
};
