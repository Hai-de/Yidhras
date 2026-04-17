import { Prisma } from '@prisma/client';

import type {
  InferenceActionIntentSnapshot,
  InferenceJobIntentClass,
  InferenceRequestInput,
  WorkflowSnapshot
} from '../../../inference/types.js';
import { ApiError } from '../../../utils/api_error.js';
import type { AppContext } from '../../context.js';
import { toJsonSafe } from '../../http/json.js';
import {
  ensureNonEmptyId,
  type ListInferenceJobsInput,
  normalizeStoredRequestInput,
  parseInferenceJobsFilters
} from './parsers.js';
import { buildWorkflowSnapshot } from './snapshots.js';
import type {
  ActionIntentRecord,
  DecisionJobRecord,
  InferenceRequestInput as StoredInferenceRequestInput,
  InferenceTraceRecord,
  ParsedInferenceJobsFilters
} from './types.js';
import {
  hasMaterializedInferenceTrace,
  INFERENCE_JOB_STATUSES,
  normalizeJobIntentClass,
  normalizeJobStatus,
  toTickString
} from './types.js';
import { getDecisionJobById } from './workflow_job_repository.js';

export interface InferenceJobListItem {
  id: string;
  source_inference_id: string | null;
  action_intent_id: string | null;
  job_type: string;
  status: ReturnType<typeof normalizeJobStatus>;
  attempt_count: number;
  max_attempts: number;
  idempotency_key: string | null;
  last_error: string | null;
  intent_class: InferenceJobIntentClass;
  last_error_code: string | null;
  last_error_stage: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  started_at: string | null;
  next_retry_at: string | null;
  strategy: string | null;
  actor_ref: Record<string, unknown> | null;
  target_ref: Record<string, unknown> | null;
  pending_source_key: string | null;
  request_input: StoredInferenceRequestInput | null;
  workflow: {
    intent_type: string | null;
    intent_status: InferenceActionIntentSnapshot['status'] | null;
    decision_stage: WorkflowSnapshot['derived']['decision_stage'];
    dispatch_stage: WorkflowSnapshot['derived']['dispatch_stage'];
    workflow_state: WorkflowSnapshot['derived']['workflow_state'];
    failure_stage: WorkflowSnapshot['derived']['failure_stage'];
    failure_code: WorkflowSnapshot['derived']['failure_code'];
    failure_reason: WorkflowSnapshot['derived']['failure_reason'];
    outcome_summary: WorkflowSnapshot['derived']['outcome_summary'];
  };
}

export interface InferenceJobsListSnapshot {
  items: InferenceJobListItem[];
  page_info: {
    has_next_page: boolean;
    next_cursor: string | null;
  };
  summary: {
    returned: number;
    limit: number;
    counts_by_status: Record<'pending' | 'running' | 'completed' | 'failed', number>;
    filters: {
      status: ReturnType<typeof normalizeJobStatus>[] | null;
      agent_id: string | null;
      identity_id: string | null;
      strategy: string | null;
      job_type: string | null;
      from_created_at: string | null;
      to_created_at: string | null;
      from_tick: string | null;
      to_tick: string | null;
      has_error: boolean | null;
      action_intent_id: string | null;
      cursor: string | null;
    };
  };
}

const encodeInferenceJobsCursor = (item: Pick<InferenceJobListItem, 'created_at' | 'id'>): string => {
  return Buffer.from(
    JSON.stringify({
      created_at: item.created_at,
      id: item.id
    }),
    'utf8'
  ).toString('base64url');
};

const compareInferenceJobsCursorPosition = (
  left: { created_at: string; id: string },
  right: { created_at: string; id: string }
): number => {
  const leftTick = BigInt(left.created_at);
  const rightTick = BigInt(right.created_at);

  if (leftTick === rightTick) {
    return right.id.localeCompare(left.id);
  }

  return leftTick > rightTick ? -1 : 1;
};

