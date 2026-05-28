import type { RuntimeClockProjectionSnapshot } from '../app/runtime/runtime_clock_projection.js';
import type { ChronosEngine } from '../clock/engine.js';
import type { WorldPack } from '../packs/manifest/loader.js';
import type { PackRuntimeClockSnapshot, PackRuntimeHandle, PackRuntimeHealthSnapshot } from './pack_runtime_handle.js';
import type { RuntimeSpeedSnapshot } from './runtime_speed.js';
import type { StepContext, StepStrategy } from './step_strategy.js';

export interface PackRuntimeHost {
  load(): void;
  start(): void;
  stop(): void;
  dispose(): void;
  getHandle(): PackRuntimeHandle;
  getPack(): WorldPack;
  getClock(): ChronosEngine;
  getPackId(): string;
  getCurrentTick(): bigint;
  getCurrentRevision(): bigint;
  getStepTicks(): bigint;
  getAllTimes(): unknown;
  step(amount?: bigint): void;
  getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null;
  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void;
  getStepStrategy(): StepStrategy;
  setStepStrategy(strategy: StepStrategy): void;
  getEffectiveStepTicks(ctx: StepContext, requestedStep?: bigint): bigint;
  getLoopIntervalMs(): number;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  clearRuntimeSpeedOverride(): void;
  getHealthSnapshot(): PackRuntimeHealthSnapshot;
  getClockSnapshot(): PackRuntimeClockSnapshot;
  setRequestedStepTicks(ticks: bigint): void;
  consumeRequestedStepTicks(): bigint | undefined;
}
