import { ChronosEngine } from '../../clock/engine.js';
import type { CalendarConfig, TimeFormatted } from '../../clock/types.js';
import { toJsonSafe } from '../http/json.js';

export interface JsonSafeTimeFormatted {
  calendar_id: string;
  calendar_name: string;
  display: string;
  units: Record<string, string | number>;
}

export interface RuntimeClockProjectionSnapshot {
  pack_id: string;
  current_tick: string;
  current_revision: string;
  calendars: TimeFormatted[];
  source: 'host_projection';
  updated_at_ms: number;
  generation: number;
}

export interface WorldEngineCommitProjectionInput {
  pack_id: string;
  committed_tick: string | null;
  committed_revision: string | null;
  clock_delta?: {
    previous_tick: string | null;
    next_tick: string | null;
    previous_revision: string | null;
    next_revision: string | null;
  } | null;
  correlation_id?: string;
  idempotency_key?: string;
  source: 'world_engine_commit';
}

export interface RuntimeClockProjectionPort {
  getSnapshot(pack_id: string): RuntimeClockProjectionSnapshot | null;
  applyWorldEngineCommitProjection(input: WorldEngineCommitProjectionInput): RuntimeClockProjectionSnapshot;
  rebuildFromRuntimeSeed(input: {
    pack_id: string;
    current_tick: string;
    current_revision?: string | null;
    calendars: CalendarConfig[];
  }): RuntimeClockProjectionSnapshot;
}

export interface ActivePackRuntimeProjectionPort {
  getCurrentRevision(): bigint;
  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void;
}

export interface HostRuntimeClockQueryPort {
  readFormattedClock(pack_id: string): {
    absolute_ticks: string;
    calendars: JsonSafeTimeFormatted[];
  } | null;
}

const toJsonSafeFormattedCalendars = (calendars: TimeFormatted[]): JsonSafeTimeFormatted[] => {
  return toJsonSafe(calendars) as JsonSafeTimeFormatted[];
};

const parseBigIntString = (value: string, field: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`[runtime_clock_projection] invalid bigint string for ${field}: ${value}`);
  }
};

const resolveProjectedTick = (input: WorldEngineCommitProjectionInput): string => {
  const fromClockDelta = input.clock_delta?.next_tick?.trim();
  if (fromClockDelta) {
    return fromClockDelta;
  }

  const fromCommittedTick = input.committed_tick?.trim();
  if (fromCommittedTick) {
    return fromCommittedTick;
  }

  throw new Error('[runtime_clock_projection] missing projected tick from world engine commit result');
};

const resolveProjectedRevision = (input: WorldEngineCommitProjectionInput): string => {
  const fromClockDelta = input.clock_delta?.next_revision?.trim();
  if (fromClockDelta) {
    return fromClockDelta;
  }

  const fromCommittedRevision = input.committed_revision?.trim();
  if (fromCommittedRevision) {
    return fromCommittedRevision;
  }

  const projectedTick = input.clock_delta?.next_tick?.trim() ?? input.committed_tick?.trim();
  if (projectedTick) {
    return projectedTick;
  }

  throw new Error('[runtime_clock_projection] missing projected revision from world engine commit result');
};

export interface RuntimeClockProjectionService
  extends RuntimeClockProjectionPort,
    HostRuntimeClockQueryPort {}

export class InMemoryRuntimeClockProjectionService
  implements RuntimeClockProjectionService
{
  private readonly calendarsByPack = new Map<string, CalendarConfig[]>();
  private readonly snapshots = new Map<string, RuntimeClockProjectionSnapshot>();

  public getSnapshot(pack_id: string): RuntimeClockProjectionSnapshot | null {
    return this.snapshots.get(pack_id) ?? null;
  }

  public rebuildFromRuntimeSeed(input: {
    pack_id: string;
    current_tick: string;
    current_revision?: string | null;
    calendars: CalendarConfig[];
  }): RuntimeClockProjectionSnapshot {
    this.calendarsByPack.set(input.pack_id, input.calendars);
    const generation = (this.snapshots.get(input.pack_id)?.generation ?? 0) + 1;
    const currentTick = parseBigIntString(input.current_tick, 'current_tick');
    const currentRevision = input.current_revision?.trim() || input.current_tick;
    const engine = new ChronosEngine(input.calendars, currentTick);
    const snapshot: RuntimeClockProjectionSnapshot = {
      pack_id: input.pack_id,
      current_tick: input.current_tick,
      current_revision: currentRevision,
      calendars: engine.getAllTimes(),
      source: 'host_projection',
      updated_at_ms: Date.now(),
      generation
    };
    this.snapshots.set(input.pack_id, snapshot);
    return snapshot;
  }

  public applyWorldEngineCommitProjection(
    input: WorldEngineCommitProjectionInput
  ): RuntimeClockProjectionSnapshot {
    const calendars = this.calendarsByPack.get(input.pack_id);
    if (!calendars) {
      throw new Error(`[runtime_clock_projection] no calendar seed registered for pack ${input.pack_id}`);
    }

    const generation = (this.snapshots.get(input.pack_id)?.generation ?? 0) + 1;
    const currentTick = resolveProjectedTick(input);
    const currentRevision = resolveProjectedRevision(input);
    const engine = new ChronosEngine(calendars, parseBigIntString(currentTick, 'projected_tick'));
    const snapshot: RuntimeClockProjectionSnapshot = {
      pack_id: input.pack_id,
      current_tick: currentTick,
      current_revision: currentRevision,
      calendars: engine.getAllTimes(),
      source: 'host_projection',
      updated_at_ms: Date.now(),
      generation
    };
    this.snapshots.set(input.pack_id, snapshot);
    return snapshot;
  }

  public readFormattedClock(pack_id: string): {
    absolute_ticks: string;
    calendars: JsonSafeTimeFormatted[];
  } | null {
    const snapshot = this.getSnapshot(pack_id);
    if (!snapshot) {
      return null;
    }

    return {
      absolute_ticks: snapshot.current_tick,
      calendars: toJsonSafeFormattedCalendars(snapshot.calendars)
    };
  }
}

export const createRuntimeClockProjectionService = (): RuntimeClockProjectionService => {
  return new InMemoryRuntimeClockProjectionService();
};
