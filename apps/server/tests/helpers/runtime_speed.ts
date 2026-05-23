import type { RuntimeSpeedSnapshot } from '../../src/core/runtime_speed.js';
import type { StepStrategy } from '../../src/core/step_strategy.js';

export const createVariableStepStrategy = (
  overrides: Partial<StepStrategy> = {}
): StepStrategy => {
  const base: StepStrategy = {
    kind: 'variable',
    range: { min: 1n, max: 1n },
    loopIntervalMs: 1000
  };

  return {
    ...base,
    ...overrides,
    range: {
      ...base.range,
      ...(overrides.range ?? {})
    }
  };
};

export const createVariableRuntimeSpeedSnapshot = (
  overrides: Partial<RuntimeSpeedSnapshot> = {}
): RuntimeSpeedSnapshot => {
  const strategy = overrides.strategy ?? createVariableStepStrategy();
  return {
    mode: strategy.kind,
    source: 'default',
    strategy,
    effective_step_ticks: '1',
    override_since: null,
    ...overrides
  };
};
