import type { InferenceRequestInput } from '../../inference/types.js';
import type { AppContext } from '../context.js';
import { normalizeStoredRequestInput } from '../services/inference_workflow/parsers.js';
import { isRecord } from '../services/inference_workflow/types.js';

const ACTIVE_DECISION_JOB_STATUSES = ['pending', 'running'] as const;
const ACTIVE_ACTION_INTENT_STATUSES = ['pending', 'dispatching'] as const;

const resolveActionIntentActorId = (actorRef: unknown): string | null => {
  if (!isRecord(actorRef)) {
    return null;
  }

  return typeof actorRef.agent_id === 'string' && actorRef.agent_id.length > 0 ? actorRef.agent_id : null;
};

const resolveRequestInputAgentId = (requestInput: unknown): string | null => {
  const normalized = normalizeStoredRequestInput(requestInput as InferenceRequestInput);
  return typeof normalized.agent_id === 'string' && normalized.agent_id.length > 0 ? normalized.agent_id : null;
};

export const listActiveWorkflowActors = async (
  context: AppContext,
  actorIds: string[],
  options?: {
    excludeDecisionJobIds?: string[];
    excludeActionIntentIds?: string[];
  }
): Promise<Set<string>> => {
  if (actorIds.length === 0) {
    return new Set();
  }

  const actorIdSet = new Set(actorIds);
  const excludedDecisionJobIds = options?.excludeDecisionJobIds ?? [];
  const excludedActionIntentIds = options?.excludeActionIntentIds ?? [];
  const [jobs, intents] = await Promise.all([
    context.prisma.decisionJob.findMany({
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
    context.prisma.actionIntent.findMany({
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

  return activeActorIds;
};

export const hasActiveWorkflowForActor = async (
  context: AppContext,
  actorId: string,
  options?: {
    excludeDecisionJobIds?: string[];
    excludeActionIntentIds?: string[];
  }
): Promise<boolean> => {
  const activeActorIds = await listActiveWorkflowActors(context, [actorId], options);
  return activeActorIds.has(actorId);
};
