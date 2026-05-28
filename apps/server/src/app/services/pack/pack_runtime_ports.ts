import type { RuntimeSpeedSnapshot } from '../../../core/runtime_speed.js';
import type { StepContext, StepStrategy } from '../../../core/step_strategy.js';
import type { WorldPack } from '../../../packs/manifest/loader.js';
import type { RuntimeClockProjectionSnapshot } from '../../runtime/runtime_clock_projection.js';

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
  getStepStrategy(): StepStrategy;
  setStepStrategy(strategy: StepStrategy): void;
  getEffectiveStepTicks(ctx: StepContext, requestedStep?: bigint): bigint;
  getLoopIntervalMs(): number;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  clearRuntimeSpeedOverride(): void;
  getAllTimes(): unknown;
  step(amount?: bigint): void;
  getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null;
  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void;
  setRequestedStepTicks(ticks: bigint): void;
  consumeRequestedStepTicks(): bigint | undefined;
}

export interface AggregatedClockSnapshot {
  packs: Record<string, { tick: bigint; revision: bigint }>;
  primaryPackId: string;
}

export interface MultiPackRuntimePort {
  listPacks(): string[];
  getPackTick(packId: string): bigint;
  getGlobalClock(): AggregatedClockSnapshot;
  getPackRuntime(packId: string): PackRuntimePort;
  assertRuntimeReady(packId: string, feature: string): void;
}
