import type { RuntimeClockProjectionSnapshot } from '../app/runtime/runtime_clock_projection.js';
import type { ChronosEngine } from '../clock/engine.js';
import type { WorldPack } from '../packs/manifest/loader.js';
import type { PackRuntimeClockSnapshot, PackRuntimeHandle, PackRuntimeHealthSnapshot } from './pack_runtime_handle.js';
import type { RuntimeSpeedSnapshot } from './runtime_speed.js';

export interface PackRuntimeHost {
  load(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  getHandle(): PackRuntimeHandle;
  getPack(): WorldPack;
  getClock(): ChronosEngine;
  getPackId(): string;
  getCurrentTick(): bigint;
  getCurrentRevision(): bigint;
  getStepTicks(): bigint;
  getAllTimes(): unknown;
  step(amount?: bigint): Promise<void>;
  getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null;
  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void;
  setRuntimeSpeedOverride(stepTicks: bigint): void;
  clearRuntimeSpeedOverride(): void;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  getHealthSnapshot(): PackRuntimeHealthSnapshot;
  getClockSnapshot(): PackRuntimeClockSnapshot;
}
