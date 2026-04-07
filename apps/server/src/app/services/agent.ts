import { getPackEntityOverviewProjection } from '../../packs/runtime/projections/entity_overview_service.js';
import { PermissionContext } from '../../permission/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import type { AuditViewEntry } from './audit.js';
import { listAuditFeed } from './audit.js';
import { listInferenceJobs } from './inference_workflow.js';

export interface ListSnrAdjustmentLogsInput {
  agent_id?: string;
  limit?: number;
}

export interface AgentOverviewSnapshot {
  profile: {
    id: string;
    name: string;
    type: string;
    snr: number;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
  };
  binding_summary: {
    active: Array<{
      binding_id: string;
      identity_id: string;
      role: string;
      status: string;
      atmosphere_node_id: string | null;
      expires_at: string | null;
    }>;
    atmosphere: Array<{
      binding_id: string;
      identity_id: string;
      role: string;
      status: string;
      atmosphere_node_id: string | null;
      expires_at: string | null;
    }>;
    counts: {
      total: number;
      active: number;
      atmosphere: number;
    };
  };
  relationship_summary: {
    incoming: Array<{
      id: string;
      from_id: string;
      from_name: string;
      type: string;
      weight: number;
      updated_at: string;
    }>;
    outgoing: Array<{
      id: string;
      to_id: string;
      to_name: string;
      type: string;
      weight: number;
      updated_at: string;
    }>;
    counts: {
      incoming: number;
      outgoing: number;
      total: number;
    };
  };
  pack_projection: {
    entity: {
      entity_kind: string;
      entity_type: string | null;
      tags: string[];
      state: Array<{
        namespace: string;
        value: Record<string, unknown>;
      }>;
    } | null;
    recent_rule_executions: Array<{
      id: string;
      rule_id: string;
      capability_key: string | null;
      execution_status: string;
      created_at: string;
    }>;
  };
  recent_activity: AuditViewEntry[];
  recent_posts: AuditViewEntry[];
  recent_workflows: Awaited<ReturnType<typeof listInferenceJobs>>['items'];
  recent_events: AuditViewEntry[];
  recent_inference_results: Array<{
    job_id: string;
    inference_id: string | null;
    strategy: string | null;
    workflow_state: string;
    intent_type: string | null;
    outcome_summary: Record<string, unknown> | null;
    decision: Record<string, unknown> | null;
    created_at: string;
  }>;
  snr: {
    current: number;
    recent_logs: Array<{
      id: string;
      operation: string;
      requested_value: number;
      baseline_value: number;
      resolved_value: number;
      reason: string | null;
      created_at: string;
    }>;
  };
  memory: {
    summary: {
      recent_trace_count: number;
      latest_memory_context: Record<string, unknown> | null;
      latest_memory_selection: Record<string, unknown> | null;
      latest_prompt_processing_trace: Record<string, unknown> | null;
    };
  };
}

const DEFAULT_SNR_LOG_LIMIT = 20;
const MAX_SNR_LOG_LIMIT = 100;
const DEFAULT_AGENT_OVERVIEW_LIMIT = 10;
const AGENT_QUERY_INVALID = 'AGENT_QUERY_INVALID';

const buildPermissionContext = (agent: {
  id: string;
  circle_memberships: Array<{
    circle_id: string;
    circle: {
      level: number;
    };
  }>;
}): PermissionContext => {
  return {
    agent_id: agent.id,
    circles: new Set(agent.circle_memberships.map(membership => membership.circle_id)),
    global_level: Math.max(...agent.circle_memberships.map(membership => membership.circle.level), 0)
  };
};

const assertNonEmptyAgentId = (agentId: string): string => {
  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new ApiError(400, 'AGENT_NOT_FOUND', 'agent_id is required');
  }

  return agentId.trim();
};

const parsePositiveBoundedLimit = (
  value: number | undefined,
  options: {
    defaultValue: number;
    maxValue: number;
    errorCode: string;
    fieldName: string;
  }
): number => {
  if (value === undefined) {
    return options.defaultValue;
  }

  if (!Number.isFinite(value) || Number.isNaN(value)) {
    throw new ApiError(400, options.errorCode, `${options.fieldName} must be a positive integer`, {
      field: options.fieldName,
      value
    });
  }

  const normalized = Math.trunc(value);
  if (normalized < 1) {
    throw new ApiError(400, options.errorCode, `${options.fieldName} must be a positive integer`, {
      field: options.fieldName,
      value
    });
  }

  return Math.min(options.maxValue, normalized);
};

