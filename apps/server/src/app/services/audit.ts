import { auditFeedQuerySchema, auditViewKindSchema } from '@yidhras/contracts';

import type { AppContext } from '../context.js';
import { parseQuery } from '../http/zod.js';
import { getWorkflowSnapshotByJobId, listInferenceJobs } from './inference_workflow.js';

export type AuditEntryKind = 'workflow' | 'post' | 'relationship_adjustment' | 'snr_adjustment' | 'event';

export interface AuditViewEntryRefs {
  [key: string]: string | null | undefined;
}

export interface AuditFeedFilters {
  from_tick: bigint | null;
  to_tick: bigint | null;
  job_id: string | null;
  inference_id: string | null;
  agent_id: string | null;
  action_intent_id: string | null;
  cursor: string | null;
  kinds?: AuditEntryKind[] | null;
}

export interface AuditViewEntry {
  kind: AuditEntryKind;
  id: string;
  created_at: string;
  refs: AuditViewEntryRefs;
  summary: string;
  data: Record<string, unknown>;
}

export interface ListAuditFeedResult {
  entries: AuditViewEntry[];
  page_info: {
    has_next_page: boolean;
    next_cursor: string | null;
  };
}

export interface GetAuditEntryInput {
  kind?: string;
  id?: string;
}

const MAX_AUDIT_FEED_LIMIT = 100;
const DEFAULT_AUDIT_FEED_LIMIT = 20;
const AUDIT_ENTRY_KINDS: AuditEntryKind[] = ['workflow', 'post', 'relationship_adjustment', 'snr_adjustment', 'event'];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const parseAuditEntryKind = (value: string | undefined): AuditEntryKind => {
  const parsed = auditViewKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid audit entry kind');
  }
  return parsed.data as AuditEntryKind;
};

const parseAuditEntryId = (value: string | undefined): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid audit entry id');
  }
  return value.trim();
};

const parseTickLike = (value: string | number | null | undefined): bigint | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Tick value must be a safe integer');
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Tick value must be an integer string');
  }
  return BigInt(trimmed);
};

const parseAuditFeedFilters = (query: Record<string, unknown>): AuditFeedFilters & { limit: number } => {
  const fromTick = parseTickLike((query.from_tick as string | undefined) ?? null);
  const toTick = parseTickLike((query.to_tick as string | undefined) ?? null);
  const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : DEFAULT_AUDIT_FEED_LIMIT;
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_AUDIT_FEED_LIMIT, 1), MAX_AUDIT_FEED_LIMIT);
  const rawKinds = Array.isArray(query.kinds)
    ? query.kinds
    : typeof query.kinds === 'string'
      ? [query.kinds]
      : null;
  const kinds = rawKinds
    ? rawKinds.filter((kind): kind is AuditEntryKind => typeof kind === 'string' && AUDIT_ENTRY_KINDS.includes(kind as AuditEntryKind))
    : null;

  return {
    from_tick: fromTick,
    to_tick: toTick,
    job_id: typeof query.job_id === 'string' ? query.job_id : null,
    inference_id: typeof query.inference_id === 'string' ? query.inference_id : null,
    agent_id: typeof query.agent_id === 'string' ? query.agent_id : null,
    action_intent_id: typeof query.action_intent_id === 'string' ? query.action_intent_id : null,
    cursor: typeof query.cursor === 'string' ? query.cursor : null,
    kinds,
    limit
  };
};

const shouldFetchAllForFilters = (filters: AuditFeedFilters): boolean => {
  return Boolean(filters.from_tick || filters.to_tick || filters.job_id || filters.inference_id || filters.agent_id || filters.action_intent_id || filters.cursor);
};

const buildBigIntRangeWhere = (filters: AuditFeedFilters, field: string) => {
  if (filters.from_tick === null && filters.to_tick === null) {
    return null;
  }
  return {
    [field]: {
      ...(filters.from_tick !== null ? { gte: filters.from_tick } : {}),
      ...(filters.to_tick !== null ? { lte: filters.to_tick } : {})
    }
  };
};

const matchesTickRange = (filters: AuditFeedFilters, value: bigint): boolean => {
  if (filters.from_tick !== null && value < filters.from_tick) {
    return false;
  }
  if (filters.to_tick !== null && value > filters.to_tick) {
    return false;
  }
  return true;
};