const buildInferenceJobsWhere = (filters: ParsedInferenceJobsFilters): Prisma.DecisionJobWhereInput => {
  return {
    ...(filters.status ? { status: { in: filters.status } } : {}),
    ...(filters.job_type ? { job_type: filters.job_type } : {}),
    ...(filters.action_intent_id ? { action_intent_id: filters.action_intent_id } : {}),
    ...(filters.has_error === null ? {} : filters.has_error ? { last_error: { not: null } } : { last_error: null }),
    ...(filters.from_created_at !== null || filters.to_created_at !== null
      ? {
          created_at: {
            ...(filters.from_created_at !== null ? { gte: filters.from_created_at } : {}),
            ...(filters.to_created_at !== null ? { lte: filters.to_created_at } : {})
          }
        }
      : {})
  };
};

const shouldFetchAllInferenceJobs = (filters: ParsedInferenceJobsFilters): boolean => {
  return filters.agent_id !== null || filters.identity_id !== null || filters.strategy !== null || filters.cursor !== null;
};

const getSafeRequestInput = (job: DecisionJobRecord): InferenceRequestInput | null => {
  if (job.request_input === null) {
    return null;
  }

  try {
    return normalizeStoredRequestInput(job.request_input);
  } catch {
    return null;
  }
};

interface WorkflowSnapshotBundle {
  traceByInferenceId: Map<string, InferenceTraceRecord>;
  intentById: Map<string, ActionIntentRecord>;
  intentByInferenceId: Map<string, ActionIntentRecord>;
  replayParentJobById: Map<string, DecisionJobRecord>;
  replayChildJobsByParentId: Map<string, DecisionJobRecord[]>;
}

const safeFindInferenceTraceById = async (
  context: AppContext,
  id: string
): Promise<InferenceTraceRecord | null> => {
  try {
    return await context.prisma.inferenceTrace.findUnique({ where: { id } });
  } catch {
    return null;
  }
};

const safeFindActionIntentById = async (
  context: AppContext,
  id: string
): Promise<ActionIntentRecord | null> => {
  try {
    return await context.prisma.actionIntent.findUnique({ where: { id } });
  } catch {
    return null;
  }
};

const safeFindActionIntentByInferenceId = async (
  context: AppContext,
  sourceInferenceId: string
): Promise<ActionIntentRecord | null> => {
  try {
    return await context.prisma.actionIntent.findUnique({ where: { source_inference_id: sourceInferenceId } });
  } catch {
    return null;
  }
};

const safeFindDecisionJobById = async (context: AppContext, id: string): Promise<DecisionJobRecord | null> => {
  try {
    return await context.prisma.decisionJob.findUnique({ where: { id } });
  } catch {
    return null;
  }
};

const safeListReplayChildrenByParentId = async (context: AppContext, jobId: string): Promise<DecisionJobRecord[]> => {
  try {
    return await context.prisma.decisionJob.findMany({ where: { replay_of_job_id: jobId }, orderBy: { created_at: 'asc' } });
  } catch {
    return [];
  }
};

