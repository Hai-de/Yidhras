import type { HealthLevel } from '../app/context.js';
import type { RuntimeSpeedSnapshot } from './runtime_speed.js';

export interface ExperimentalPackRuntimeStatusRecord {
  pack_id: string;
  status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
  current_tick: string;
  message?: string | null;
}

export interface PackRuntimeStatusSnapshot {
  pack_id: string;
  pack_folder_name: string;
  health_status: ExperimentalPackRuntimeStatusRecord['status'];
  current_tick: string;
  runtime_speed: RuntimeSpeedSnapshot;
  startup_level: HealthLevel;
  runtime_ready: boolean;
  message?: string | null;
}
