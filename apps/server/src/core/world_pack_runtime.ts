import type { WorldPack } from '../packs/manifest/constitution_loader.js';
import type { StepStrategy } from './step_strategy.js';

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

const parseStepConfig = (pack: WorldPack): StepStrategy | undefined => {
  const step = pack.simulation_time?.step;
  if (!step) return undefined;

  const rangeMin = parseTickToBigInt(step.range.min, 'simulation_time.step.range.min') ?? 1n;
  const rangeMax = parseTickToBigInt(step.range.max, 'simulation_time.step.range.max') ?? 1n;

  const strategy: StepStrategy = {
    kind: step.strategy,
    range: { min: rangeMin, max: rangeMax },
    loopIntervalMs: step.loop_interval_ms ?? 1000
  };

  if (step.strategy === 'adaptive' && step.adaptive) {
    strategy.adaptive = {
      targetLoopMs: step.adaptive.target_loop_ms,
      scaleUpThresholdMs: step.adaptive.scale_up_threshold_ms,
      scaleDownThresholdMs: step.adaptive.scale_down_threshold_ms
    };
  }

  return strategy;
};

export interface WorldPackRuntimeConfig {
  initialTick: bigint;
  minTick: bigint | undefined;
  maxTick: bigint | undefined;
  stepStrategy: StepStrategy | undefined;
}

export const getWorldPackRuntimeConfig = (pack: WorldPack): WorldPackRuntimeConfig => {
  const configuredInitialTick = parseTickToBigInt(pack.simulation_time?.initial_tick, 'simulation_time.initial_tick');

  return {
    initialTick: configuredInitialTick ?? 0n,
    minTick: parseTickToBigInt(pack.simulation_time?.min_tick, 'simulation_time.min_tick'),
    maxTick: parseTickToBigInt(pack.simulation_time?.max_tick, 'simulation_time.max_tick'),
    stepStrategy: parseStepConfig(pack)
  };
};
