import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { getWorkflowSnapshotByJobId } from './inference_workflow.js';

const AUDIT_VIEW_KINDS = [
  'workflow',
  'post',
  'relationship_adjustment',
  'snr_adjustment',
  'event'
] as const;

export type AuditViewKind = (typeof AUDIT_VIEW_KINDS)[number];

export interface GetAuditEntryInput {
  kind?: string;
  id?: string;
}

export interface ListAuditFeedInput {
  limit?: number;
  kinds?: string[];
  from_tick?: string | number;
  to_tick?: string | number;
  job_id?: string;
  inference_id?: string;
  agent_id?: string;
  action_intent_id?: string;
  cursor?: string;
}

export interface AuditViewEntry {
  kind: AuditViewKind;
  id: string;
  created_at: string;
  refs: Record<string, string | null>;
  summary: string;
  data: Record<string, unknown>;
}

export interface AuditFeedSnapshot {
  entries: AuditViewEntry[];
  summary: {
    returned: number;
    limit: number;
    applied_kinds: AuditViewKind[];
    page_info: {
      has_next_page: boolean;
      next_cursor: string | null;
    };
    counts_by_kind: Record<AuditViewKind, number>;
    filters: {
      from_tick: string | null;
      to_tick: string | null;
      job_id: string | null;
      inference_id: string | null;
      agent_id: string | null;
      action_intent_id: string | null;
      cursor: string | null;
    };
  };
}

const DEFAULT_AUDIT_FEED_LIMIT = 20;
const MAX_AUDIT_FEED_LIMIT = 100;

const isAuditViewKind = (value: string): value is AuditViewKind => {
  return (AUDIT_VIEW_KINDS as readonly string[]).includes(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

interface AuditFeedFilters {
  from_tick: bigint | null;
  to_tick: bigint | null;
  job_id: string | null;
  inference_id: string | null;
  agent_id: string | null;
  action_intent_id: string | null;
  cursor: AuditFeedCursor | null;
}

interface AuditFeedCursor {
  created_at: string;
  kind: AuditViewKind;
  id: string;
}

const parseAuditKinds = (value: string[] | undefined): AuditViewKind[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [...AUDIT_VIEW_KINDS];
  }

  const normalized = Array.from(
    new Set(
      value
        .map(item => item.trim())
        .filter(item => item.length > 0)
    )
  );

  if (normalized.length === 0) {
    return [...AUDIT_VIEW_KINDS];
  }

  const invalidKinds = normalized.filter(item => !isAuditViewKind(item));
  if (invalidKinds.length > 0) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'kinds contains unsupported audit entry kind', {
      invalid_kinds: invalidKinds,
      allowed_kinds: AUDIT_VIEW_KINDS
    });
  }

  return normalized as AuditViewKind[];
};

const parseAuditEntryKind = (value: string | undefined): AuditViewKind => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'audit entry kind is required');
  }

  const normalized = value.trim();
  if (!isAuditViewKind(normalized)) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'audit entry kind is unsupported', {
      kind: normalized,
      allowed_kinds: AUDIT_VIEW_KINDS
    });
  }

  return normalized;
};

const parseAuditEntryId = (value: string | undefined): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'audit entry id is required');
  }

  return value.trim();
};

const parseAuditLimit = (value: number | undefined): number => {
  const requestedLimit =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : DEFAULT_AUDIT_FEED_LIMIT;

  return Math.min(MAX_AUDIT_FEED_LIMIT, Math.max(1, requestedLimit));
};

const parseOptionalFilterId = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseAuditCursor = (value: string | undefined): AuditFeedCursor | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'cursor is invalid');
  }

  if (!isRecord(parsed) || typeof parsed.created_at !== 'string' || typeof parsed.kind !== 'string' || typeof parsed.id !== 'string') {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'cursor payload is invalid');
  }

  if (!/^\d+$/.test(parsed.created_at) || !isAuditViewKind(parsed.kind)) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'cursor payload is invalid');
  }

  return {
    created_at: parsed.created_at,
    kind: parsed.kind,
    id: parsed.id
  };
};

const encodeAuditCursorPayload = (value: Pick<AuditFeedCursor, 'created_at' | 'kind' | 'id'>): string => {
  return Buffer.from(
    JSON.stringify({
      created_at: value.created_at,
      kind: value.kind,
      id: value.id
    }),
    'utf8'
  ).toString('base64url');
};

