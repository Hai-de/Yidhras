import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';
import type { AuditViewEntry } from './audit.js';
import { listAuditFeed } from './audit.js';
import { getRuntimeStatusSnapshot } from './system.js';

export interface OverviewSummarySnapshot {
  runtime: {
    status: 'paused' | 'running';
    runtime_ready: boolean;
    runtime_speed: ReturnType<AppContext['sim']['getRuntimeSpeedSnapshot']>;
    health_level: AppContext['startupHealth']['level'];
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
  notifications: ReturnType<AppContext['notifications']['getMessages']>;
}

const isWorkflowEntry = (entry: AuditViewEntry): boolean => {
  return entry.kind === 'workflow';
};

const hasFailureState = (entry: AuditViewEntry): boolean => {
  return isWorkflowEntry(entry) && entry.data.workflow_state === 'workflow_failed';
};

const hasDroppedState = (entry: AuditViewEntry): boolean => {
  return isWorkflowEntry(entry) && entry.data.workflow_state === 'workflow_dropped';
};

const hasPropagationIntent = (entry: AuditViewEntry): boolean => {
  if (!isWorkflowEntry(entry)) {
    return false;
  }

  const intentType = typeof entry.data.intent_type === 'string' ? entry.data.intent_type : null;
  return intentType === 'post_message';
};

export const getOverviewSummary = async (context: AppContext): Promise<OverviewSummarySnapshot> => {
  const runtime = getRuntimeStatusSnapshot(context);
  const currentTick = context.sim.clock.getTicks();

  const [activeAgentCount, notifications, recentAudit, latestEvents, latestPosts] = await Promise.all([
    context.prisma.agent.count({
      where: {
        type: 'active'
      }
    }),
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
    runtime,
    world_time: {
      tick: currentTick.toString(),
      calendars: context.getRuntimeReady() ? toJsonSafe(context.sim.clock.getAllTimes()) : []
    },
    active_agent_count: activeAgentCount,
    recent_events: latestEvents.entries,
    latest_posts: latestPosts.entries,
    latest_propagation: workflowEntries.filter(hasPropagationIntent).slice(0, 10),
    failed_jobs: workflowEntries.filter(hasFailureState).slice(0, 10),
    dropped_intents: workflowEntries.filter(hasDroppedState).slice(0, 10),
    notifications
  };
};
