import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type { ConversationStore } from '../conversation/store.js';
import type { DatabaseHealthSnapshot } from '../db/sqlite_runtime.js';
import type { PackStorageAdapter } from '../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../packs/storage/SchedulerStorageAdapter.js';
import type { NotificationLevel, SystemMessage } from '../utils/notifications.js';
import type { PackScopeResolver } from './runtime/PackScopeResolver.js';
import type { AppContextPorts } from './services/app_context_ports.js';
import type { MultiPackRuntimePort, PackRuntimePort } from './services/pack/pack_runtime_ports.js';
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
  readonly packScope?: PackScopeResolver;
  packRuntime?: PackRuntimePort;
  multiPackRuntime?: MultiPackRuntimePort;

  getSpatialRuntime?(): import('../packs/runtime/spatial_runtime.js').SpatialRuntime | null;
  getPackRuntimeHost?(packId: string): import('../core/pack_runtime_host.js').PackRuntimeHost | null;
  getPackRuntimeHandle?(packId: string): import('../core/pack_runtime_handle.js').PackRuntimeHandle | null;
  listLoadedPackRuntimeIds?(): string[];

  getRuntimeLoopDiagnostics?(): RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics?(next: RuntimeLoopDiagnostics): void;
  getDatabaseHealth?(): DatabaseHealthSnapshot | null;
  getPluginEnableWarningConfig?(): {
    enabled: boolean;
    require_acknowledgement: boolean;
  };
  getHttpApp?(): Express | null;
  setHttpApp?(app: Express): void;
  worldEngineStepCoordinator?: import('./runtime/world_engine_persistence.js').WorldEngineStepCoordinator;
  runtimeClockProjection?: import('./runtime/runtime_clock_projection.js').RuntimeClockProjectionService;
}

export type RouteRegistrar = (app: Express, context: AppContext) => void;