const buildWorkflowSnapshotBundleForJobs = async (
  context: AppContext,
  jobs: DecisionJobRecord[]
): Promise<WorkflowSnapshotBundle> => {
  const inferenceIds = Array.from(
    new Set(
      jobs
        .filter(hasMaterializedInferenceTrace)
        .map(job => job.source_inference_id)
        .filter((value): value is string => typeof value === 'string')
    )
  );
  const intentIds = Array.from(
    new Set(jobs.map(job => job.action_intent_id).filter((value): value is string => typeof value === 'string'))
  );
  const replayParentIds = Array.from(
    new Set(jobs.map(job => job.replay_of_job_id).filter((value): value is string => typeof value === 'string'))
  );
  const jobIds = jobs.map(job => job.id);

  const [traces, intentsById, intentsByInferenceId, replayParents, replayChildGroups] = await Promise.all([
    inferenceIds.length > 0
      ? Promise.all(
          inferenceIds.map(id => safeFindInferenceTraceById(context, id))
        )
      : Promise.resolve([]),
    intentIds.length > 0
      ? Promise.all(
          intentIds.map(id => safeFindActionIntentById(context, id))
        )
      : Promise.resolve([]),
    inferenceIds.length > 0
      ? Promise.all(
          inferenceIds.map(sourceInferenceId => safeFindActionIntentByInferenceId(context, sourceInferenceId))
        )
      : Promise.resolve([]),
    replayParentIds.length > 0
      ? Promise.all(replayParentIds.map(id => safeFindDecisionJobById(context, id)))
      : Promise.resolve([]),
    jobIds.length > 0
      ? Promise.all(jobIds.map(jobId => safeListReplayChildrenByParentId(context, jobId)))
      : Promise.resolve([])
  ]);

  const resolvedTraces = traces.filter((trace): trace is InferenceTraceRecord => trace !== null);
  const resolvedIntentsById = intentsById.filter((intent): intent is ActionIntentRecord => intent !== null);
  const resolvedIntentsByInferenceId = intentsByInferenceId.filter((intent): intent is ActionIntentRecord => intent !== null);
  const resolvedReplayParents = replayParents.filter((job): job is DecisionJobRecord => job !== null);
  const replayChildren = replayChildGroups.flat();

  const intents = Array.from(
    new Map(
      [...resolvedIntentsById, ...resolvedIntentsByInferenceId].map(intent => [intent.id, intent])
    ).values()
  );

  const replayChildJobsByParentId = new Map<string, DecisionJobRecord[]>();
  for (const childJob of replayChildren) {
    if (!childJob.replay_of_job_id) {
      continue;
    }

    const existing = replayChildJobsByParentId.get(childJob.replay_of_job_id) ?? [];
    existing.push(childJob);
    replayChildJobsByParentId.set(childJob.replay_of_job_id, existing);
  }

  return {
    traceByInferenceId: new Map(resolvedTraces.map(trace => [trace.id, trace])),
    intentById: new Map(intents.map(intent => [intent.id, intent])),
    intentByInferenceId: new Map(intents.map(intent => [intent.source_inference_id, intent])),
    replayParentJobById: new Map(resolvedReplayParents.map(job => [job.id, job])),
    replayChildJobsByParentId
  };
};

const buildWorkflowSnapshotFromBundle = (job: DecisionJobRecord, bundle: WorkflowSnapshotBundle): WorkflowSnapshot => {
  const inferenceId = hasMaterializedInferenceTrace(job) && typeof job.source_inference_id === 'string'
    ? job.source_inference_id
    : null;
  const trace = inferenceId ? bundle.traceByInferenceId.get(inferenceId) ?? null : null;
  const intent = typeof job.action_intent_id === 'string'
    ? bundle.intentById.get(job.action_intent_id) ?? (inferenceId ? bundle.intentByInferenceId.get(inferenceId) ?? null : null)
    : (inferenceId ? bundle.intentByInferenceId.get(inferenceId) ?? null : null);
  const replayParentJob = typeof job.replay_of_job_id === 'string' ? bundle.replayParentJobById.get(job.replay_of_job_id) ?? null : null;

  return buildWorkflowSnapshot({
    trace,
    job,
    intent,
    replayParentJob,
    replayChildJobs: bundle.replayChildJobsByParentId.get(job.id) ?? []
  });
};

const resolveInferenceJobActorRef = (
  workflowSnapshot: WorkflowSnapshot,
  requestInput: InferenceRequestInput | null
): Record<string, unknown> | null => {
  const actorRef = workflowSnapshot.records.intent?.actor_ref ?? workflowSnapshot.records.trace?.actor_ref ?? null;
  if (actorRef) {
    return actorRef;
  }

  const fallback: Record<string, unknown> = {};
  if (typeof requestInput?.agent_id === 'string') {
    fallback.agent_id = requestInput.agent_id;
  }
  if (typeof requestInput?.identity_id === 'string') {
    fallback.identity_id = requestInput.identity_id;
  }

  return Object.keys(fallback).length > 0 ? fallback : null;
};

