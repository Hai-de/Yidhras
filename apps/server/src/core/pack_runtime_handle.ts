import type { WorldPack } from '../packs/manifest/loader.js';
import type { RuntimeSpeedSnapshot } from './runtime_speed.js';

export interface PackRuntimeClockSnapshot {
  current_tick: string;
}

export interface PackRuntimeHealthSnapshot {
  status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
  message?: string | null;
}

export interface PackRuntimeHandle {
  pack_id: string;
  pack_folder_name: string;
  pack: WorldPack;
  getClockSnapshot(): PackRuntimeClockSnapshot;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  getHealthSnapshot(): PackRuntimeHealthSnapshot;
}