const encodeAuditCursor = (entry: AuditViewEntry): string => {
  return encodeAuditCursorPayload({
    created_at: entry.created_at,
    kind: entry.kind,
    id: entry.id
  });
};

const parseOptionalTickFilter = (value: string | number | undefined, fieldName: 'from_tick' | 'to_tick'): bigint | null => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', `${fieldName} must be a safe integer number or integer string`);
    }

    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', `${fieldName} must be a non-negative integer string`, {
      field: fieldName,
      value
    });
  }

  return BigInt(trimmed);
};

const parseAuditFilters = (input: ListAuditFeedInput): AuditFeedFilters => {
  const fromTick = parseOptionalTickFilter(input.from_tick, 'from_tick');
  const toTick = parseOptionalTickFilter(input.to_tick, 'to_tick');

  if (fromTick !== null && toTick !== null && fromTick > toTick) {
    throw new ApiError(400, 'AUDIT_VIEW_QUERY_INVALID', 'from_tick must be less than or equal to to_tick', {
      from_tick: fromTick.toString(),
      to_tick: toTick.toString()
    });
  }

  return {
    from_tick: fromTick,
    to_tick: toTick,
    job_id: parseOptionalFilterId(input.job_id),
    inference_id: parseOptionalFilterId(input.inference_id),
    agent_id: parseOptionalFilterId(input.agent_id),
    action_intent_id: parseOptionalFilterId(input.action_intent_id),
    cursor: parseAuditCursor(input.cursor)
  };
};

const matchesTickRange = (filters: AuditFeedFilters, tick: bigint): boolean => {
  if (filters.from_tick !== null && tick < filters.from_tick) {
    return false;
  }

  if (filters.to_tick !== null && tick > filters.to_tick) {
    return false;
  }

  return true;
};

const extractAgentIdsFromRefs = (actorRef: unknown, targetRef: unknown, explicitAgentIds: Array<string | null> = []): string[] => {
  const candidateIds = new Set<string>();

  if (isRecord(actorRef) && typeof actorRef.agent_id === 'string' && actorRef.agent_id.trim().length > 0) {
    candidateIds.add(actorRef.agent_id.trim());
  }

  if (isRecord(targetRef) && typeof targetRef.agent_id === 'string' && targetRef.agent_id.trim().length > 0) {
    candidateIds.add(targetRef.agent_id.trim());
  }

  for (const explicitAgentId of explicitAgentIds) {
    if (typeof explicitAgentId === 'string' && explicitAgentId.trim().length > 0) {
      candidateIds.add(explicitAgentId.trim());
    }
  }

  return [...candidateIds];
};

const matchesActionIntentFilter = (
  filters: AuditFeedFilters,
  candidateIds: Array<string | null | undefined>
): boolean => {
  if (!filters.action_intent_id) {
    return true;
  }

  return candidateIds.some(candidateId => candidateId === filters.action_intent_id);
};

const matchesAgentFilter = (filters: AuditFeedFilters, candidateAgentIds: string[]): boolean => {
  if (!filters.agent_id) {
    return true;
  }

  return candidateAgentIds.includes(filters.agent_id);
};

const compareCursorPosition = (left: AuditFeedCursor, right: AuditFeedCursor): number => {
  const leftTick = BigInt(left.created_at);
  const rightTick = BigInt(right.created_at);

  if (leftTick === rightTick) {
    if (left.kind === right.kind) {
      return right.id.localeCompare(left.id);
    }

    return left.kind.localeCompare(right.kind);
  }

  return leftTick > rightTick ? -1 : 1;
};

const matchesCursor = (filters: AuditFeedFilters, entry: AuditViewEntry): boolean => {
  if (!filters.cursor) {
    return true;
  }

  return compareCursorPosition({ created_at: entry.created_at, kind: entry.kind, id: entry.id }, filters.cursor) > 0;
};

const compareAuditEntries = (left: AuditViewEntry, right: AuditViewEntry): number => {
  const leftTick = BigInt(left.created_at);
  const rightTick = BigInt(right.created_at);

  if (leftTick === rightTick) {
    if (left.kind === right.kind) {
      return right.id.localeCompare(left.id);
    }

    return left.kind.localeCompare(right.kind);
  }

  return leftTick > rightTick ? -1 : 1;
};

