import type { ContextOverlayType } from '../../context/overlay/types.js';
import { getPackEntityOverviewProjection } from '../../packs/runtime/projections/entity_overview_service.js';
import { PermissionContext } from '../../permission/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext, AppInfrastructure } from '../context.js';
import type { AppContextPorts } from './app_context_ports.js';
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
    latest_blocks: {
      evaluated: Array<Record<string, unknown>>;
      inserted: string[];
      delayed: string[];
      cooling: string[];
      retained: string[];
      inactive: string[];
      mutations: Array<Record<string, unknown>>;
    };
  };
  context_governance: {
    latest_policy: {
      policy_decisions: Array<Record<string, unknown>>;
      blocked_nodes: Array<Record<string, unknown>>;
      locked_nodes: Array<Record<string, unknown>>;
      visibility_denials: Array<Record<string, unknown>>;
    };
    overlay: {
      count: number;
      latest_items: Array<{
        node_id: string;
        overlay_id: string;
        overlay_type: ContextOverlayType | string;
        persistence_mode: string;
        created_by: 'system' | 'agent';
        status: string;
        preferred_slot: string | null;
      }>;
      latest_mutations: Array<Record<string, unknown>>;
    };
    memory_blocks: {
      evaluated: Array<Record<string, unknown>>;
      inserted: string[];
      delayed: string[];
      cooling: string[];
      retained: string[];
      inactive: string[];
      mutations: Array<Record<string, unknown>>;
      compaction_state: Record<string, unknown> | null;
      latest_trace_memory_mutations: Array<Record<string, unknown>>;
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

export const getAgentContextSnapshot = async (context: AppInfrastructure & Pick<AppContextPorts, 'activePackRuntime'>, agentId: string) => {
  const agent = await context.prisma.agent.findUnique({
    where: { id: agentId },
    include: { circle_memberships: { include: { circle: true } } }
  });

  if (!agent) {
    throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', { agent_id: agentId });
  }

  const permission = buildPermissionContext(agent);
  const resolvedVariables = context.activePackRuntime?.resolvePackVariables(JSON.stringify(context.activePack.getActivePack()?.variables || {}), permission) ?? JSON.stringify({});

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
    throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', {
      agent_id: resolvedAgentId
    });
  }

  const [
    bindings,
    incomingRelationships,
    outgoingRelationships,
    auditFeed,
    workflowList,
    snrLogs,
    recentTraces,
    packProjection
  ] = await Promise.all([
    context.prisma.identityNodeBinding.findMany({
      where: {
        agent_id: resolvedAgentId
      },
      include: {
        identity: true
      },
      orderBy: {
        created_at: 'desc'
      }
    }),
    context.prisma.relationship.findMany({
      where: {
        to_id: resolvedAgentId
      },
      include: {
        from: true
      },
      orderBy: {
        updated_at: 'desc'
      }
    }),
    context.prisma.relationship.findMany({
      where: {
        from_id: resolvedAgentId
      },
      include: {
        to: true
      },
      orderBy: {
        updated_at: 'desc'
      }
    }),
    listAuditFeed(context, {
      filter_agent_id: resolvedAgentId,
      limit
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
  const latestPolicyDecisions = latestContextSnapshot && Array.isArray(latestContextSnapshot.policy_decisions)
    ? latestContextSnapshot.policy_decisions.filter(isRecord).map(item => item as Record<string, unknown>)
    : [];
  const latestBlockedNodes = latestContextSnapshot && Array.isArray(latestContextSnapshot.blocked_nodes)
    ? latestContextSnapshot.blocked_nodes.filter(isRecord).map(item => item as Record<string, unknown>)
    : [];
  const latestLockedNodes = latestContextSnapshot && Array.isArray(latestContextSnapshot.locked_nodes)
    ? latestContextSnapshot.locked_nodes.filter(isRecord).map(item => item as Record<string, unknown>)
    : [];
  const latestVisibilityDenials = latestContextSnapshot && Array.isArray(latestContextSnapshot.visibility_denials)
    ? latestContextSnapshot.visibility_denials.filter(isRecord).map(item => item as Record<string, unknown>)
    : [];
  const latestOverlayNodesLoaded = latestContextSnapshot && Array.isArray(latestContextSnapshot.overlay_nodes_loaded)
    ? latestContextSnapshot.overlay_nodes_loaded.filter(isRecord)
    : [];
  const latestOverlayNodesMutated = latestContextSnapshot && Array.isArray(latestContextSnapshot.overlay_nodes_mutated)
    ? latestContextSnapshot.overlay_nodes_mutated.filter(isRecord).map(item => item as Record<string, unknown>)
    : [];
  const latestMemoryBlocks = latestContextSnapshot && isRecord(latestContextSnapshot.memory_blocks)
    ? latestContextSnapshot.memory_blocks as Record<string, unknown>
    : null;
  const latestMemoryBlockMutations = latestContextSnapshot && Array.isArray(latestContextSnapshot.memory_block_mutations)
    ? latestContextSnapshot.memory_block_mutations.filter(isRecord).map(item => item as Record<string, unknown>)
    : [];
  const latestTraceMemoryMutations = latestTrace && isRecord(latestTrace.trace_metadata) && Array.isArray((latestTrace.trace_metadata as Record<string, unknown>).memory_mutations)
    ? (((latestTrace.trace_metadata as Record<string, unknown>).memory_mutations as unknown[]).filter(isRecord).map(item => item as Record<string, unknown>))
    : latestTrace && isRecord(latestTrace.trace_metadata) && isRecord((latestTrace.trace_metadata as Record<string, unknown>).memory_mutations) && Array.isArray(((latestTrace.trace_metadata as Record<string, unknown>).memory_mutations as Record<string, unknown>).records)
      ? ((((latestTrace.trace_metadata as Record<string, unknown>).memory_mutations as Record<string, unknown>).records as unknown[]).filter(isRecord).map(item => item as Record<string, unknown>))
      : [];
  const packEntity = packProjection.entities.find(entity => entity.id === resolvedAgentId) ?? null;
  const memoryCompactionState = await context.prisma.memoryCompactionState.findUnique({ where: { agent_id: resolvedAgentId } });

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
            entity_type: packEntity.entity_type ?? null,
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
      },
      latest_blocks: {
        evaluated: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.evaluated)
          ? latestMemoryBlocks.evaluated.filter(isRecord).map(item => item as Record<string, unknown>)
          : [],
        inserted: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.inserted)
          ? latestMemoryBlocks.inserted.filter((item): item is string => typeof item === 'string')
          : [],
        delayed: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.delayed)
          ? latestMemoryBlocks.delayed.filter((item): item is string => typeof item === 'string')
          : [],
        cooling: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.cooling)
          ? latestMemoryBlocks.cooling.filter((item): item is string => typeof item === 'string')
          : [],
        retained: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.retained)
          ? latestMemoryBlocks.retained.filter((item): item is string => typeof item === 'string')
          : [],
        inactive: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.inactive)
          ? latestMemoryBlocks.inactive.filter((item): item is string => typeof item === 'string')
          : [],
        mutations: latestMemoryBlockMutations
      }
    },
    context_governance: {
      latest_policy: {
        policy_decisions: latestPolicyDecisions,
        blocked_nodes: latestBlockedNodes,
        locked_nodes: latestLockedNodes,
        visibility_denials: latestVisibilityDenials
      },
      overlay: {
        count: latestOverlayNodesLoaded.length,
        latest_items: latestOverlayNodesLoaded.slice(0, limit).map(item => ({
          node_id: typeof item.node_id === 'string' ? item.node_id : '',
          overlay_id: typeof item.overlay_id === 'string' ? item.overlay_id : '',
          overlay_type: typeof item.overlay_type === 'string' ? item.overlay_type : 'self_note',
          persistence_mode: typeof item.persistence_mode === 'string' ? item.persistence_mode : 'sticky',
          created_by: item.created_by === 'agent' ? 'agent' : 'system',
          status: typeof item.status === 'string' ? item.status : 'active',
          preferred_slot: typeof item.preferred_slot === 'string' ? item.preferred_slot : null
        })),
        latest_mutations: latestOverlayNodesMutated.slice(0, limit)
      },
      memory_blocks: {
        evaluated: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.evaluated)
          ? latestMemoryBlocks.evaluated.filter(isRecord).map(item => item as Record<string, unknown>)
          : [],
        inserted: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.inserted)
          ? latestMemoryBlocks.inserted.filter((item): item is string => typeof item === 'string')
          : [],
        delayed: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.delayed)
          ? latestMemoryBlocks.delayed.filter((item): item is string => typeof item === 'string')
          : [],
        cooling: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.cooling)
          ? latestMemoryBlocks.cooling.filter((item): item is string => typeof item === 'string')
          : [],
        retained: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.retained)
          ? latestMemoryBlocks.retained.filter((item): item is string => typeof item === 'string')
          : [],
        inactive: latestMemoryBlocks && Array.isArray(latestMemoryBlocks.inactive)
          ? latestMemoryBlocks.inactive.filter((item): item is string => typeof item === 'string')
          : [],
        mutations: latestMemoryBlockMutations,
        compaction_state: memoryCompactionState
          ? {
              ...memoryCompactionState,
              updated_at_tick: memoryCompactionState.updated_at_tick.toString(),
              last_summary_tick: memoryCompactionState.last_summary_tick?.toString() ?? null,
              last_compaction_tick: memoryCompactionState.last_compaction_tick?.toString() ?? null
            }
          : null,
        latest_trace_memory_mutations: latestTraceMemoryMutations
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
