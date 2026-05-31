import type { DataContext } from '../../context.js';
import { normalizeStoredRequestInput } from '../inference_workflow/parsers.js';
import { isRecord } from '../inference_workflow/types.js';

const ACTIVE_DECISION_JOB_STATUSES = ['pending', 'running'] as const;
const ACTIVE_ACTION_INTENT_STATUSES = ['pending', 'dispatching'] as const;

const resolveActionIntentActorId = (actorRef: unknown): string | null => {
  if (!isRecord(actorRef)) {
    return null;
  }

  return typeof actorRef['agent_id'] === 'string' && actorRef['agent_id'].length > 0 ? actorRef['agent_id'] : null;
};

const resolveRequestInputAgentId = (requestInput: unknown): string | null => {
  const normalized = normalizeStoredRequestInput(requestInput);
  return typeof normalized.agent_id === 'string' && normalized.agent_id.length > 0 ? normalized.agent_id : null;
};

export const listActiveWorkflowActors = async (
  context: DataContext,
  actorIds: string[],
  options?: {
    excludeDecisionJobIds?: string[];
    excludeActionIntentIds?: string[];
    excludeWorkflowStepRunIds?: string[];
  }
): Promise<Set<string>> => {
  if (actorIds.length === 0) {
    return new Set();
  }

  const actorIdSet = new Set(actorIds);
  const excludedDecisionJobIds = options?.excludeDecisionJobIds ?? [];
  const excludedActionIntentIds = options?.excludeActionIntentIds ?? [];
  const excludedWorkflowStepRunIds = options?.excludeWorkflowStepRunIds ?? [];
  const [jobs, intents, workflowSteps] = await Promise.all([
    context.repos.inference.findDecisionJobs({
      where: {
        status: {
          in: [...ACTIVE_DECISION_JOB_STATUSES]
        },
        ...(excludedDecisionJobIds.length > 0 ? { id: { notIn: excludedDecisionJobIds } } : {})
      },
      select: {
        id: true,
        request_input: true
      }
    }),
    context.repos.inference.listActionIntents({
      where: {
        status: {
          in: [...ACTIVE_ACTION_INTENT_STATUSES]
        },
        ...(excludedActionIntentIds.length > 0 ? { id: { notIn: excludedActionIntentIds } } : {})
      },
      select: {
        id: true,
        actor_ref: true
      }
    }),
    context.repos.workflowSteps.listRunningSteps({
      agent_ids: actorIds,
      exclude_step_run_ids: excludedWorkflowStepRunIds
    })
  ]);

  const activeActorIds = new Set<string>();

  for (const job of jobs) {
    const actorId = resolveRequestInputAgentId(job.request_input);
    if (actorId && actorIdSet.has(actorId)) {
      activeActorIds.add(actorId);
    }
  }

  for (const intent of intents) {
    const actorId = resolveActionIntentActorId(intent.actor_ref);
    if (actorId && actorIdSet.has(actorId)) {
      activeActorIds.add(actorId);
    }
  }

  for (const workflowStep of workflowSteps) {
    if (actorIdSet.has(workflowStep.agent_id)) {
      activeActorIds.add(workflowStep.agent_id);
    }
  }

  return activeActorIds;
};

export const hasActiveWorkflowForActor = async (
  context: DataContext,
  actorId: string,
  options?: {
    excludeDecisionJobIds?: string[];
    excludeActionIntentIds?: string[];
    excludeWorkflowStepRunIds?: string[];
  }
): Promise<boolean> => {
  const activeActorIds = await listActiveWorkflowActors(context, [actorId], options);
  return activeActorIds.has(actorId);
};
