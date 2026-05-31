import { getOperatorOverviewProjection } from '../../../kernel/projections/operator_overview_service.js';
import { extractGlobalProjectionIndex } from '../../../kernel/projections/projection_extractor.js';
import type { DataContext, PortContext, RuntimeContext } from '../../context.js';
import { toJsonSafe } from '../../http/json.js';
import { readVisibleClockSnapshot } from '../app_context_ports.js';
import type { AuditViewEntry } from '../audit/audit.js';
import { listAuditFeed } from '../audit/audit.js';

export interface OverviewSummarySnapshot {
  runtime: {
    status: 'paused' | 'running';
    runtime_ready: boolean;
    runtime_speed: Record<string, unknown>;
    health_level: RuntimeContext['startupHealth']['level'];
    world_pack:
      | {
          id: string;
          name: string;
          version: string;
        }
      | null;
    has_error: boolean;
    startup_errors: string[];
  };
  world_time: {
    tick: string;
    calendars: unknown;
  };
  active_agent_count: number;
  recent_events: AuditViewEntry[];
  latest_posts: AuditViewEntry[];
  latest_propagation: AuditViewEntry[];
  failed_jobs: AuditViewEntry[];
  dropped_intents: AuditViewEntry[];
  notifications: ReturnType<RuntimeContext['notifications']['getMessages']>;
  operator_projection: Awaited<ReturnType<typeof getOperatorOverviewProjection>>['pack_projection'];
  global_projection_index: Awaited<ReturnType<typeof extractGlobalProjectionIndex>>;
}

export interface PackOverviewProjectionSummary {
  pack_id: string;
  entity_count: number;
  entity_state_count: number;
  authority_grant_count: number;
  mediator_binding_count: number;
  rule_execution_count: number;
  latest_rule_execution: {
    id: string;
    rule_id: string;
    execution_status: string;
    created_at: string;
  } | null;
}

const isWorkflowEntry = (entry: AuditViewEntry): boolean => {
  return entry.kind === 'workflow';
};

const hasFailureState = (entry: AuditViewEntry): boolean => {
  return isWorkflowEntry(entry) && entry.data['workflow_state'] === 'workflow_failed';
};

const hasDroppedState = (entry: AuditViewEntry): boolean => {
  return isWorkflowEntry(entry) && entry.data['workflow_state'] === 'workflow_dropped';
};

const hasPropagationIntent = (entry: AuditViewEntry): boolean => {
  if (!isWorkflowEntry(entry)) {
    return false;
  }

  const intentType = typeof entry.data['intent_type'] === 'string' ? entry.data['intent_type'] : null;
  return intentType === 'post_message';
};

const readProjectedWorldTime = (context: DataContext & RuntimeContext & PortContext, packId?: string): { tick: string; calendars: unknown } => {
// @ts-expect-error -- EOPT strict mode
  const visibleClock = readVisibleClockSnapshot({ runtimeClockProjection: context.runtimeClockProjection, packId });

  return {
    tick: visibleClock.absolute_ticks,
    calendars: context.isRuntimeReady() ? toJsonSafe(visibleClock.calendars) : []
  };
};

export const getOverviewSummary = async (context: DataContext & RuntimeContext & PortContext, packId?: string): Promise<OverviewSummarySnapshot> => {
  const worldTime = readProjectedWorldTime(context, packId);

  const [operatorProjection, globalProjectionIndex, activeAgentCount, notifications, recentAudit, latestEvents, latestPosts] = await Promise.all([
// @ts-expect-error -- EOPT strict mode
    getOperatorOverviewProjection(context, { packId }),
    extractGlobalProjectionIndex(context, packId),
    context.repos.agent.countActiveAgents(),
    Promise.resolve(context.notifications.getMessages()),
    listAuditFeed(context, {
      limit: 50,
      kinds: ['workflow']
    }),
    listAuditFeed(context, {
      limit: 10,
      kinds: ['event']
    }),
    listAuditFeed(context, {
      limit: 10,
      kinds: ['post']
    })
  ]);

  const workflowEntries = recentAudit.entries.filter(isWorkflowEntry);

  return {
    runtime: operatorProjection.runtime,
    world_time: worldTime,
    active_agent_count: activeAgentCount,
    recent_events: latestEvents.entries,
    latest_posts: latestPosts.entries,
    latest_propagation: workflowEntries.filter(hasPropagationIntent).slice(0, 10),
    failed_jobs: workflowEntries.filter(hasFailureState).slice(0, 10),
    dropped_intents: workflowEntries.filter(hasDroppedState).slice(0, 10),
    notifications,
    operator_projection: operatorProjection.pack_projection,
    global_projection_index: globalProjectionIndex
  };
};

export const getPackOverviewProjectionSummary = async (
  context: DataContext & RuntimeContext & PortContext,
  packId: string
): Promise<PackOverviewProjectionSummary> => {
  const projection = await getOperatorOverviewProjection(context, {
    packId,
    feature: 'pack overview'
  });

  return {
    pack_id: packId,
    ...projection.pack_projection
  };
};