const matchesInferenceJobFilters = (
  filters: ParsedInferenceJobsFilters,
  workflowSnapshot: WorkflowSnapshot,
  requestInput: InferenceRequestInput | null
): boolean => {
  const actorRef = resolveInferenceJobActorRef(workflowSnapshot, requestInput);
  const actorAgentId = actorRef && typeof actorRef.agent_id === 'string' ? actorRef.agent_id : requestInput?.agent_id ?? null;
  const actorIdentityId =
    actorRef && typeof actorRef.identity_id === 'string' ? actorRef.identity_id : requestInput?.identity_id ?? null;
  const strategy = workflowSnapshot.records.trace?.strategy ?? requestInput?.strategy ?? null;

  if (filters.agent_id !== null && actorAgentId !== filters.agent_id) {
    return false;
  }

  if (filters.identity_id !== null && actorIdentityId !== filters.identity_id) {
    return false;
  }

  if (filters.strategy !== null && strategy !== filters.strategy) {
    return false;
  }

  return true;
};

const buildInferenceJobListItem = (
  job: DecisionJobRecord,
  workflowSnapshot: WorkflowSnapshot,
  requestInput: InferenceRequestInput | null
): InferenceJobListItem => {
  return {
    id: job.id,
    source_inference_id: hasMaterializedInferenceTrace(job) ? job.source_inference_id : null,
    pending_source_key: job.pending_source_key,
    action_intent_id: job.action_intent_id,
    job_type: job.job_type,
    status: normalizeJobStatus(job.status),
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    idempotency_key: job.idempotency_key,
    last_error: job.last_error,
    intent_class: normalizeJobIntentClass(job.intent_class),
    last_error_code: job.last_error_code,
    last_error_stage: job.last_error_stage,
    created_at: job.created_at.toString(),
    updated_at: job.updated_at.toString(),
    completed_at: toTickString(job.completed_at),
    started_at: toTickString(job.started_at),
    next_retry_at: toTickString(job.next_retry_at),
    strategy: workflowSnapshot.records.trace?.strategy ?? requestInput?.strategy ?? null,
    actor_ref: resolveInferenceJobActorRef(workflowSnapshot, requestInput),
    target_ref: workflowSnapshot.records.intent?.target_ref ?? null,
    request_input: requestInput ? (toJsonSafe(requestInput) as StoredInferenceRequestInput) : null,
    workflow: {
      intent_type: workflowSnapshot.records.intent?.intent_type ?? null,
      intent_status: workflowSnapshot.records.intent?.status ?? null,
      decision_stage: workflowSnapshot.derived.decision_stage,
      dispatch_stage: workflowSnapshot.derived.dispatch_stage,
      workflow_state: workflowSnapshot.derived.workflow_state,
      failure_stage: workflowSnapshot.derived.failure_stage,
      failure_code: workflowSnapshot.derived.failure_code,
      failure_reason: workflowSnapshot.derived.failure_reason,
      outcome_summary: workflowSnapshot.derived.outcome_summary
    }
  };
};

const matchesInferenceJobsCursor = (cursor: ParsedInferenceJobsFilters['cursor'], item: InferenceJobListItem): boolean => {
  if (!cursor) {
    return true;
  }

  return compareInferenceJobsCursorPosition({ created_at: item.created_at, id: item.id }, cursor) > 0;
};

