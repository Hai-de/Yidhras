import type { PrismaClient } from '@prisma/client';

import type { ConversationStore } from '../conversation/store.js';
import type { DatabaseHealthSnapshot } from '../db/sqlite_runtime.js';
import type { PackRuntimeHost } from '../core/pack_runtime_host.js';
import type { PackRuntimeHandle } from '../core/pack_runtime_handle.js';
import type { PackStorageAdapter } from '../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../packs/storage/SchedulerStorageAdapter.js';
import type { NotificationLevel, SystemMessage } from '../utils/notifications.js';
import type { PackScopeResolver } from './runtime/PackScopeResolver.js';
import type {
  RuntimeClockProjectionService
} from './runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from './runtime/world_engine_persistence.js';
import type { PackHostApi, WorldEnginePort } from './runtime/world_engine_ports.js';
import type { AppContextPorts } from './services/app_context_ports.js';
import type { ContextAssemblyPort } from './services/context/context_memory_ports.js';
import type { Repositories } from './services/repositories/index.js';

export type HealthLevel = 'ok' | 'degraded' | 'fail';

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
  getMessages(): SystemMessage[];
  clear(): void;
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

export interface AppInfrastructure {
  readonly repos: Repositories;
  readonly prisma: PrismaClient;
  readonly conversationStore: ConversationStore;
  readonly packStorageAdapter: PackStorageAdapter;
  readonly schedulerStorage?: SchedulerStorageAdapter;
  readonly notifications: NotificationStore;
  readonly startupHealth: StartupHealth;
  assertRuntimeReady(feature: string): void;
  isRuntimeReady(): boolean;
  setRuntimeReady(ready: boolean): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  requestPluginInference?(input: import('../plugins/runtime.js').PluginInferenceRequest): Promise<import('../plugins/runtime.js').PluginInferenceResult>;
}

export interface AppContext extends AppInfrastructure, AppContextPorts {
  readonly packScope: PackScopeResolver;
  getPackRuntimeHandle(packId: string): PackRuntimeHandle | null;
  listLoadedPackRuntimeIds(): string[];
  getPackRuntimeHost(packId: string): PackRuntimeHost | null;

  getSpatialRuntime?(): import('../packs/runtime/spatial_runtime.js').SpatialRuntime | null;

  getRuntimeLoopDiagnostics(): RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics(next: RuntimeLoopDiagnostics): void;
  getDatabaseHealth(): DatabaseHealthSnapshot | null;
  getPluginEnableWarningConfig(): {
    enabled: boolean;
    require_acknowledgement: boolean;
  };
  worldEngineStepCoordinator: WorldEngineStepCoordinator;
  runtimeClockProjection: RuntimeClockProjectionService;
  pluginRuntimeControl?: {
    reload(packId: string): Promise<{ pack_id: string; runtime_count: number }>;
  };
}

export type RouteRegistrar = (app: import('express').Express, context: AppContext) => void;
