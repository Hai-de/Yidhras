import type { PackRuntimeHandle } from '../../core/pack_runtime_handle.js';
import type { HealthLevel } from '../../core/pack_runtime_health.js';
import type { NotificationCodeValue } from '../../utils/notification_details.js';
import type { NotificationLevel, SystemMessage } from '../../utils/notifications.js';
import type { PackScopeResolver } from '../runtime/PackScopeResolver.js';

export type { HealthLevel };

export interface StartupHealth {
  level: HealthLevel;
  checks: {
    db: boolean;
    world_pack_dir: boolean;
    world_pack_available: boolean;
  };
  available_world_packs: string[];
  errors: string[];
}

export interface NotificationStore {
  push(
    level: NotificationLevel,
    content: string,
    code?: string,
    details?: Record<string, unknown>
  ): SystemMessage;
  pushOrReplace(
    level: NotificationLevel,
    content: string,
    code: NotificationCodeValue,
    details: Record<string, unknown>,
    replaceKey: string
  ): SystemMessage;
  getMessages(): SystemMessage[];
  clear(): void;
}

/**
 * 薄接口：仅暴露通知能力，不捆绑 RuntimeContext 的其他 14 个字段/方法。
 * RuntimeContext 和 InferenceContext 分别扩展此接口，
 * 避免 InferenceContext 依赖运行时生命周期方法。
 */
export interface NotificationAware {
  readonly notifications: NotificationStore;
}

export interface RuntimeLoopDiagnostics {
  status: 'idle' | 'scheduled' | 'running' | 'paused' | 'stopped';
  in_flight: boolean;
  overlap_skipped_count: number;
  iteration_count: number;
  last_started_at: number | null;
  last_finished_at: number | null;
  last_duration_ms: number | null;
  last_error_message: string | null;
}

export interface RuntimeContext extends NotificationAware {
  readonly notifications: NotificationStore;
  readonly startupHealth: StartupHealth;
  assertRuntimeReady(feature: string): void;
  isRuntimeReady(): boolean;
  setRuntimeReady(ready: boolean): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  getRuntimeLoopDiagnostics(): RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics(next: RuntimeLoopDiagnostics): void;
  readonly packScope: PackScopeResolver;
  readonly packCatalog: import('../services/app_context_ports.js').PackCatalogService;
  getPackRuntimeHandle(packId: string): PackRuntimeHandle | null;
  listLoadedPackRuntimeIds(): string[];
  getSpatialRuntime?(): import('../../packs/runtime/spatial_runtime.js').SpatialRuntime | null;
}
