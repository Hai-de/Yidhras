import type {
  PackRuntimeClockSnapshot,
  PackRuntimeHandle,
  PackRuntimeHealthSnapshot
} from './pack_runtime_handle.js';
import type { PackRuntimeStatusSnapshot } from './pack_runtime_health.js';
import type { RuntimeSpeedSnapshot } from './runtime_speed.js';

export type PackRuntimeScopeMode = 'stable' | 'experimental';

export interface PackRuntimeSummary {
  pack_id: string;
  pack_folder_name?: string | null;
  health_status: PackRuntimeHealthSnapshot['status'];
  current_tick?: string | null;
  runtime_ready?: boolean;
}

export interface PackRuntimeLocator {
  listLoadedPackIds(): string[];
  getActivePackId(): string | null;
  getHandle(packId: string): PackRuntimeHandle | null;
  hasPackRuntime(packId: string): boolean;
  resolveStablePackScope(packId: string, feature: string): string;
  resolveExperimentalPackScope(packId: string, feature: string): string;
}

export interface PackRuntimeControl {
  load(packRef: string): Promise<{
    handle: PackRuntimeHandle;
    loaded: boolean;
    already_loaded: boolean;
  }>;
  unload(packId: string): Promise<boolean>;
  start?(packId: string): Promise<void>;
  stop?(packId: string): Promise<void>;
}

export interface PackRuntimeObservation {
  getStatus(packId: string): PackRuntimeStatusSnapshot | null;
  listStatuses(): PackRuntimeStatusSnapshot[];
  getClockSnapshot(packId: string): PackRuntimeClockSnapshot | null;
  getRuntimeSpeedSnapshot(packId: string): RuntimeSpeedSnapshot | null;
}

export interface PackRuntimeLookupPort {
  getActivePackId(): string | null;
  hasPackRuntime(packId: string): boolean;
  assertPackScope(packId: string, mode: PackRuntimeScopeMode, feature: string): string;
  getPackRuntimeSummary(packId: string): PackRuntimeSummary | null;
}

export interface PackScopeResolver {
  assertPackScope(packId: string, mode: PackRuntimeScopeMode, feature: string): string;
}
