import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type { SimulationManager } from '../core/simulation.js';
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

export interface AppContext {
  prisma: PrismaClient;
  sim: SimulationManager;
  notifications: NotificationStore;
  startupHealth: StartupHealth;
  getRuntimeReady(): boolean;
  setRuntimeReady(ready: boolean): void;
  getPaused(): boolean;
  setPaused(paused: boolean): void;
  assertRuntimeReady(feature: string): void;
}

export type RouteRegistrar = (app: Express, context: AppContext) => void;
