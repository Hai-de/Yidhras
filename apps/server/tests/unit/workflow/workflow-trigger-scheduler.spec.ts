import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import type { PackRuntimePort } from '../../../src/app/services/pack/pack_runtime_ports.js';
import {
  triggerEventWorkflows,
  triggerManualWorkflow,
  type WorkflowTriggerEngine
} from '../../../src/app/services/workflow/workflow_trigger_scheduler.js';

const createPackRuntime = (): PackRuntimePort => ({
  getPackId: () => 'trigger-pack',
  getCurrentTick: () => 200n,
  getCurrentRevision: () => 200n,
  getPack: () => ({
    schema_version: 1,
    metadata: {
      id: 'trigger-pack',
      name: 'Trigger Pack',
      version: '0.0.0'
    },
    workflows: {
      on_incident: {
        trigger: { type: 'event', event_types: ['incident'] },
        max_ticks: 10,
        steps: [
          {
            id: 'respond',
            agent: 'agent-respond',
            inference: { provider: 'behavior_tree', behavior_tree: 'respond_tree' }
          }
        ]
      },
      manual_review: {
        trigger: { type: 'manual' },
        max_ticks: 10,
        steps: [
          {
            id: 'review',
            agent: 'agent-review',
            inference: { provider: 'behavior_tree', behavior_tree: 'review_tree' }
          }
        ]
      }
    }
  }) as unknown as ReturnType<PackRuntimePort['getPack']>,
  resolvePackVariables: template => template,
  getStepTicks: () => 1n,
  getStepStrategy: () => ({ kind: 'variable', range: { min: 1n, max: 1n }, loopIntervalMs: 1000 }),
  setStepStrategy: () => undefined,
  getEffectiveStepTicks: () => 1n,
  getLoopIntervalMs: () => 1000,
  getRuntimeSpeedSnapshot: () => ({
    mode: 'variable',
    source: 'default',
    strategy: { kind: 'variable', range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
    effective_step_ticks: '1',
    override_since: null
  }),
  clearRuntimeSpeedOverride: () => undefined,
  getAllTimes: () => [],
  step: () => undefined,
  getPackSlotDeclarations: () => null,
  applyClockProjection: () => undefined
});

const createEngine = () => {
  const triggerWorkflow = vi.fn(async input => ({
    id: `run-${input.workflow_name}-${input.trigger_ref ?? 'manual'}`,
    workflow_name: input.workflow_name,
    pack_id: 'trigger-pack',
    status: 'pending' as const,
    created_tick: input.trigger_tick,
    last_advance_tick: input.trigger_tick,
    max_ticks: 10,
    trigger_type: input.trigger_type,
    trigger_ref: input.trigger_ref,
    lock_worker_id: null,
    lock_expires_at: null,
    idempotency_key: 'test-key'
  }));
  return { triggerWorkflow } satisfies WorkflowTriggerEngine;
};

describe('workflow trigger scheduler', () => {
  it('triggers matching event workflows for the current pack only', async () => {
    const context = {
      prisma: {
        event: {
          findMany: vi.fn(async () => [
            {
              id: 'event-1',
              type: 'incident',
              tick: 120n,
              pack_id: 'trigger-pack',
              impact_data: null
            },
            {
              id: 'event-2',
              type: 'incident',
              tick: 121n,
              pack_id: 'other-pack',
              impact_data: null
            }
          ])
        }
      }
    } as unknown as AppContext;
    const engine = createEngine();

    const result = await triggerEventWorkflows({
      context,
      packRuntime: createPackRuntime(),
      sinceTick: 100n,
      untilTick: 200n,
      engine
    });

    expect(result).toEqual({
      matched_event_count: 1,
      triggered_run_count: 1,
      workflow_names: ['on_incident']
    });
    expect(engine.triggerWorkflow).toHaveBeenCalledTimes(1);
    expect(engine.triggerWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      workflow_name: 'on_incident',
      trigger_type: 'event',
      trigger_ref: 'event-1',
      trigger_tick: 120n
    }));
  });

  it('triggers manual workflows through the shared workflow trigger engine', async () => {
    const context = {} as AppContext;
    const engine = createEngine();

    const run = await triggerManualWorkflow({
      context,
      packRuntime: createPackRuntime(),
      workflow_name: 'manual_review',
      trigger_ref: 'operator-click',
      trigger_tick: 300n,
      engine
    });

    expect(run.workflow_name).toBe('manual_review');
    expect(engine.triggerWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      workflow_name: 'manual_review',
      trigger_type: 'manual',
      trigger_ref: 'operator-click',
      trigger_tick: 300n
    }));
  });
});
