import {
  serializeWorldPackSnapshotRecord,
  type WorldPackHydrateRequest,
  type WorldPackSnapshot
} from '@yidhras/contracts';

import { listPackAuthorityGrants } from '../../packs/storage/authority_repo.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import { listPackEntityStates } from '../../packs/storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../../packs/storage/mediator_repo.js';
import { listPackRuleExecutionRecords } from '../../packs/storage/rule_execution_repo.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, 'PACK_SCOPE_DENIED', 'pack_id is required');
  }
  return normalized;
};

const getActiveRuntimeFacade = (context: AppContext) => context.activePackRuntime ?? context.sim;

const resolveSnapshotClock = (context: AppContext, packId: string): { current_tick: string; current_revision: string } => {
  const activePackId = getActiveRuntimeFacade(context).getActivePack()?.metadata.id ?? null;
  if (activePackId === packId) {
    const currentTick = getActiveRuntimeFacade(context).getCurrentTick().toString();
    return {
      current_tick: currentTick,
      current_revision: currentTick
    };
  }

  const experimentalHandle = context.sim.getPackRuntimeHandle(packId);
  if (experimentalHandle) {
    const currentTick = experimentalHandle.getClockSnapshot().current_tick;
    return {
      current_tick: currentTick,
      current_revision: currentTick
    };
  }

  throw new ApiError(404, 'PACK_NOT_LOADED', 'World engine pack session is not loaded for snapshot hydration', {
    pack_id: packId
  });
};

export const buildWorldPackSnapshot = async (context: AppContext, packId: string): Promise<WorldPackSnapshot> => {
  const normalizedPackId = normalizePackId(packId);
  const [worldEntities, entityStates, authorityGrants, mediatorBindings, ruleExecutionRecords] = await Promise.all([
    listPackWorldEntities(context.packStorageAdapter, normalizedPackId),
    listPackEntityStates(context.packStorageAdapter, normalizedPackId),
    listPackAuthorityGrants(context.packStorageAdapter, normalizedPackId),
    listPackMediatorBindings(context.packStorageAdapter, normalizedPackId),
    listPackRuleExecutionRecords(context.packStorageAdapter, normalizedPackId)
  ]);

  return serializeWorldPackSnapshotRecord({
    pack_id: normalizedPackId,
    clock: resolveSnapshotClock(context, normalizedPackId),
    world_entities: worldEntities,
    entity_states: entityStates,
    authority_grants: authorityGrants,
    mediator_bindings: mediatorBindings,
    rule_execution_records: ruleExecutionRecords
  });
};

export const buildWorldPackHydrateRequest = async (
  context: AppContext,
  packId: string
): Promise<WorldPackHydrateRequest> => {
  return {
    source: 'host_snapshot',
    snapshot: await buildWorldPackSnapshot(context, packId)
  };
};