const parseEventImpactData = (value: string | null): unknown => {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const buildBigIntRangeWhere = (filters: AuditFeedFilters, fieldName: string): Record<string, unknown> | undefined => {
  if (filters.from_tick === null && filters.to_tick === null) {
    return undefined;
  }

  return {
    [fieldName]: {
      ...(filters.from_tick !== null ? { gte: filters.from_tick } : {}),
      ...(filters.to_tick !== null ? { lte: filters.to_tick } : {})
    }
  };
};

const shouldFetchAllForFilters = (filters: AuditFeedFilters): boolean => {
  return (
    filters.cursor !== null ||
    filters.agent_id !== null ||
    filters.job_id !== null ||
    filters.inference_id !== null
  );
};

const buildWorkflowAuditEntries = async (
  context: AppContext,
  limit: number,
  filters: AuditFeedFilters
): Promise<AuditViewEntry[]> => {
  const jobs = await context.prisma.decisionJob.findMany({
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
      ...(filters.job_id
        ? {
            id: filters.job_id
          }
        : {}),
      ...(buildBigIntRangeWhere(filters, 'created_at') ?? {})
    },
    orderBy: { created_at: 'desc' }
  });

  const snapshots = await Promise.all(jobs.map(job => getWorkflowSnapshotByJobId(context, job.id)));

  return jobs.flatMap((job, index) => {
    const snapshot = snapshots[index];
    const trace = snapshot.records.trace;
    const intent = snapshot.records.intent;
    const workflow = snapshot.derived;
    const candidateAgentIds = extractAgentIdsFromRefs(intent?.actor_ref ?? trace?.actor_ref ?? null, intent?.target_ref ?? null);

    if (filters.inference_id && trace?.id !== filters.inference_id && job.source_inference_id !== filters.inference_id) {
      return [];
    }

    if (!matchesAgentFilter(filters, candidateAgentIds)) {
      return [];
    }

    if (!matchesTickRange(filters, job.created_at)) {
      return [];
    }

    return [{
      kind: 'workflow',
      id: job.id,
      created_at: job.created_at.toString(),
      refs: {
        inference_id: trace?.id ?? job.source_inference_id ?? null,
        job_id: job.id,
        action_intent_id: intent?.id ?? job.action_intent_id ?? null
      },
      summary: `${intent?.intent_type ?? 'workflow'} -> ${workflow.workflow_state}`,
      data: {
        source_inference_id: job.source_inference_id ?? null,
        job_type: job.job_type,
        job_status: job.status,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        intent_type: intent?.intent_type ?? null,
        intent_status: intent?.status ?? null,
        actor_ref: intent?.actor_ref ?? trace?.actor_ref ?? null,
        target_ref: intent?.target_ref ?? null,
        workflow_state: workflow.workflow_state,
        decision_stage: workflow.decision_stage,
        dispatch_stage: workflow.dispatch_stage,
        failure_stage: workflow.failure_stage,
        failure_code: workflow.failure_code,
        failure_reason: workflow.failure_reason,
        outcome_summary: workflow.outcome_summary,
        replay_of_job_id: snapshot.lineage.replay_of_job_id,
        replay_reason: snapshot.lineage.replay_reason,
        override_applied: snapshot.lineage.override_applied,
        override_snapshot: snapshot.lineage.override_snapshot
      }
    }];
  });
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
    take: limit,
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
    orderBy: { created_at: 'desc' },
    include: {
      author: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  return posts.flatMap(post => {
    const candidateAgentIds = extractAgentIdsFromRefs(null, null, [post.author_id]);
    if (!matchesAgentFilter(filters, candidateAgentIds)) {
      return [];
    }

    if (!matchesTickRange(filters, post.created_at)) {
      return [];
    }

    return [{
    kind: 'post',
    id: post.id,
    created_at: post.created_at.toString(),
    refs: {
      post_id: post.id,
      author_id: post.author_id,
      action_intent_id: post.source_action_intent_id
    },
    summary: `${post.author.name}: ${post.content}`,
    data: {
      author_id: post.author_id,
      source_action_intent_id: post.source_action_intent_id,
      author_name: post.author.name,
      content: post.content,
      noise_level: post.noise_level,
      is_encrypted: post.is_encrypted
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
    take: limit,
    where: {
      ...(filters.action_intent_id ? { action_intent_id: filters.action_intent_id } : {}),
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
      relationship_id: log.relationship_id,
      action_intent_id: log.action_intent_id,
      from_id: log.from_id,
      to_id: log.to_id
    },
    summary: `${log.from_id} -> ${log.to_id} (${log.type}) ${log.old_weight === null ? 'null' : String(log.old_weight)} -> ${String(log.new_weight)}`,
    data: {
      relationship_id: log.relationship_id,
      action_intent_id: log.action_intent_id,
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
      ...(buildBigIntRangeWhere(filters, 'created_at') ?? {})
    },
    orderBy: { created_at: 'desc' },
    include: {
      agent: {
        select: {
          id: true,
          name: true
        }
      },
      action_intent: {
        select: {
          actor_ref: true,
          target_ref: true
        }
      }
    }
  });

  return logs.flatMap(log => {
    const candidateAgentIds = extractAgentIdsFromRefs(log.action_intent.actor_ref, log.action_intent.target_ref, [log.agent_id]);
    if (!matchesAgentFilter(filters, candidateAgentIds)) {
      return [];
    }

    if (!matchesTickRange(filters, log.created_at)) {
      return [];
    }

    if (filters.inference_id) {
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

    const candidateAgentIds = extractAgentIdsFromRefs(
      event.source_action_intent?.actor_ref ?? null,
      event.source_action_intent?.target_ref ?? null
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
      action_intent_id: event.source_action_intent_id
    },
    summary: `${event.type}: ${event.title}`,
    data: {
      title: event.title,
      description: event.description,
      tick: event.tick.toString(),
      type: event.type,
      impact_data: parseEventImpactData(event.impact_data),
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
    throw new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'Audit workflow entry not found', {
      kind: 'workflow',
      id: jobId
    });
  }

  return {
    kind: 'workflow',
    id: job.id,
    created_at: job.created_at,
    refs: {
      inference_id: trace?.id ?? job.source_inference_id ?? null,
      job_id: job.id,
      action_intent_id: intent?.id ?? job.action_intent_id ?? null
    },
    summary: `${intent?.intent_type ?? 'workflow'} -> ${snapshot.derived.workflow_state}`,
    data: {
      source_inference_id: job.source_inference_id ?? null,
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
      replay_reason: snapshot.lineage.replay_reason,
      override_applied: snapshot.lineage.override_applied,
      override_snapshot: snapshot.lineage.override_snapshot
    }
  };
};

const buildWorkflowAuditDetailEntry = async (
  context: AppContext,
  jobId: string,
  snapshot: Awaited<ReturnType<typeof getWorkflowSnapshotByJobId>>
): Promise<AuditViewEntry> => {
  const baseEntry = buildWorkflowAuditEntryBySnapshot(jobId, snapshot);
  const relatedRecords = await buildWorkflowRelatedRecords(context, baseEntry.refs.action_intent_id);

  return {
    ...baseEntry,
    data: {
      ...baseEntry.data,
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

  if (kind === 'workflow') {
    const job = await context.prisma.decisionJob.findUnique({ where: { id } });
    if (!job) {
      throw new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'Audit entry not found', { kind, id });
    }
    return buildWorkflowAuditDetailEntry(context, id, await getWorkflowSnapshotByJobId(context, id));
  }

  if (kind === 'post') {
    const post = await context.prisma.post.findUnique({
      where: { id },
      include: { author: { select: { id: true, name: true } } }
    });
    if (!post) {
      throw new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'Audit entry not found', { kind, id });
    }
    return {
      kind,
      id: post.id,
      created_at: post.created_at.toString(),
      refs: {
        post_id: post.id,
        author_id: post.author_id,
        action_intent_id: post.source_action_intent_id
      },
      summary: `${post.author.name}: ${post.content}`,
      data: {
        author_id: post.author_id,
        source_action_intent_id: post.source_action_intent_id,
        author_name: post.author.name,
        content: post.content,
        noise_level: post.noise_level,
        is_encrypted: post.is_encrypted
      }
    };
  }

  if (kind === 'relationship_adjustment') {
    const log = await context.prisma.relationshipAdjustmentLog.findUnique({ where: { id } });
    if (!log) {
      throw new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'Audit entry not found', { kind, id });
    }
    return {
      kind,
      id: log.id,
      created_at: log.created_at.toString(),
      refs: {
        relationship_adjustment_id: log.id,
        relationship_id: log.relationship_id,
        action_intent_id: log.action_intent_id,
        from_id: log.from_id,
        to_id: log.to_id
      },
      summary: `${log.from_id} -> ${log.to_id} (${log.type}) ${log.old_weight === null ? 'null' : String(log.old_weight)} -> ${String(log.new_weight)}`,
      data: {
        relationship_id: log.relationship_id,
        action_intent_id: log.action_intent_id,
        from_id: log.from_id,
        to_id: log.to_id,
        type: log.type,
        operation: log.operation,
        old_weight: log.old_weight,
        new_weight: log.new_weight,
        reason: log.reason
      }
    };
  }

  if (kind === 'snr_adjustment') {
    const log = await context.prisma.sNRAdjustmentLog.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, name: true } },
        action_intent: { select: { actor_ref: true, target_ref: true } }
      }
    });
    if (!log) {
      throw new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'Audit entry not found', { kind, id });
    }
    return {
      kind,
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
    };
  }

  const event = await context.prisma.event.findUnique({
    where: { id },
    include: {
      source_action_intent: {
        select: {
          actor_ref: true,
          target_ref: true
        }
      }
    }
  });
  if (!event) {
    throw new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'Audit entry not found', { kind, id });
  }
  return {
    kind,
    id: event.id,
    created_at: event.created_at.toString(),
    refs: {
      event_id: event.id,
      action_intent_id: event.source_action_intent_id
    },
    summary: `${event.type}: ${event.title}`,
    data: {
      title: event.title,
      description: event.description,
      tick: event.tick.toString(),
      type: event.type,
      impact_data: parseEventImpactData(event.impact_data),
      source_action_intent_id: event.source_action_intent_id
    }
  };
};

