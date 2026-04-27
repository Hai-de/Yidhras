import type { WorldPack } from '../packs/manifest/constitution_loader.js';

export const parseTickToBigInt = (
  value: string | number | undefined,
  _fieldName: string
): bigint | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch {
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
