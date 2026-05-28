import type { RuntimeSpeedSnapshot } from './runtime_speed.js';
import type { StepStrategy } from './step_strategy.js';

const STUB_STRATEGY: StepStrategy = {
  kind: 'variable',
  range: { min: 1n, max: 1n },
  loopIntervalMs: 1000
};

/** Stub pack runtime — provides safe defaults when no PackRuntimePort is available. */
export const PACK_RUNTIME_STUB = {
  getCurrentTick: (): bigint => 0n,
  getCurrentRevision: (): bigint => 0n,
  getStepTicks: (): bigint => 1n,
  getRuntimeSpeedSnapshot: (): RuntimeSpeedSnapshot => ({
    mode: 'variable',
    source: 'default',
    strategy: STUB_STRATEGY,
    effective_step_ticks: '1',
    override_since: null
  }),
  getStepStrategy: (): StepStrategy => STUB_STRATEGY,
  setStepStrategy: (_strategy: StepStrategy): void => {},
  getEffectiveStepTicks: (): bigint => 1n,
  getLoopIntervalMs: (): number => 1000,
  clearRuntimeSpeedOverride: (): void => {},
  getAllTimes: () => [],
  step: async (_amount?: bigint): Promise<void> => {},
  getPackSlotDeclarations: (): Record<string, Record<string, unknown>> | null => null,
  resolvePackVariables: (template: string): string => template,
  setRequestedStepTicks: (_ticks: bigint): void => {},
  consumeRequestedStepTicks: (): bigint | undefined => undefined
};