export const listAuditFeed = async (
  context: AppContext,
  input: ListAuditFeedInput
): Promise<AuditFeedSnapshot> => {
  const limit = parseAuditLimit(input.limit);
  const kinds = parseAuditKinds(input.kinds);
  const filters = parseAuditFilters(input);
  const entries: AuditViewEntry[] = [];

  if (kinds.includes('workflow')) {
    entries.push(...(await buildWorkflowAuditEntries(context, limit, filters)));
  }

  if (kinds.includes('post')) {
    entries.push(...(await buildPostAuditEntries(context, limit, filters)));
  }

  if (kinds.includes('relationship_adjustment')) {
    entries.push(...(await buildRelationshipAdjustmentAuditEntries(context, limit, filters)));
  }

  if (kinds.includes('snr_adjustment')) {
    entries.push(...(await buildSnrAdjustmentAuditEntries(context, limit, filters)));
  }

  if (kinds.includes('event')) {
    entries.push(...(await buildEventAuditEntries(context, limit, filters)));
  }

  const sortedEntries = entries
    .sort(compareAuditEntries)
    .filter(entry => matchesCursor(filters, entry))
    .slice(0, limit + 1);
  const countsByKind: Record<AuditViewKind, number> = {
    workflow: 0,
    post: 0,
    relationship_adjustment: 0,
    snr_adjustment: 0,
    event: 0
  };

  const hasNextPage = sortedEntries.length > limit;
  const pageEntries = hasNextPage ? sortedEntries.slice(0, limit) : sortedEntries;

  for (const entry of pageEntries) {
    countsByKind[entry.kind] += 1;
  }

  return {
    entries: pageEntries,
    summary: {
      returned: pageEntries.length,
      limit,
      applied_kinds: kinds,
      page_info: {
        has_next_page: hasNextPage,
        next_cursor: hasNextPage ? encodeAuditCursor(pageEntries[pageEntries.length - 1]) : null
      },
      filters: {
        from_tick: filters.from_tick?.toString() ?? null,
        to_tick: filters.to_tick?.toString() ?? null,
        job_id: filters.job_id,
        inference_id: filters.inference_id,
        agent_id: filters.agent_id,
        action_intent_id: filters.action_intent_id,
        cursor: filters.cursor ? encodeAuditCursorPayload(filters.cursor) : null
      },
      counts_by_kind: countsByKind
    }
  };
};