const extractAgentIdsFromRefs = (...values: unknown[]): string[] => {
  const ids = new Set<string>();
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    const directAgentId = typeof value.agent_id === 'string' ? value.agent_id : null;
    const directEntityId = typeof value.entity_id === 'string' ? value.entity_id : null;
    const semanticIntent = isRecord(value.semantic_intent) ? value.semantic_intent : null;
    const nestedTargetRef = semanticIntent && isRecord(semanticIntent.target_ref) ? semanticIntent.target_ref : null;
    const nestedAgentId = nestedTargetRef && typeof nestedTargetRef.agent_id === 'string' ? nestedTargetRef.agent_id : null;
    const nestedEntityId = nestedTargetRef && typeof nestedTargetRef.entity_id === 'string' ? nestedTargetRef.entity_id : null;

    for (const candidate of [directAgentId, directEntityId, nestedAgentId, nestedEntityId]) {
      if (candidate && candidate.trim().length > 0) {
        ids.add(candidate.trim());
      }
    }
  }
  return Array.from(ids);
};

const matchesAgentFilter = (filters: AuditFeedFilters, candidateAgentIds: string[]): boolean => {
  if (!filters.agent_id) {
    return true;
  }
  return candidateAgentIds.includes(filters.agent_id);
};

const matchesActionIntentFilter = (filters: AuditFeedFilters, actionIntentIds: Array<string | null | undefined>): boolean => {
  if (!filters.action_intent_id) {
    return true;
  }
  return actionIntentIds.some(id => id === filters.action_intent_id);
};

const parseEventImpactData = (value: string | null): Record<string, unknown> | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return { raw: parsed };
  } catch {
    return { raw: value };
  }
};

const buildPostAuditEntries = async (
  context: AppContext,
  limit: number,
  filters: AuditFeedFilters
): Promise<AuditViewEntry[]> => {
  if (filters.job_id || filters.inference_id) {
    return [];
  }

  const posts = await context.prisma.post.findMany({
    ...(shouldFetchAllForFilters(filters)
      ? {}
      : {
          take: limit
        }),
    where: {
      ...(filters.action_intent_id
        ? {
            source_action_intent_id: filters.action_intent_id
          }
        : {}),
      ...(filters.agent_id
        ? {
            author_id: filters.agent_id
          }
        : {}),
      ...(buildBigIntRangeWhere(filters, 'created_at') ?? {})
    },
    orderBy: { created_at: 'desc' }
  });

  return posts.flatMap(post => {
    if (!matchesTickRange(filters, post.created_at)) {
      return [];
    }

    return [{
      kind: 'post',
      id: post.id,
      created_at: post.created_at.toString(),
      refs: {
        post_id: post.id,
        action_intent_id: post.source_action_intent_id,
        agent_id: post.author_id
      },
      summary: `${post.author_id}: ${post.content}`,
      data: {
        author_id: post.author_id,
        content: post.content,
        source_action_intent_id: post.source_action_intent_id,
        created_at: post.created_at.toString()
      }
    }];
  });
};

const buildRelationshipAdjustmentAuditEntries = async (
  context: AppContext,
  limit: number,
  filters: AuditFeedFilters
): Promise<AuditViewEntry[]> => {
  if (filters.job_id || filters.inference_id) {
    return [];
  }

  const logs = await context.prisma.relationshipAdjustmentLog.findMany({
    ...(shouldFetchAllForFilters(filters)
      ? {}
      : {
          take: limit
        }),
    where: {
      ...(filters.action_intent_id
        ? {
            action_intent_id: filters.action_intent_id
          }
        : {}),
      ...(filters.agent_id
        ? {
            OR: [{ from_id: filters.agent_id }, { to_id: filters.agent_id }]
          }
        : {}),
      ...(buildBigIntRangeWhere(filters, 'created_at') ?? {})
    },
    orderBy: { created_at: 'desc' }
  });

  return logs.flatMap(log => {
    if (!matchesTickRange(filters, log.created_at)) {
      return [];
    }

    return [{
      kind: 'relationship_adjustment',
      id: log.id,
      created_at: log.created_at.toString(),
      refs: {
        relationship_adjustment_id: log.id,
        action_intent_id: log.action_intent_id,
        relationship_id: log.relationship_id,
        from_id: log.from_id,
        to_id: log.to_id
      },
      summary: `${log.from_id} -> ${log.to_id} ${log.type} ${String(log.old_weight)} -> ${String(log.new_weight)}`,
      data: {
        action_intent_id: log.action_intent_id,
        relationship_id: log.relationship_id,
        from_id: log.from_id,
        to_id: log.to_id,
        type: log.type,
        operation: log.operation,
        old_weight: log.old_weight,
        new_weight: log.new_weight,
        reason: log.reason
      }
    }];
  });
};

