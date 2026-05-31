import { ApiError } from '../../utils/api_error.js';

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

export const defaultCoordinator = new WorldEngineStepCoordinator();

export const createWorldEngineStepCoordinator = (): WorldEngineStepCoordinator => {
  return new WorldEngineStepCoordinator();
};
