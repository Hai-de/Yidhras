import type { DataContext } from '../../context.js';
import type { PackRuntimePort } from '../pack/pack_runtime_ports.js';
import { createWorkflowEngine } from './workflow_engine.js';
import type { WorkflowRunRecord } from './workflow_types.js';

export interface WorkflowTriggerEngine {
  triggerWorkflow(input: {
    context: DataContext;
    packRuntime: PackRuntimePort;
    workflow_name: string;
    trigger_type: 'manual' | 'event';
    trigger_ref: string | null;
    trigger_tick: bigint;
  }): Promise<WorkflowRunRecord>;
}

export interface TriggerEventWorkflowsResult {
  matched_event_count: number;
  triggered_run_count: number;
  workflow_names: string[];
}

const parseImpactData = (value: string | null): Record<string, unknown> | null => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const resolveEventPackId = (event: { pack_id: string | null; impact_data: string | null }): string | null => {
  if (event.pack_id) {
    return event.pack_id;
  }
  const impactData = parseImpactData(event.impact_data);
  return typeof impactData?.['pack_id'] === 'string' && impactData['pack_id'].trim().length > 0
    ? impactData['pack_id'].trim()
    : null;
};

export const triggerManualWorkflow = async (input: {
  context: DataContext;
  packRuntime: PackRuntimePort;
  workflow_name: string;
  trigger_ref?: string | null;
  trigger_tick?: bigint;
  engine?: WorkflowTriggerEngine;
}): Promise<WorkflowRunRecord> => {
  const engine = input.engine ?? createWorkflowEngine();
  return engine.triggerWorkflow({
    context: input.context,
    packRuntime: input.packRuntime,
    workflow_name: input.workflow_name,
    trigger_type: 'manual',
    trigger_ref: input.trigger_ref ?? null,
    trigger_tick: input.trigger_tick ?? input.packRuntime.getCurrentTick()
  });
};

export const triggerEventWorkflows = async (input: {
  context: DataContext;
  packRuntime: PackRuntimePort;
  sinceTick: bigint;
  untilTick: bigint;
  engine?: WorkflowTriggerEngine;
}): Promise<TriggerEventWorkflowsResult> => {
  const pack = input.packRuntime.getPack();
  const packId = pack.metadata.id;
  const eventWorkflows = Object.entries(pack.workflows ?? {})
    .filter((entry): entry is [string, NonNullable<typeof pack.workflows>[string] & { trigger: { type: 'event'; event_types: string[] } }] => {
      const [, workflow] = entry;
      return workflow.trigger.type === 'event';
    });

  if (eventWorkflows.length === 0) {
    return {
      matched_event_count: 0,
      triggered_run_count: 0,
      workflow_names: []
    };
  }

  const eventTypes = Array.from(new Set(eventWorkflows.flatMap(([, workflow]) => workflow.trigger.event_types)));
  const events = await input.context.prisma.event.findMany({
    where: {
      type: { in: eventTypes },
      created_at: {
        gte: input.sinceTick,
        lte: input.untilTick
      }
    },
    select: {
      id: true,
      type: true,
      tick: true,
      pack_id: true,
      impact_data: true
    },
    orderBy: {
      created_at: 'asc'
    }
  });

  const engine = input.engine ?? createWorkflowEngine();
  const triggeredWorkflowNames = new Set<string>();
  let matchedEventCount = 0;
  let triggeredRunCount = 0;

  for (const event of events) {
    if (resolveEventPackId(event) !== packId) {
      continue;
    }
    matchedEventCount += 1;

    for (const [workflowName, workflow] of eventWorkflows) {
      if (!workflow.trigger.event_types.includes(event.type)) {
        continue;
      }
      await engine.triggerWorkflow({
        context: input.context,
        packRuntime: input.packRuntime,
        workflow_name: workflowName,
        trigger_type: 'event',
        trigger_ref: event.id,
        trigger_tick: event.tick
      });
      triggeredRunCount += 1;
      triggeredWorkflowNames.add(workflowName);
    }
  }

  return {
    matched_event_count: matchedEventCount,
    triggered_run_count: triggeredRunCount,
    workflow_names: Array.from(triggeredWorkflowNames)
  };
};
