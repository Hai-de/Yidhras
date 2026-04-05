import { notifications } from '../utils/notifications.js';
import type { WorldPack } from '../world/loader.js';

export const parseTickToBigInt = (
  value: string | number | undefined,
  fieldName: string
): bigint | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch {
    notifications.push('warning', `世界包字段 ${fieldName} 无法解析为 BigInt，已忽略该配置`, 'PACK_TIME_PARSE_WARN');
    return undefined;
  }
};

export interface WorldPackRuntimeConfig {
  initialTick: bigint;
  minTick: bigint | undefined;
  maxTick: bigint | undefined;
  configuredStepTicks: bigint | undefined;
}

export const getWorldPackRuntimeConfig = (pack: WorldPack): WorldPackRuntimeConfig => {
  const configuredInitialTick = parseTickToBigInt(pack.simulation_time?.initial_tick, 'simulation_time.initial_tick');

  return {
    initialTick: configuredInitialTick ?? 0n,
    minTick: parseTickToBigInt(pack.simulation_time?.min_tick, 'simulation_time.min_tick'),
    maxTick: parseTickToBigInt(pack.simulation_time?.max_tick, 'simulation_time.max_tick'),
    configuredStepTicks: parseTickToBigInt(pack.simulation_time?.step_ticks, 'simulation_time.step_ticks')
  };
};