const toTickString = (value: bigint | null): string | null => {
  return value === null ? null : value.toString();
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toAuditEntries = (entries: AuditViewEntry[], kind: AuditViewEntry['kind']): AuditViewEntry[] => {
  return entries.filter(entry => entry.kind === kind);
};

export const getAgentContextSnapshot = async (context: AppContext, agentId: string) => {
  const agent = await context.prisma.agent.findUnique({
    where: { id: agentId },
    include: { circle_memberships: { include: { circle: true } } }
  });

  if (!agent) {
    throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', { agent_id: agentId });
  }

  const permission = buildPermissionContext(agent);
  const resolvedVariables = context.sim.resolvePackVariables(JSON.stringify(context.sim.getActivePack()?.variables || {}), permission);

  return {
    identity: agent,
    variables: JSON.parse(resolvedVariables)
  };
};

export const getEntityOverview = async (
  context: AppContext,
  entityId: string,
  options?: {
    limit?: number;
  }
): Promise<AgentOverviewSnapshot> => {
  const resolvedAgentId = assertNonEmptyAgentId(entityId);
  const limit = parsePositiveBoundedLimit(options?.limit, {
    defaultValue: DEFAULT_AGENT_OVERVIEW_LIMIT,
    maxValue: MAX_SNR_LOG_LIMIT,
    errorCode: AGENT_QUERY_INVALID,
    fieldName: 'limit'
  });

  const agent = await context.prisma.agent.findUnique({
    where: { id: resolvedAgentId },
    include: {
      circle_memberships: {
        include: {
          circle: true
        }
      }
    }
  });

  if (!agent) {
    throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', { agent_id: resolvedAgentId });
  }

  const [bindings, outgoingRelationships, incomingRelationships, auditFeed, workflowList, snrLogs, recentTraces, packProjection] = await Promise.all([
    context.prisma.identityNodeBinding.findMany({
      where: {
        agent_id: resolvedAgentId
      },
      orderBy: {
        created_at: 'desc'
      },
      include: {
        identity: {
          select: {
            id: true
          }
        }
      }
    }),
    context.prisma.relationship.findMany({
      where: {
        from_id: resolvedAgentId
      },
      orderBy: {
        updated_at: 'desc'
      },
      take: limit,
      include: {
        to: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    context.prisma.relationship.findMany({
      where: {
        to_id: resolvedAgentId
      },
      orderBy: {
        updated_at: 'desc'
      },
      take: limit,
      include: {
        from: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    listAuditFeed(context, {
      agent_id: resolvedAgentId,
      limit: Math.max(limit * 3, 20)
    }),
    listInferenceJobs(context, {
      agent_id: resolvedAgentId,
      limit
    }),
    listSnrAdjustmentLogs(context, {
      agent_id: resolvedAgentId,
      limit
    }),
    context.prisma.inferenceTrace.findMany({
      orderBy: {
        created_at: 'desc'
      },
      take: limit
    }),
    getPackEntityOverviewProjection(context)
  ]);

  const recentEvents = toAuditEntries(auditFeed.entries, 'event').slice(0, limit);
  const recentPosts = toAuditEntries(auditFeed.entries, 'post').slice(0, limit);
  const recentActivity = auditFeed.entries.slice(0, limit);
  const recentWorkflows = workflowList.items.slice(0, limit);
  const traceIdsFromWorkflows = recentWorkflows
    .map(item => item.pending_source_key ?? item.source_inference_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const filteredRecentTraces = recentTraces
    .filter(trace => traceIdsFromWorkflows.includes(trace.id))
    .slice(0, limit);
  const findWorkflowByInferenceId = (inferenceId: string) => {
    return recentWorkflows.find(item => (item.pending_source_key ?? item.source_inference_id) === inferenceId);
  };

  const latestTrace = filteredRecentTraces[0] ?? null;
  const latestContextSnapshot = isRecord(latestTrace?.context_snapshot)
    ? (latestTrace?.context_snapshot as Record<string, unknown>)
    : null;
  const packEntity = packProjection.entities.find(entity => entity.id === resolvedAgentId) ?? null;

  const bindingSummary = {
    active: bindings
      .filter(binding => binding.role === 'active')
      .slice(0, limit)
      .map(binding => ({
        binding_id: binding.id,
        identity_id: binding.identity.id,
        role: binding.role,
        status: binding.status,
        atmosphere_node_id: binding.atmosphere_node_id,
        expires_at: toTickString(binding.expires_at)
      })),
    atmosphere: bindings
      .filter(binding => binding.role === 'atmosphere')
      .slice(0, limit)
      .map(binding => ({
        binding_id: binding.id,
        identity_id: binding.identity.id,
        role: binding.role,
        status: binding.status,
        atmosphere_node_id: binding.atmosphere_node_id,
        expires_at: toTickString(binding.expires_at)
      })),
    counts: {
      total: bindings.length,
      active: bindings.filter(binding => binding.role === 'active').length,
      atmosphere: bindings.filter(binding => binding.role === 'atmosphere').length
    }
  };

  return {
    profile: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      snr: agent.snr,
      is_pinned: agent.is_pinned,
      created_at: agent.created_at.toString(),
      updated_at: agent.updated_at.toString()
    },
    binding_summary: bindingSummary,
    relationship_summary: {
      incoming: incomingRelationships.map(relationship => ({
        id: relationship.id,
        from_id: relationship.from_id,
        from_name: relationship.from.name,
        type: relationship.type,
        weight: relationship.weight,
        updated_at: relationship.updated_at.toString()
      })),
      outgoing: outgoingRelationships.map(relationship => ({
        id: relationship.id,
        to_id: relationship.to_id,
        to_name: relationship.to.name,
        type: relationship.type,
        weight: relationship.weight,
        updated_at: relationship.updated_at.toString()
      })),
      counts: {
        incoming: incomingRelationships.length,
        outgoing: outgoingRelationships.length,
        total: incomingRelationships.length + outgoingRelationships.length
      }
    },
    pack_projection: {
      entity: packEntity
        ? {
            entity_kind: packEntity.entity_kind,
            entity_type: packEntity.entity_type,
            tags: packEntity.tags,
            state: packEntity.state
          }
        : null,
      recent_rule_executions: packProjection.recent_rule_executions
        .filter(record => record.subject_entity_id === resolvedAgentId || record.target_entity_id === resolvedAgentId)
        .slice(0, limit)
        .map(record => ({
          id: record.id,
          rule_id: record.rule_id,
          capability_key: record.capability_key,
          execution_status: record.execution_status,
          created_at: record.created_at
        }))
    },
    recent_activity: recentActivity,
    recent_posts: recentPosts,
    recent_workflows: recentWorkflows,
    recent_events: recentEvents,
    recent_inference_results: filteredRecentTraces.map(trace => ({
      job_id:
        findWorkflowByInferenceId(trace.id)?.id ??
        recentActivity.find(entry => entry.kind === 'workflow' && entry.refs.inference_id === trace.id)?.id ??
        '',
      inference_id: trace.id,
      strategy: trace.strategy,
      workflow_state:
        findWorkflowByInferenceId(trace.id)?.workflow.workflow_state ??
        'unknown',
      intent_type:
        findWorkflowByInferenceId(trace.id)?.workflow.intent_type ??
        null,
      outcome_summary: (
        findWorkflowByInferenceId(trace.id)?.workflow.outcome_summary
      )
        ? (findWorkflowByInferenceId(trace.id)?.workflow.outcome_summary as unknown as Record<string, unknown>)
        : null,
      decision: isRecord(trace.decision) ? (trace.decision as Record<string, unknown>) : null,
      created_at: trace.created_at.toString()
    })),
    snr: {
      current: agent.snr,
      recent_logs: snrLogs.map(log => ({
        id: log.id,
        operation: log.operation,
        requested_value: log.requested_value,
        baseline_value: log.baseline_value,
        resolved_value: log.resolved_value,
        reason: log.reason,
        created_at: log.created_at.toString()
      }))
    },
    memory: {
      summary: {
        recent_trace_count: filteredRecentTraces.length,
        latest_memory_context: latestContextSnapshot && isRecord(latestContextSnapshot.memory_context)
          ? (latestContextSnapshot.memory_context as Record<string, unknown>)
          : null,
        latest_memory_selection: latestContextSnapshot && isRecord(latestContextSnapshot.memory_selection)
          ? (latestContextSnapshot.memory_selection as Record<string, unknown>)
          : null,
        latest_prompt_processing_trace: latestContextSnapshot && isRecord(latestContextSnapshot.prompt_processing_trace)
          ? (latestContextSnapshot.prompt_processing_trace as Record<string, unknown>)
          : null
      }
    }
  };
};

export const listSnrAdjustmentLogs = async (
  context: AppContext,
  input: ListSnrAdjustmentLogsInput
) => {
  const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : '';

  if (agentId.length === 0) {
    throw new ApiError(400, 'SNR_LOG_QUERY_INVALID', 'agent_id is required');
  }

  const limit = parsePositiveBoundedLimit(input.limit, {
    defaultValue: DEFAULT_SNR_LOG_LIMIT,
    maxValue: MAX_SNR_LOG_LIMIT,
    errorCode: 'SNR_LOG_QUERY_INVALID',
    fieldName: 'limit'
  });

  return context.prisma.sNRAdjustmentLog.findMany({
    where: {
      agent_id: agentId
    },
    orderBy: {
      created_at: 'desc'
    },
    take: limit
  });
};
