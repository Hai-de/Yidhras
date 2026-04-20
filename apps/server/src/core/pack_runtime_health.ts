import type { HealthLevel } from '../app/context.js';

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
  runtime_speed: {
    mode: 'fixed';
    source: 'default' | 'world_pack' | 'override';
    configured_step_ticks: string | null;
    override_step_ticks: string | null;
    override_since: number | null;
    effective_step_ticks: string;
  };
  startup_level: HealthLevel;
  runtime_ready: boolean;
  message?: string | null;
}
