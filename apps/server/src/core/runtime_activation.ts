import type { PrismaClient } from '@prisma/client';
import path from 'path';

import { ChronosEngine } from '../clock/engine.js';
import type { CalendarConfig } from '../clock/types.js';
import type { PackManifestLoader, WorldPack } from '../packs/manifest/loader.js';
import { discoverPackLocalPlugins, type PluginDiscoveryResult } from '../plugins/discovery.js';
import { notifications } from '../utils/notifications.js';
import { materializePackRuntime } from './pack_materializer.js';
import type { RuntimeSpeedPolicy } from './runtime_speed.js';
import { getWorldPackRuntimeConfig } from './world_pack_runtime.js';

export interface ActivateWorldPackRuntimeOptions {
  packFolderName: string;
  loader: Pick<PackManifestLoader, 'loadPack'>;
  prisma: PrismaClient;
  runtimeSpeed: RuntimeSpeedPolicy;
  packsDir: string;
}

export interface ActivatedWorldPackRuntime {
  pack: WorldPack;
  clock: ChronosEngine;
  discoveredPlugins: PluginDiscoveryResult;
}

const configureRuntimeSpeedFromPack = (runtimeSpeed: RuntimeSpeedPolicy, pack: WorldPack): void => {
  const runtimeConfig = getWorldPackRuntimeConfig(pack);

  if (runtimeConfig.configuredStepTicks !== undefined && runtimeConfig.configuredStepTicks > 0n) {
    runtimeSpeed.setConfiguredStepTicks(runtimeConfig.configuredStepTicks);
    return;
  }

  runtimeSpeed.setConfiguredStepTicks(null);
  if (runtimeConfig.configuredStepTicks !== undefined) {
    notifications.push('warning', '世界包字段 simulation_time.step_ticks 必须大于 0，已回退为 1', 'PACK_STEP_TICK_INVALID');
  }
};

const resolvePackClock = async (input: {
  calendars: CalendarConfig[];
  initialTick: bigint;
  prisma: PrismaClient;
}): Promise<ChronosEngine> => {
  const { calendars, initialTick, prisma } = input;
  const lastEvent = await prisma.event.findFirst({
    orderBy: { tick: 'desc' }
  });

  if (lastEvent) {
    return new ChronosEngine(calendars, lastEvent.tick);
  }

  return new ChronosEngine(calendars, initialTick);
};

const validateActivatedTickBounds = (pack: WorldPack, clock: ChronosEngine): void => {
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  const currentTick = clock.getTicks();

  if (runtimeConfig.minTick !== undefined && currentTick < runtimeConfig.minTick) {
    notifications.push(
      'warning',
      `当前模拟时间 ${currentTick.toString()} 低于世界包最小时间 ${runtimeConfig.minTick.toString()}`,
      'SIM_TICK_BELOW_MIN'
    );
  }

  if (runtimeConfig.maxTick !== undefined && currentTick > runtimeConfig.maxTick) {
    notifications.push(
      'warning',
      `当前模拟时间 ${currentTick.toString()} 超出世界包最大时间 ${runtimeConfig.maxTick.toString()}`,
      'SIM_TICK_ABOVE_MAX'
    );
  }
};

export const activateWorldPackRuntime = async ({
  packFolderName,
  loader,
  prisma,
  runtimeSpeed,
  packsDir
}: ActivateWorldPackRuntimeOptions): Promise<ActivatedWorldPackRuntime> => {
  const pack = loader.loadPack(packFolderName);
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];

  configureRuntimeSpeedFromPack(runtimeSpeed, pack);

  await materializePackRuntime({ pack, prisma, initialTick: runtimeConfig.initialTick });

  const clock = await resolvePackClock({
    calendars,
    initialTick: runtimeConfig.initialTick,
    prisma
  });

  const discoveredPlugins = await discoverPackLocalPlugins({
    prismaContext: { prisma },
    pack,
    packRootDir: path.join(packsDir, packFolderName)
  });

  validateActivatedTickBounds(pack, clock);

  return {
    pack,
    clock,
    discoveredPlugins
  };
};
