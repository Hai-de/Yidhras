import { describe, expect, it, vi } from 'vitest';

import { triggerManualWorkflow, triggerEventWorkflows } from '../../../src/app/services/workflow/workflow_trigger_scheduler.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

const makePackRuntime = (workflows: Record<string, unknown> = {}) => ({
  getPack: () => ({
    metadata: { id: 'test-pack' },
    workflows
  }),
  getPackId: () => 'test-pack',
  getCurrentTick: () => 100n,
  getCurrentRevision: () => 100n,
  getStepTicks: () => 1n,
  resolvePackVariables: (s: string) => s,
  getRuntimeSpeedSnapshot: () => ({
    mode: 'variable' as const,
    source: 'default' as const,
    strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
    effective_step_ticks: '1',
    override_since: null
  }),
  setRuntimeSpeedOverride: () => {},
  clearRuntimeSpeedOverride: () => {},
  getAllTimes: () => ({ current_tick: 100n }),
  step: async () => {},
  getPackSlotDeclarations: () => null,
  applyClockProjection: () => {}
});

const sampleWorkflow = {
  trigger: { type: 'event', event_types: ['combat_end', 'quest_complete'] },
  max_ticks: 100,
  steps: [
    { id: 'step-a', agent: 'agent-1', inference: { provider: 'behavior_tree', behavior_tree: 'tree_a' } }
  ]
};

describe('triggerManualWorkflow', () => {
  it('calls engine.triggerWorkflow with correct params', async () => {
    const ctx = createMockAppContext();
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1', workflow_name: 'approval' })
    };
    const packRuntime = makePackRuntime({ approval: sampleWorkflow });

    const result = await triggerManualWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'approval',
      trigger_ref: 'ref-1',
      trigger_tick: 50n,
      engine: mockEngine as never
    });

    expect(result.id).toBe('run-1');
    expect(mockEngine.triggerWorkflow).toHaveBeenCalledWith({
      context: ctx,
      packRuntime,
      workflow_name: 'approval',
      trigger_type: 'manual',
      trigger_ref: 'ref-1',
      trigger_tick: 50n
    });
  });

  it('defaults trigger_ref to null when not provided', async () => {
    const ctx = createMockAppContext();
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const packRuntime = makePackRuntime({ w: sampleWorkflow });

    await triggerManualWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'w',
      engine: mockEngine as never
    });

    expect(mockEngine.triggerWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_ref: null })
    );
  });

  it('defaults trigger_tick to packRuntime.getCurrentTick()', async () => {
    const ctx = createMockAppContext();
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const packRuntime = makePackRuntime({ w: sampleWorkflow });

    await triggerManualWorkflow({
      context: ctx as never,
      packRuntime: packRuntime as never,
      workflow_name: 'w',
      engine: mockEngine as never
    });

    expect(mockEngine.triggerWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_tick: 100n })
    );
  });
});

describe('triggerEventWorkflows', () => {
  it('returns empty result when no event workflows defined', async () => {
    const ctx = createMockAppContext();
    const packRuntime = makePackRuntime({
      manual_wf: { trigger: { type: 'manual' }, steps: [] }
    });

    const result = await triggerEventWorkflows({
      context: ctx as never,
      packRuntime: packRuntime as never,
      sinceTick: 1n,
      untilTick: 100n
    });

    expect(result.matched_event_count).toBe(0);
    expect(result.triggered_run_count).toBe(0);
    expect(result.workflow_names).toEqual([]);
  });

  it('triggers event workflows matching event types', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.event.findMany = vi.fn().mockResolvedValue([
      { id: 'evt-1', type: 'combat_end', tick: 50n, pack_id: 'test-pack', impact_data: null }
    ]);
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const packRuntime = makePackRuntime({ combat_handler: sampleWorkflow });

    const result = await triggerEventWorkflows({
      context: ctx as never,
      packRuntime: packRuntime as never,
      sinceTick: 1n,
      untilTick: 100n,
      engine: mockEngine as never
    });

    expect(result.matched_event_count).toBe(1);
    expect(result.triggered_run_count).toBe(1);
    expect(result.workflow_names).toEqual(['combat_handler']);
    expect(mockEngine.triggerWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_name: 'combat_handler',
        trigger_type: 'event',
        trigger_ref: 'evt-1',
        trigger_tick: 50n
      })
    );
  });

  it('skips events with non-matching pack_id', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.event.findMany = vi.fn().mockResolvedValue([
      { id: 'evt-1', type: 'combat_end', tick: 50n, pack_id: 'other-pack', impact_data: null }
    ]);
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const packRuntime = makePackRuntime({ combat_handler: sampleWorkflow });

    const result = await triggerEventWorkflows({
      context: ctx as never,
      packRuntime: packRuntime as never,
      sinceTick: 1n,
      untilTick: 100n,
      engine: mockEngine as never
    });

    expect(result.matched_event_count).toBe(0);
    expect(result.triggered_run_count).toBe(0);
  });

  it('skips workflows whose event_types do not match', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.event.findMany = vi.fn().mockResolvedValue([
      { id: 'evt-1', type: 'treasure_found', tick: 50n, pack_id: 'test-pack', impact_data: null }
    ]);
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const packRuntime = makePackRuntime({ combat_handler: sampleWorkflow });

    const result = await triggerEventWorkflows({
      context: ctx as never,
      packRuntime: packRuntime as never,
      sinceTick: 1n,
      untilTick: 100n,
      engine: mockEngine as never
    });

    expect(result.matched_event_count).toBe(1);
    expect(result.triggered_run_count).toBe(0);
  });

  it('triggers multiple workflows from same event', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.event.findMany = vi.fn().mockResolvedValue([
      { id: 'evt-1', type: 'combat_end', tick: 50n, pack_id: 'test-pack', impact_data: null }
    ]);
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const workflow1 = { ...sampleWorkflow };
    const workflow2 = { trigger: { type: 'event', event_types: ['combat_end'] }, steps: [] };
    const packRuntime = makePackRuntime({ handler1: workflow1, handler2: workflow2 });

    const result = await triggerEventWorkflows({
      context: ctx as never,
      packRuntime: packRuntime as never,
      sinceTick: 1n,
      untilTick: 100n,
      engine: mockEngine as never
    });

    expect(result.triggered_run_count).toBe(2);
    expect(result.workflow_names).toContain('handler1');
    expect(result.workflow_names).toContain('handler2');
  });

  it('resolves pack_id from impact_data when event.pack_id is null', async () => {
    const ctx = createMockAppContext();
    ctx.prisma.event.findMany = vi.fn().mockResolvedValue([
      { id: 'evt-1', type: 'combat_end', tick: 50n, pack_id: null, impact_data: JSON.stringify({ pack_id: 'test-pack' }) }
    ]);
    const mockEngine = {
      triggerWorkflow: vi.fn().mockResolvedValue({ id: 'run-1' })
    };
    const packRuntime = makePackRuntime({ combat_handler: sampleWorkflow });

    const result = await triggerEventWorkflows({
      context: ctx as never,
      packRuntime: packRuntime as never,
      sinceTick: 1n,
      untilTick: 100n,
      engine: mockEngine as never
    });

    expect(result.matched_event_count).toBe(1);
    expect(result.triggered_run_count).toBe(1);
  });
});
