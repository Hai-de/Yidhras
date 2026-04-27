import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type { ActivePackProvider } from '../core/active_pack_provider.js';
import type { ClockProvider } from '../core/clock_provider.js';
import type { SimulationManager } from '../core/simulation.js';
import type { SqliteRuntimePragmaSnapshot } from '../db/sqlite_runtime.js';
import type { NotificationLevel, SystemMessage } from '../utils/notifications.js';
import type { AppContextPorts } from './services/app_context_ports.js';

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

export interface ClockSource {
  readonly clock: ClockProvider;
}

export interface ActivePackSource {
  readonly activePack: ActivePackProvider;
}

export interface RuntimeSource extends ClockSource, ActivePackSource {}

export interface AppInfrastructure extends RuntimeSource {
  readonly prisma: PrismaClient;
  readonly notifications: NotificationStore;
  readonly startupHealth: StartupHealth;
  assertRuntimeReady(feature: string): void;
}

export interface AppContext extends AppInfrastructure, AppContextPorts {
  /**
   * @deprecated Use focused ports (clock, activePack, activePackRuntime, etc.)
   * instead of reaching into sim directly. Will be removed in Batch 3.
   */
  readonly sim: SimulationManager;
  getRuntimeReady(): boolean;
  setRuntimeReady(ready: boolean): void;
  getPaused(): boolean;
  setPaused(paused: boolean): void;
  getRuntimeLoopDiagnostics?(): RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics?(next: RuntimeLoopDiagnostics): void;
  getSqliteRuntimePragmas?(): SqliteRuntimePragmaSnapshot | null;
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
