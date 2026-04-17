import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type { SimulationManager } from '../core/simulation.js';
import type { SqliteRuntimePragmaSnapshot } from '../db/sqlite_runtime.js';
import type { NotificationLevel, SystemMessage } from '../utils/notifications.js';

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

export interface AppContext {
  prisma: PrismaClient;
  sim: SimulationManager;
  notifications: NotificationStore;
  startupHealth: StartupHealth;
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
  assertRuntimeReady(feature: string): void;
}

export type RouteRegistrar = (app: Express, context: AppContext) => void;
