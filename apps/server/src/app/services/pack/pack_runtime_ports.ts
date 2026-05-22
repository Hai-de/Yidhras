import type { RuntimeSpeedSnapshot } from '../../../core/runtime_speed.js';
import type { WorldPack } from '../../../packs/manifest/loader.js';
import type { RuntimeClockProjectionSnapshot } from '../../runtime/runtime_clock_projection.js';

/**
 * Per-pack runtime port.
 * Each loaded pack exposes one of these. No global clock assumption.
 */
export interface PackRuntimePort {
  getPackId(): string;
  getCurrentTick(): bigint;
  getCurrentRevision(): bigint;
  getPack(): WorldPack;
  resolvePackVariables(
    template: string,
    permission?: unknown,
    actorState?: Record<string, unknown> | null
  ): string;
  getStepTicks(): bigint;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  setRuntimeSpeedOverride(stepTicks: bigint): void;
  clearRuntimeSpeedOverride(): void;
  getAllTimes(): unknown;
  step(amount?: bigint): Promise<void>;
  getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null;
  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void;
}

export interface AggregatedClockSnapshot {
  packs: Record<string, { tick: bigint; revision: bigint }>;
  primaryPackId: string;
}

/**
 * Multi-pack aggregation port.
 */
export interface MultiPackRuntimePort {
  listPacks(): string[];
  getPackTick(packId: string): bigint;
  getGlobalClock(): AggregatedClockSnapshot;
  getPackRuntime(packId: string): PackRuntimePort;
  assertRuntimeReady(packId: string, feature: string): void;
}