export const listInferenceJobs = async (
  context: AppContext,
  input: ListInferenceJobsInput
): Promise<InferenceJobsListSnapshot> => {
  const filters = parseInferenceJobsFilters(input);
  const jobs = await context.prisma.decisionJob.findMany({
    ...(shouldFetchAllInferenceJobs(filters)
      ? {}
      : {
          take: filters.limit + 1
        }),
    where: buildInferenceJobsWhere(filters),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
  });
  const workflowSnapshotBundle = await buildWorkflowSnapshotBundleForJobs(context, jobs);

  const filteredItems: InferenceJobListItem[] = [];
  for (const job of jobs) {
    const requestInput = getSafeRequestInput(job);
    const workflowSnapshot = buildWorkflowSnapshotFromBundle(job, workflowSnapshotBundle);
    if (!matchesInferenceJobFilters(filters, workflowSnapshot, requestInput)) {
      continue;
    }

    filteredItems.push(buildInferenceJobListItem(job, workflowSnapshot, requestInput));
  }

  const cursorFilteredItems = filteredItems.filter(item => matchesInferenceJobsCursor(filters.cursor, item));
  const hasNextPage = cursorFilteredItems.length > filters.limit;
  const pageItems = hasNextPage ? cursorFilteredItems.slice(0, filters.limit) : cursorFilteredItems;
  const countsByStatus: Record<(typeof INFERENCE_JOB_STATUSES)[number], number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0
  };

  for (const item of pageItems) {
    countsByStatus[item.status as (typeof INFERENCE_JOB_STATUSES)[number]] += 1;
  }

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: hasNextPage ? encodeInferenceJobsCursor(pageItems[pageItems.length - 1]) : null
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      counts_by_status: countsByStatus,
      filters: {
        status: filters.status,
        agent_id: filters.agent_id,
        identity_id: filters.identity_id,
        strategy: filters.strategy,
        job_type: filters.job_type,
        from_created_at: filters.from_created_at?.toString() ?? null,
        to_created_at: filters.to_created_at?.toString() ?? null,
        from_tick: filters.from_created_at?.toString() ?? null,
        to_tick: filters.to_created_at?.toString() ?? null,
        has_error: filters.has_error,
        action_intent_id: filters.action_intent_id,
        cursor: filters.cursor ? Buffer.from(JSON.stringify(filters.cursor), 'utf8').toString('base64url') : null
      }
    }
  };
};

export const getWorkflowSnapshotByInferenceId = async (
  context: AppContext,
  inferenceId?: string
): Promise<WorkflowSnapshot> => {
  const id = ensureNonEmptyId(inferenceId, 'inference_id');
  const [trace, job] = await Promise.all([
    context.prisma.inferenceTrace.findUnique({
      where: { id }
    }),
    context.prisma.decisionJob.findUnique({
      where: { source_inference_id: id }
    })
  ]);

  if (!trace) {
    throw new ApiError(404, 'INFERENCE_TRACE_NOT_FOUND', 'Inference trace not found', {
      inference_id: id
    });
  }

  if (!job) {
    const intent = await context.prisma.actionIntent.findUnique({
      where: { source_inference_id: id }
    });

    return buildWorkflowSnapshot({
      trace,
      job: null,
      intent
    });
  }

  const workflowSnapshotBundle = await buildWorkflowSnapshotBundleForJobs(context, [job]);
  const workflowSnapshot = buildWorkflowSnapshotFromBundle(job, workflowSnapshotBundle);

  if (workflowSnapshot.records.trace) {
    return workflowSnapshot;
  }

  const intent = typeof job.action_intent_id === 'string'
    ? workflowSnapshotBundle.intentById.get(job.action_intent_id) ?? workflowSnapshotBundle.intentByInferenceId.get(id) ?? null
    : workflowSnapshotBundle.intentByInferenceId.get(id) ?? null;

  return buildWorkflowSnapshot({
    trace,
    job,
    intent,
    replayParentJob: typeof job.replay_of_job_id === 'string' ? workflowSnapshotBundle.replayParentJobById.get(job.replay_of_job_id) ?? null : null,
    replayChildJobs: workflowSnapshotBundle.replayChildJobsByParentId.get(job.id) ?? []
  });
};

export const getWorkflowSnapshotByJobId = async (
  context: AppContext,
  jobId?: string
): Promise<WorkflowSnapshot> => {
  const id = ensureNonEmptyId(jobId, 'job_id');
  const job = await getDecisionJobById(context, id);
  const workflowSnapshotBundle = await buildWorkflowSnapshotBundleForJobs(context, [job]);

  return buildWorkflowSnapshotFromBundle(job, workflowSnapshotBundle);
};
