import { describe, expect, it, vi } from 'vitest';

import { recordAiInvocation } from '../../src/ai/observability.js';
import type { ModelGatewayResponse } from '../../src/ai/types.js';
import type { AppContext } from '../../src/app/context.js';

type UpsertFn = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface MockedUpsert {
  mock: {
    calls: Record<string, unknown>[][];
  };
}

const getCreatePayload = (fn: MockedUpsert): Record<string, unknown> | undefined =>
  (fn.mock.calls[0]?.[0] as Record<string, unknown> | undefined)?.create as Record<string, unknown> | undefined;

const getSecondCreatePayload = (fn: MockedUpsert): Record<string, unknown> | undefined =>
  (fn.mock.calls[1]?.[0] as Record<string, unknown> | undefined)?.create as Record<string, unknown> | undefined;

const createMockAppContext = (overrides?: {
  upsert?: UpsertFn;
  tick?: bigint;
}): AppContext => {
  const upsertFn: UpsertFn = overrides?.upsert ?? vi.fn<UpsertFn>();

  return {
    prisma: {
      aiInvocationRecord: { upsert: upsertFn }
    } as unknown as AppContext['prisma'],
    sim: { getCurrentTick: () => overrides?.tick ?? 1000n } as AppContext['sim'],
    notifications: { push: vi.fn(), getMessages: vi.fn(() => []), clear: vi.fn() },
    startupHealth: {
      level: 'ok' as const,
      checks: { db: true, world_pack_dir: true, world_pack_available: true },
      available_world_packs: [],
      errors: []
    },
    getRuntimeReady: () => true,
    setRuntimeReady: vi.fn(),
    getPaused: () => false,
    setPaused: vi.fn(),
    assertRuntimeReady: vi.fn(),
    getRuntimeLoopDiagnostics: vi.fn(() => ({
      status: 'idle', in_flight: false, overlap_skipped_count: 0,
      iteration_count: 0, last_started_at: null, last_finished_at: null,
      last_duration_ms: null, last_error_message: null
    })),
    setRuntimeLoopDiagnostics: vi.fn(),
    getSqliteRuntimePragmas: vi.fn(() => null),
    getHttpApp: vi.fn(() => null),
    setHttpApp: vi.fn(),
    worldEngineStepCoordinator: null as unknown as AppContext['worldEngineStepCoordinator']
  } as unknown as AppContext;
};

const DEFAULT_TRACE: ModelGatewayResponse['trace'] = {
  task_id: 'task-agent-decision',
  task_type: 'agent_decision',
  route_id: null,
  source_inference_id: 'inf-001',
  audit_level: 'standard',
  attempts: [
    { provider: 'mock', model: 'mock-default', status: 'completed', finish_reason: 'stop', latency_ms: 50 }
  ]
};

const createCompletedResponse = (overrides?: Partial<ModelGatewayResponse>): ModelGatewayResponse => ({
  invocation_id: 'inv-test-001',
  task_id: 'task-agent-decision',
  task_type: 'agent_decision',
  provider: 'mock',
  model: 'mock-default',
  route_id: null,
  fallback_used: false,
  attempted_models: ['mock:mock-default'],
  status: 'completed',
  finish_reason: 'stop',
  output: { mode: 'json_schema', json: { action_type: 'post_message' } },
  trace: { ...DEFAULT_TRACE },
  ...overrides
} as ModelGatewayResponse);

describe('recordAiInvocation', () => {
  it('calls prisma upsert on success', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    await recordAiInvocation(context, createCompletedResponse());
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('uses usage.latency_ms when present', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse({ usage: { latency_ms: 200 } });
    await recordAiInvocation(context, response);

    const create = getCreatePayload(upsert);
    expect(create?.latency_ms).toBe(200);
  });

  it('falls back to attempt latencies sum when usage has no latency_ms', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse({
      trace: {
        ...DEFAULT_TRACE,
        attempts: [
          { provider: 'mock', model: 'm1', status: 'completed', finish_reason: 'stop', latency_ms: 30 },
          { provider: 'mock', model: 'm2', status: 'completed', finish_reason: 'stop', latency_ms: 70 }
        ]
      }
    });
    await recordAiInvocation(context, response);

    const create = getCreatePayload(upsert);
    expect(create?.latency_ms).toBe(100);
  });

  it('sets latency_ms to null when no latency data is available', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse({
      trace: { ...DEFAULT_TRACE, source_inference_id: null, attempts: [] }
    });
    await recordAiInvocation(context, response);

    const create = getCreatePayload(upsert);
    expect(create?.latency_ms).toBeNull();
  });

  it('retries with null sourceInferenceId on P2003 foreign key violation', async () => {
    const upsert = vi.fn<UpsertFn>()
      .mockRejectedValueOnce(Object.assign(new Error('FK violation'), { code: 'P2003' }))
      .mockResolvedValueOnce({} as Record<string, unknown>);
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse({
      trace: { ...DEFAULT_TRACE, attempts: [] }
    });
    await recordAiInvocation(context, response);

    expect(upsert).toHaveBeenCalledTimes(2);
    const secondPayload = getSecondCreatePayload(upsert);
    expect(secondPayload?.source_inference_id).toBeNull();
  });

  it('throws on non-P2003 errors without retry', async () => {
    const upsert = vi.fn<UpsertFn>().mockRejectedValue(new Error('connection lost'));
    const context = createMockAppContext({ upsert });
    await expect(recordAiInvocation(context, createCompletedResponse())).rejects.toThrow('connection lost');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('passes source_inference_id from trace to upsert payload', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse({
      trace: { ...DEFAULT_TRACE, source_inference_id: 'inf-custom-123', attempts: [] }
    });
    await recordAiInvocation(context, response);

    const create = getCreatePayload(upsert);
    expect(create?.source_inference_id).toBe('inf-custom-123');
  });

  it('overrides source_inference_id from options', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse({
      trace: { ...DEFAULT_TRACE, source_inference_id: 'inf-trace', attempts: [] }
    });
    await recordAiInvocation(context, response, { sourceInferenceId: 'inf-option' });

    const create = getCreatePayload(upsert);
    expect(create?.source_inference_id).toBe('inf-option');
  });

  it('does not crash when trace is undefined', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const minimal = createCompletedResponse();
    const response: ModelGatewayResponse = { ...minimal, trace: undefined as unknown as undefined };
    await recordAiInvocation(context, response);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('includes task metadata in upsert payload', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert });
    const response = createCompletedResponse();
    await recordAiInvocation(context, response);

    const create = getCreatePayload(upsert);
    expect(create?.task_id).toBe('task-agent-decision');
    expect(create?.task_type).toBe('agent_decision');
    expect(create?.provider).toBe('mock');
    expect(create?.model).toBe('mock-default');
    expect(create?.status).toBe('completed');
    expect(create?.fallback_used).toBe(false);
  });

  it('uses the current simulation tick', async () => {
    const upsert = vi.fn<UpsertFn>();
    const context = createMockAppContext({ upsert, tick: 9999n });
    const response = createCompletedResponse();
    await recordAiInvocation(context, response);

    const create = getCreatePayload(upsert);
    expect(create?.created_at).toBe(9999n);
    expect(create?.completed_at).toBe(9999n);
  });
});