const buildSnrAdjustmentAuditEntries = async (
  context: AppContext,
  limit: number,
  filters: AuditFeedFilters
): Promise<AuditViewEntry[]> => {
  if (filters.job_id || filters.inference_id) {
    return [];
  }

  const logs = await context.prisma.sNRAdjustmentLog.findMany({
    ...(shouldFetchAllForFilters(filters)
      ? {}
      : {
          take: limit
        }),
    where: {
      ...(filters.action_intent_id
        ? {
            action_intent_id: filters.action_intent_id
          }
        : {}),
      ...(filters.agent_id
        ? {
            agent_id: filters.agent_id
          }
        : {}),
      ...(buildBigIntRangeWhere(filters, 'created_at') ?? {})
    },
    orderBy: { created_at: 'desc' },
    include: {
      agent: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  return logs.flatMap(log => {
    if (!matchesTickRange(filters, log.created_at)) {
      return [];
    }

    return [{
      kind: 'snr_adjustment',
      id: log.id,
      created_at: log.created_at.toString(),
      refs: {
        snr_adjustment_id: log.id,
        action_intent_id: log.action_intent_id,
        agent_id: log.agent_id
      },
      summary: `${log.agent.name} SNR ${String(log.baseline_value)} -> ${String(log.resolved_value)}`,
      data: {
        action_intent_id: log.action_intent_id,
        agent_id: log.agent_id,
        agent_name: log.agent.name,
        operation: log.operation,
        requested_value: log.requested_value,
        baseline_value: log.baseline_value,
        resolved_value: log.resolved_value,
        reason: log.reason
      }
    }];
  });
};

const buildEventAuditEntries = async (
  context: AppContext,
  limit: number,
  filters: AuditFeedFilters
): Promise<AuditViewEntry[]> => {
  if (filters.job_id || filters.inference_id) {
    return [];
  }

  const events = await context.prisma.event.findMany({
    ...(shouldFetchAllForFilters(filters)
      ? {}
      : {
          take: limit
        }),
    where: {
      ...(filters.action_intent_id
        ? {
            source_action_intent_id: filters.action_intent_id
          }
        : {}),
      ...(buildBigIntRangeWhere(filters, 'created_at') ?? {})
    },
    orderBy: { created_at: 'desc' },
    include: {
      source_action_intent: {
        select: {
          actor_ref: true,
          target_ref: true
        }
      }
    }
  });

  return events.flatMap(event => {
    if (!matchesActionIntentFilter(filters, [event.source_action_intent_id])) {
      return [];
    }

    if (!matchesTickRange(filters, event.created_at)) {
      return [];
    }

    const impactData = parseEventImpactData(event.impact_data);
    const candidateAgentIds = extractAgentIdsFromRefs(
      event.source_action_intent?.actor_ref ?? null,
      event.source_action_intent?.target_ref ?? null,
      impactData
    );
    if (!matchesAgentFilter(filters, candidateAgentIds)) {
      return [];
    }

    return [{
      kind: 'event',
      id: event.id,
      created_at: event.created_at.toString(),
      refs: {
        event_id: event.id,
        action_intent_id: event.source_action_intent_id,
        agent_id: candidateAgentIds[0] ?? null
      },
      summary: `${event.type}: ${event.title}`,
      data: {
        title: event.title,
        description: event.description,
        tick: event.tick.toString(),
        type: event.type,
        impact_data: impactData,
        semantic_type: impactData && typeof impactData.semantic_type === 'string' ? impactData.semantic_type : null,
        failed_attempt: impactData?.failed_attempt === true,
        objective_effect_applied:
          typeof impactData?.objective_effect_applied === 'boolean' ? impactData.objective_effect_applied : null,
        grounding_mode: impactData && typeof impactData.grounding_mode === 'string' ? impactData.grounding_mode : null,
        source_action_intent_id: event.source_action_intent_id
      }
    }];
  });
};

const buildWorkflowRelatedRecords = async (
  context: AppContext,
  actionIntentId: string | null
): Promise<{
  posts: AuditViewEntry[];
  relationship_adjustments: AuditViewEntry[];
  snr_adjustments: AuditViewEntry[];
  events: AuditViewEntry[];
}> => {
  if (!actionIntentId) {
    return {
      posts: [],
      relationship_adjustments: [],
      snr_adjustments: [],
      events: []
    };
  }

  const relatedFilters: AuditFeedFilters = {
    from_tick: null,
    to_tick: null,
    job_id: null,
    inference_id: null,
    agent_id: null,
    action_intent_id: actionIntentId,
    cursor: null
  };

  const [posts, relationshipAdjustments, snrAdjustments, events] = await Promise.all([
    buildPostAuditEntries(context, MAX_AUDIT_FEED_LIMIT, relatedFilters),
    buildRelationshipAdjustmentAuditEntries(context, MAX_AUDIT_FEED_LIMIT, relatedFilters),
    buildSnrAdjustmentAuditEntries(context, MAX_AUDIT_FEED_LIMIT, relatedFilters),
    buildEventAuditEntries(context, MAX_AUDIT_FEED_LIMIT, relatedFilters)
  ]);

  return {
    posts,
    relationship_adjustments: relationshipAdjustments,
    snr_adjustments: snrAdjustments,
    events
  };
};

const buildWorkflowAuditEntryBySnapshot = (jobId: string, snapshot: Awaited<ReturnType<typeof getWorkflowSnapshotByJobId>>): AuditViewEntry => {
  const trace = snapshot.records.trace;
  const job = snapshot.records.job;
  const intent = snapshot.records.intent;

  if (!job) {
    throw new Error(`Audit workflow entry not found for job ${jobId}`);
  }

  const traceMetadata = isRecord(trace?.trace_metadata) ? trace.trace_metadata : null;
  const decisionRecord = isRecord(trace?.decision) ? trace.decision : null;
  const intentPayload = isRecord(intent?.payload) ? intent.payload : null;
  const intentGrounding =
    (traceMetadata && isRecord(traceMetadata.intent_grounding) ? traceMetadata.intent_grounding : null) ??
    (decisionRecord && isRecord(decisionRecord.meta) && isRecord((decisionRecord.meta as Record<string, unknown>).intent_grounding)
      ? ((decisionRecord.meta as Record<string, unknown>).intent_grounding as Record<string, unknown>)
      : null) ??
    (intentPayload && isRecord(intentPayload.intent_grounding) ? intentPayload.intent_grounding : null);
  const semanticIntent =
    (traceMetadata && isRecord(traceMetadata.semantic_intent) ? traceMetadata.semantic_intent : null) ??
    (decisionRecord && isRecord(decisionRecord.meta) && isRecord((decisionRecord.meta as Record<string, unknown>).semantic_intent)
      ? ((decisionRecord.meta as Record<string, unknown>).semantic_intent as Record<string, unknown>)
      : null) ??
    (intentPayload && isRecord(intentPayload.semantic_intent) ? intentPayload.semantic_intent : null);

  return {
    kind: 'workflow',
    id: job.id,
    created_at: job.created_at,
    refs: {
      inference_id: trace?.id ?? job.pending_source_key ?? job.source_inference_id ?? null,
      job_id: job.id,
      action_intent_id: intent?.id ?? job.action_intent_id ?? null
    },
    summary: `${intent?.intent_type ?? 'workflow'} -> ${snapshot.derived.workflow_state}`,
    data: {
      source_inference_id: job.source_inference_id ?? null,
      pending_source_key: job.pending_source_key ?? null,
      job_type: job.job_type,
      job_status: job.status,
      attempt_count: job.attempt_count,
      max_attempts: job.max_attempts,
      intent_type: intent?.intent_type ?? null,
      intent_status: intent?.status ?? null,
      actor_ref: intent?.actor_ref ?? trace?.actor_ref ?? null,
      target_ref: intent?.target_ref ?? null,
      workflow_state: snapshot.derived.workflow_state,
      decision_stage: snapshot.derived.decision_stage,
      dispatch_stage: snapshot.derived.dispatch_stage,
      failure_stage: snapshot.derived.failure_stage,
      failure_code: snapshot.derived.failure_code,
      failure_reason: snapshot.derived.failure_reason,
      outcome_summary: snapshot.derived.outcome_summary,
      replay_of_job_id: snapshot.lineage.replay_of_job_id,
      replay_source_trace_id: snapshot.lineage.replay_source_trace_id,
      replay_reason: snapshot.lineage.replay_reason,
      override_applied: snapshot.lineage.override_applied,
      override_snapshot: snapshot.lineage.override_snapshot,
      semantic_intent: semanticIntent,
      intent_grounding: intentGrounding,
      semantic_outcome:
        (decisionRecord && isRecord(decisionRecord.meta)
          ? (decisionRecord.meta as Record<string, unknown>).semantic_outcome
          : null) ?? null,
      objective_effect_applied:
        (intentGrounding && typeof intentGrounding.objective_effect_applied === 'boolean'
          ? intentGrounding.objective_effect_applied
          : null) ?? null
    }
  };
};

const buildWorkflowAuditEntryByJobId = async (
  context: AppContext,
  jobId: string
): Promise<AuditViewEntry> => {
  return buildWorkflowAuditEntryBySnapshot(jobId, await getWorkflowSnapshotByJobId(context, jobId));
};

const toWorkflowLineageSummary = (entry: AuditViewEntry): Record<string, unknown> => {
  return {
    id: entry.id,
    created_at: entry.created_at,
    summary: entry.summary,
    workflow_state: entry.data.workflow_state ?? null,
    job_status: entry.data.job_status ?? null,
    intent_type: entry.data.intent_type ?? null,
    action_intent_id: entry.refs.action_intent_id ?? null,
    inference_id: entry.refs.inference_id ?? null,
    replay_of_job_id: entry.data.replay_of_job_id ?? null,
    replay_reason: entry.data.replay_reason ?? null,
    override_applied: entry.data.override_applied ?? null
  };
};

const buildWorkflowLineageDetail = async (
  context: AppContext,
  snapshot: Awaited<ReturnType<typeof getWorkflowSnapshotByJobId>>
): Promise<{
  parent_workflow: Record<string, unknown> | null;
  child_workflows: Record<string, unknown>[];
}> => {
  const parentWorkflow = snapshot.lineage.parent_job
    ? await buildWorkflowAuditEntryByJobId(context, snapshot.lineage.parent_job.id)
    : null;
  const childWorkflows = await Promise.all(
    snapshot.lineage.child_jobs.map(childJob => buildWorkflowAuditEntryByJobId(context, childJob.id))
  );

  return {
    parent_workflow: parentWorkflow ? toWorkflowLineageSummary(parentWorkflow) : null,
    child_workflows: childWorkflows.map(toWorkflowLineageSummary)
  };
};

const buildWorkflowAuditDetailEntry = async (
  context: AppContext,
  jobId: string,
  snapshot: Awaited<ReturnType<typeof getWorkflowSnapshotByJobId>>
): Promise<AuditViewEntry> => {
  const baseEntry = buildWorkflowAuditEntryBySnapshot(jobId, snapshot);
  const relatedRecords = await buildWorkflowRelatedRecords(context, baseEntry.refs.action_intent_id ?? null);
  const lineageDetail = await buildWorkflowLineageDetail(context, snapshot);

  return {
    ...baseEntry,
    data: {
      ...baseEntry.data,
      lineage_detail: lineageDetail,
      related_counts: {
        posts: relatedRecords.posts.length,
        relationship_adjustments: relatedRecords.relationship_adjustments.length,
        snr_adjustments: relatedRecords.snr_adjustments.length,
        events: relatedRecords.events.length
      },
      related_records: relatedRecords
    }
  };
};

export const getAuditEntryById = async (
  context: AppContext,
  input: GetAuditEntryInput
): Promise<AuditViewEntry> => {
  const kind = parseAuditEntryKind(input.kind);
  const id = parseAuditEntryId(input.id);

  switch (kind) {
    case 'workflow': {
      const snapshot = await getWorkflowSnapshotByJobId(context, id);
      return buildWorkflowAuditDetailEntry(context, id, snapshot);
    }
    case 'post': {
      const post = await context.prisma.post.findUnique({
        where: {
          id
        }
      });

      if (!post) {
        throw new Error(`Audit post entry not found for ${id}`);
      }

      return {
        kind: 'post',
        id: post.id,
        created_at: post.created_at.toString(),
        refs: {
          post_id: post.id,
          action_intent_id: post.source_action_intent_id,
          agent_id: post.author_id
        },
        summary: `${post.author_id}: ${post.content}`,
        data: {
          author_id: post.author_id,
          content: post.content,
          source_action_intent_id: post.source_action_intent_id,
          created_at: post.created_at.toString()
        }
      };
    }
    case 'event': {
      const entries = await buildEventAuditEntries(context, 100, {
        from_tick: null,
        to_tick: null,
        job_id: null,
        inference_id: null,
        agent_id: null,
        action_intent_id: null,
        cursor: null
      });
      const entry = entries.find(item => item.id === id);
      if (!entry) {
        throw new Error(`Audit event entry not found for ${id}`);
      }
      return entry;
    }
    case 'relationship_adjustment': {
      const entries = await buildRelationshipAdjustmentAuditEntries(context, 100, {
        from_tick: null,
        to_tick: null,
        job_id: null,
        inference_id: null,
        agent_id: null,
        action_intent_id: null,
        cursor: null
      });
      const entry = entries.find(item => item.id === id);
      if (!entry) {
        throw new Error(`Audit relationship adjustment entry not found for ${id}`);
      }
      return entry;
    }
    case 'snr_adjustment': {
      const entries = await buildSnrAdjustmentAuditEntries(context, 100, {
        from_tick: null,
        to_tick: null,
        job_id: null,
        inference_id: null,
        agent_id: null,
        action_intent_id: null,
        cursor: null
      });
      const entry = entries.find(item => item.id === id);
      if (!entry) {
        throw new Error(`Audit snr adjustment entry not found for ${id}`);
      }
      return entry;
    }
    default:
      throw new Error(`Unsupported audit entry kind: ${String(kind)}`);
  }
};

export const listAuditFeed = async (
  context: AppContext,
  query: Record<string, unknown>
): Promise<ListAuditFeedResult> => {
  const shouldValidateAsHttpQuery = Object.values(query).every(value => {
    return (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      Array.isArray(value)
    );
  });

  if (shouldValidateAsHttpQuery) {
    parseQuery(auditFeedQuerySchema, query, 'AUDIT_QUERY_INVALID');
  }
  const filters = parseAuditFeedFilters(query);

  const requestedKinds = filters.kinds ?? ['workflow', 'post', 'event', 'relationship_adjustment', 'snr_adjustment'];
  const entries = await Promise.all(
    requestedKinds.map(async kind => {
      switch (kind) {
        case 'workflow': {
          const jobs = await listInferenceJobs(context, {
            limit: filters.limit
          });
          return Promise.all(
            jobs.items.map(item => buildWorkflowAuditEntryByJobId(context, item.id))
          );
        }
        case 'post':
          return buildPostAuditEntries(context, filters.limit, filters);
        case 'event':
          return buildEventAuditEntries(context, filters.limit, filters);
        case 'relationship_adjustment':
          return buildRelationshipAdjustmentAuditEntries(context, filters.limit, filters);
        case 'snr_adjustment':
          return buildSnrAdjustmentAuditEntries(context, filters.limit, filters);
        default:
          return [];
      }
    })
  );

  const flattened = entries.flat().sort((left, right) => {
    const leftTick = BigInt(left.created_at);
    const rightTick = BigInt(right.created_at);
    if (leftTick === rightTick) {
      return right.id.localeCompare(left.id);
    }
    return leftTick > rightTick ? -1 : 1;
  });

  const paged = flattened.slice(0, filters.limit);
  const hasNextPage = flattened.length > filters.limit;
  const lastEntry = paged[paged.length - 1] ?? null;
  const nextCursor = hasNextPage && lastEntry ? `${lastEntry.created_at}:${lastEntry.id}` : null;

  return {
    entries: paged,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: nextCursor
    }
  };
};
