import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { stepPackWorldEngine } from '../../src/app/runtime/PackSimulationLoop.js';
import type { WorldEngineSidecarClient } from '../../src/app/runtime/sidecar/world_engine_sidecar_client.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';

vi.mock('../../src/app/runtime/world_engine_persistence.js', () => ({
  executeWorldEnginePreparedStep: vi.fn(),
  createDefaultWorldEnginePersistencePort: vi.fn(() => ({}))
}));

const buildPackRuntime = (overrides?: Partial<PackRuntimePort>): PackRuntimePort => {
  return {
    getCurrentTick: () => 100n,
    getCurrentRevision: () => 100n,
    getPackId: () => 'test-pack',
    getStepTicks: () => 1n,
    getStepStrategy: () => ({ kind: 'variable' as const, range: { min: 1n, max: 100n }, loopIntervalMs: 1000 }),
    getLoopIntervalMs: () => 1000,
    getEffectiveStepTicks: vi.fn(() => 1n),
    getAllTimes: () => [],
    getPack: () => null as unknown as ReturnType<PackRuntimePort['getPack']>,
    getPackSlotDeclarations: () => null,
    resolvePackVariables: (t: string) => t,
    getRuntimeSpeedSnapshot: () => ({ mode: 'variable' as const, source: 'default' as const, strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 }, effective_step_ticks: '1', override_since: null }),
    applyClockProjection: vi.fn(),
    setStepStrategy: vi.fn(),
    clearRuntimeSpeedOverride: vi.fn(),
    step: vi.fn(),
    setRequestedStepTicks: vi.fn(),
    consumeRequestedStepTicks: vi.fn(() => undefined),
    ...overrides
  };
};

const buildWorldEngine = (): WorldEngineSidecarClient => {
  return {} as WorldEngineSidecarClient;
};

describe('stepPackWorldEngine requestedStep flow', () => {
  it('calls consumeRequestedStepTicks', async () => {
    const packRuntime = buildPackRuntime();
    const worldEngine = buildWorldEngine();

    await stepPackWorldEngine(
      {} as AppContext,
      'test-pack',
      worldEngine,
      packRuntime,
      { status: 'running', in_flight: false, overlap_skipped_count: 0, iteration_count: 0, consecutive_failures: 0, last_started_at: null, last_finished_at: null, last_duration_ms: null, last_error_message: null, last_step_errors: [], last_extension_errors: [] }
    );

    expect(packRuntime.consumeRequestedStepTicks).toHaveBeenCalledOnce();
  });

  it('passes consumed value to getEffectiveStepTicks', async () => {
    const packRuntime = buildPackRuntime({
      consumeRequestedStepTicks: vi.fn(() => 50n),
      getEffectiveStepTicks: vi.fn(() => 50n)
    });
    const worldEngine = buildWorldEngine();

    await stepPackWorldEngine(
      {} as AppContext,
      'test-pack',
      worldEngine,
      packRuntime,
      { status: 'running', in_flight: false, overlap_skipped_count: 0, iteration_count: 0, consecutive_failures: 0, last_started_at: null, last_finished_at: null, last_duration_ms: null, last_error_message: null, last_step_errors: [], last_extension_errors: [] }
    );

    expect(packRuntime.consumeRequestedStepTicks).toHaveBeenCalledOnce();
    expect(packRuntime.getEffectiveStepTicks).toHaveBeenCalledWith(
      expect.objectContaining({ currentTick: 100n }),
      50n
    );
  });

  it('passes undefined to getEffectiveStepTicks when no ticks were requested', async () => {
    const packRuntime = buildPackRuntime({
      consumeRequestedStepTicks: vi.fn(() => undefined),
      getEffectiveStepTicks: vi.fn(() => 1n)
    });
    const worldEngine = buildWorldEngine();

    await stepPackWorldEngine(
      {} as AppContext,
      'test-pack',
      worldEngine,
      packRuntime,
      { status: 'running', in_flight: false, overlap_skipped_count: 0, iteration_count: 0, consecutive_failures: 0, last_started_at: null, last_finished_at: null, last_duration_ms: null, last_error_message: null, last_step_errors: [], last_extension_errors: [] }
    );

    expect(packRuntime.consumeRequestedStepTicks).toHaveBeenCalledOnce();
    expect(packRuntime.getEffectiveStepTicks).toHaveBeenCalledWith(
      expect.objectContaining({ currentTick: 100n }),
      undefined
    );
  });

  it('does not crash when consume returns undefined and getEffectiveStepTicks uses default', async () => {
    const packRuntime = buildPackRuntime({
      consumeRequestedStepTicks: vi.fn(() => undefined),
      getEffectiveStepTicks: vi.fn(() => 1n)
    });
    const worldEngine = buildWorldEngine();

    await expect(
      stepPackWorldEngine(
        {} as AppContext,
        'test-pack',
        worldEngine,
        packRuntime,
        { status: 'running', in_flight: false, overlap_skipped_count: 0, iteration_count: 0, consecutive_failures: 0, last_started_at: null, last_finished_at: null, last_duration_ms: null, last_error_message: null, last_step_errors: [], last_extension_errors: [] }
      )
    ).resolves.toBeUndefined();
  });
});
