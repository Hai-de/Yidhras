import type { RuntimeSpeedSnapshot } from './runtime_speed.js';

/** Stub pack runtime — provides safe defaults when no PackRuntimePort is available. */
export const PACK_RUNTIME_STUB = {
  getCurrentTick: (): bigint => 0n,
  getCurrentRevision: (): bigint => 0n,
  getStepTicks: (): bigint => 1n,
  getRuntimeSpeedSnapshot: (): RuntimeSpeedSnapshot => ({
    mode: 'fixed',
    source: 'default',
    effective_step_ticks: '1',
    configured_step_ticks: null,
    override_step_ticks: null,
    override_since: null
  }),
  setRuntimeSpeedOverride: (_stepTicks: bigint): void => {},
  clearRuntimeSpeedOverride: (): void => {},
  getAllTimes: () => [],
  step: async (_amount?: bigint): Promise<void> => {},
  getPackSlotDeclarations: (): Record<string, Record<string, unknown>> | null => null,
  resolvePackVariables: (template: string): string => template
};
