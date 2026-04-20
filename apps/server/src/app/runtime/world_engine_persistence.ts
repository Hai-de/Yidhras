import type {
  PreparedWorldStep,
  WorldEngineCommitResult,
  WorldStepAbortRequest,
  WorldStepCommitRequest,
  WorldStepPrepareRequest
} from '@yidhras/contracts';
import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';

import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import type { WorldEnginePort } from './world_engine_ports.js';

export interface WorldEnginePersistencePort {
  persistPreparedStep(input: {
    context: AppContext;
    prepared: PreparedWorldStep;
    correlationId?: string;
  }): Promise<{
    persisted_revision: string;
  }>;
}

export interface WorldEngineSingleFlightState {
  pack_id: string;
  prepared_token: string;
  status: 'preparing' | 'persisting' | 'committing' | 'tainted';
  updated_at: number;
  reason?: string;
}

const singleFlightStates = new Map<string, WorldEngineSingleFlightState>();
const taintedPackIds = new Set<string>();

export const listTaintedWorldEnginePackIds = (): string[] => {
  return Array.from(taintedPackIds.values());
};

export const clearTaintedWorldEnginePackId = (packId: string): void => {
  taintedPackIds.delete(packId.trim());
};

const setSingleFlightState = (state: WorldEngineSingleFlightState): void => {
  singleFlightStates.set(state.pack_id, state);
};

const clearSingleFlightState = (packId: string): void => {
  singleFlightStates.delete(packId);
};

const markTainted = (packId: string, reason: string): void => {
  taintedPackIds.add(packId);
  setSingleFlightState({
    pack_id: packId,
    prepared_token: singleFlightStates.get(packId)?.prepared_token ?? 'unknown',
    status: 'tainted',
    updated_at: Date.now(),
    reason
  });
};

const assertNotTainted = (packId: string): void => {
  if (!taintedPackIds.has(packId)) {
    return;
  }

  throw new ApiError(409, 'TAINTED_SESSION', 'World engine pack session is tainted and must be reloaded before continuing', {
    pack_id: packId
  });
};

const assertSingleFlightAvailable = (packId: string): void => {
  const existing = singleFlightStates.get(packId);
  if (!existing) {
    return;
  }

  throw new ApiError(409, 'PREPARED_STEP_CONFLICT', 'A world engine prepared step is already in flight for this pack', {
    pack_id: packId,
    prepared_token: existing.prepared_token,
    status: existing.status,
    reason: existing.reason ?? null
  });
};

export const createDefaultWorldEnginePersistencePort = (): WorldEnginePersistencePort => {
  return {
    async persistPreparedStep({ prepared }) {
      return {
        persisted_revision: prepared.next_revision
      };
    }
  };
};

export const executeWorldEnginePreparedStep = async (input: {
  context: AppContext;
  worldEngine: WorldEnginePort;
  persistence: WorldEnginePersistencePort;
  prepareInput: WorldStepPrepareRequest;
}): Promise<WorldEngineCommitResult> => {
  const packId = input.prepareInput.pack_id.trim();
  assertNotTainted(packId);
  assertSingleFlightAvailable(packId);

  let prepared: PreparedWorldStep | null = null;

  try {
    prepared = await input.worldEngine.prepareStep(input.prepareInput);
    setSingleFlightState({
      pack_id: packId,
      prepared_token: prepared.prepared_token,
      status: 'persisting',
      updated_at: Date.now()
    });

    const persisted = await input.persistence.persistPreparedStep({
      context: input.context,
      prepared,
      correlationId: input.prepareInput.correlation_id
    });

    setSingleFlightState({
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
    clearSingleFlightState(packId);
    clearTaintedWorldEnginePackId(packId);
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
        clearSingleFlightState(packId);
      } catch (abortError) {
        markTainted(packId, abortError instanceof Error ? abortError.message : String(abortError));
      }
    } else {
      clearSingleFlightState(packId);
    }

    throw error;
  }
};
