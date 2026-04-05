import fs from 'fs';
import path from 'path';

import type { RuntimeStartupPolicy } from '../../config/runtime_config.js';
import { ApiError } from '../../utils/api_error.js';
import type { StartupHealth } from '../context.js';

export const createStartupHealth = (): StartupHealth => {
  return {
    level: 'fail',
    checks: {
      db: false,
      world_pack_dir: false,
      world_pack_available: false
    },
    available_world_packs: [],
    errors: []
  };
};

const hasPackConfig = (packDir: string): boolean => {
  const candidates = ['config.yaml', 'config.yml', 'pack.yaml', 'pack.yml'];
  return candidates.some(file => fs.existsSync(path.join(packDir, file)));
};

const detectAvailableWorldPacks = (worldPacksDir: string): string[] => {
  if (!fs.existsSync(worldPacksDir)) {
    return [];
  }

  const entries = fs.readdirSync(worldPacksDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => hasPackConfig(path.join(worldPacksDir, entry.name)))
    .map(entry => entry.name);
};

const hasNonDatabaseStartupIssue = (startupHealth: StartupHealth): boolean => {
  return !startupHealth.checks.world_pack_dir || !startupHealth.checks.world_pack_available;
};

const shouldFailStartup = (startupHealth: StartupHealth, startupPolicy: RuntimeStartupPolicy): boolean => {
  if (!startupHealth.checks.db) {
    return true;
  }

  if (!hasNonDatabaseStartupIssue(startupHealth)) {
    return false;
  }

  if (!startupPolicy.allowDegradedMode) {
    return true;
  }

  if (!startupHealth.checks.world_pack_dir && startupPolicy.failOnMissingWorldPackDir) {
    return true;
  }

  if (!startupHealth.checks.world_pack_available && startupPolicy.failOnNoWorldPack) {
    return true;
  }

  return false;
};

export interface RunStartupPreflightOptions {
  startupHealth: StartupHealth;
  startupPolicy: RuntimeStartupPolicy;
  worldPacksDir: string;
  queryDatabaseHealth(): Promise<unknown>;
  getErrorMessage(err: unknown): string;
}

export const runStartupPreflight = async ({
  startupHealth,
  startupPolicy,
  worldPacksDir,
  queryDatabaseHealth,
  getErrorMessage
}: RunStartupPreflightOptions): Promise<void> => {
  startupHealth.errors = [];
  startupHealth.checks.world_pack_dir = fs.existsSync(worldPacksDir);
  startupHealth.available_world_packs = detectAvailableWorldPacks(worldPacksDir);
  startupHealth.checks.world_pack_available = startupHealth.available_world_packs.length > 0;

  try {
    await queryDatabaseHealth();
    startupHealth.checks.db = true;
  } catch (err: unknown) {
    startupHealth.checks.db = false;
    startupHealth.errors.push(`database check failed: ${getErrorMessage(err)}`);
  }

  if (!startupHealth.checks.world_pack_dir) {
    startupHealth.errors.push(`world pack directory missing: ${worldPacksDir}`);
  }
  if (!startupHealth.checks.world_pack_available) {
    startupHealth.errors.push('no available world pack found');
  }

  if (shouldFailStartup(startupHealth, startupPolicy)) {
    startupHealth.level = 'fail';
    return;
  }

  startupHealth.level = hasNonDatabaseStartupIssue(startupHealth) ? 'degraded' : 'ok';
};

export interface RuntimeReadyGuardOptions {
  getRuntimeReady(): boolean;
  startupHealth: StartupHealth;
}

export const createRuntimeReadyGuard = ({
  getRuntimeReady,
  startupHealth
}: RuntimeReadyGuardOptions) => {
  return (feature: string): void => {
    if (getRuntimeReady()) {
      return;
    }

    throw new ApiError(503, 'WORLD_PACK_NOT_READY', `World pack not ready for ${feature}`, {
      startup_level: startupHealth.level,
      available_world_packs: startupHealth.available_world_packs
    });
  };
};

export const selectStartupWorldPack = (
  availableWorldPacks: string[],
  preferredWorldPack: string
): string | undefined => {
  if (availableWorldPacks.includes(preferredWorldPack)) {
    return preferredWorldPack;
  }

  return availableWorldPacks[0];
};
