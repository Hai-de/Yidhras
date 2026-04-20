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
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  getHealthSnapshot(): PackRuntimeHealthSnapshot;
  getClockSnapshot(): PackRuntimeClockSnapshot;
}
