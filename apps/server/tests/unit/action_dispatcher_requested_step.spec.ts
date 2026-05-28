import { describe, expect, it,vi } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { dispatchActionIntent } from '../../src/app/services/action/action_dispatcher.js';
import type { ActionIntentRecord } from '../../src/app/services/action/action_intent_repository.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';

const buildMockPackRuntime = (): PackRuntimePort => {
  return {
    setRequestedStepTicks: vi.fn(),
    getCurrentTick: () => 0n,
    getPack: () => null as unknown as ReturnType<PackRuntimePort['getPack']>,
    getPackId: () => 'test-pack',
    getCurrentRevision: () => 0n,
    getStepTicks: () => 1n,
    getStepStrategy: () => ({ kind: 'variable' as const, range: { min: 1n, max: 100n }, loopIntervalMs: 1000 }),
    getEffectiveStepTicks: () => 1n,
    getLoopIntervalMs: () => 1000,
    getAllTimes: () => [],
    getPackSlotDeclarations: () => null,
    resolvePackVariables: (t: string) => t,
    getRuntimeSpeedSnapshot: () => ({ mode: 'variable' as const, source: 'default' as const, strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 }, effective_step_ticks: '1', override_since: null }),
    applyClockProjection: () => {},
    setStepStrategy: () => {},
    clearRuntimeSpeedOverride: () => {},
    step: () => {},
    consumeRequestedStepTicks: () => undefined
  };
};

const buildMockContext = (): AppContext => {
  return {
    prisma: {
      actionIntent: { findUnique: vi.fn() }
    },
    repos: {
      identityOperator: {
        findOperatorById: vi.fn(),
        findOperatorGrant: vi.fn()
      }
    }
  } as unknown as AppContext;
};

const buildIntent = (overrides: Partial<ActionIntentRecord>): ActionIntentRecord => {
  return {
    id: 'ai-test-1',
    source_inference_id: 'inf-1',
    intent_type: 'set_requested_step_ticks',
    actor_ref: { agent_id: 'agent-1' },
    target_ref: {},
    payload: {},
    locked_by: 'worker-1',
    lock_expires_at: 999n,
    status: 'dispatching',
    created_at: 0n,
    ...overrides
  } as ActionIntentRecord;
};

describe('set_requested_step_ticks dispatch', () => {
  it('extracts number ticks from payload and calls setRequestedStepTicks', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: { ticks: 80 } });

    await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(packRuntime.setRequestedStepTicks).toHaveBeenCalledWith(80n);
  });

  it('extracts string ticks from payload and calls setRequestedStepTicks', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: { ticks: '50' } });

    await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(packRuntime.setRequestedStepTicks).toHaveBeenCalledWith(50n);
  });

  it('does not call setRequestedStepTicks when ticks is 0', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: { ticks: 0 } });

    await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(packRuntime.setRequestedStepTicks).not.toHaveBeenCalled();
  });

  it('does not call setRequestedStepTicks when ticks is a negative string', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: { ticks: '-5' } });

    await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(packRuntime.setRequestedStepTicks).not.toHaveBeenCalled();
  });

  it('does not call setRequestedStepTicks when payload is not a record', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: 'not-an-object' });

    await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(packRuntime.setRequestedStepTicks).not.toHaveBeenCalled();
  });

  it('does not call setRequestedStepTicks when ticks is an invalid string', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: { ticks: 'not-a-number' } });

    await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(packRuntime.setRequestedStepTicks).not.toHaveBeenCalled();
  });

  it('returns completed outcome on success', async () => {
    const packRuntime = buildMockPackRuntime();
    const intent = buildIntent({ payload: { ticks: 10 } });

    const result = await dispatchActionIntent(buildMockContext(), intent, packRuntime);

    expect(result).toEqual({ outcome: 'completed', reason: null });
  });
});
