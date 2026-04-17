import type { InferenceJobIntentClass } from '../../../inference/types.js';
import type { AppContext } from '../../context.js';
import { isRecord } from './types.js';

export const listActiveSchedulerAgents = async (
  context: AppContext,
  limit = 10
): Promise<Array<{ id: string }>> => {
  return context.prisma.agent.findMany({
    where: {
      type: 'active'
    },
    select: {
      id: true
    },
    orderBy: {
      created_at: 'asc'
    },
    take: limit
  });
};

export const listPendingSchedulerDecisionJobs = async (
  context: AppContext,
  agentIds: string[]
): Promise<Set<string>> => {
  if (agentIds.length === 0) {
    return new Set();
  }

  const jobs = await context.prisma.decisionJob.findMany({
    where: {
      status: {
        in: ['pending', 'running']
      },
      idempotency_key: {
        startsWith: 'sch:'
      }
    },
    select: {
      idempotency_key: true,
      request_input: true
    }
  });

  const agentIdSet = new Set(agentIds);
  return new Set(
    jobs.flatMap(job => {
      if (typeof job.idempotency_key !== 'string' || !job.idempotency_key.startsWith('sch:')) {
        return [];
      }
      const requestInput = isRecord(job.request_input) ? job.request_input : null;
      const agentId = requestInput && typeof requestInput.agent_id === 'string' ? requestInput.agent_id : null;
      return agentId && agentIdSet.has(agentId) ? [agentId] : [];
    })
  );
};

export const listPendingSchedulerActionIntents = async (
  context: AppContext,
  agentIds: string[]
): Promise<Set<string>> => {
  if (agentIds.length === 0) {
    return new Set();
  }

  const intents = await context.prisma.actionIntent.findMany({
    where: {
      status: {
        in: ['pending', 'dispatching']
      },
      source_inference_id: {
        startsWith: 'sch:'
      }
    },
    select: {
      source_inference_id: true,
      actor_ref: true
    }
  });

  const agentIdSet = new Set(agentIds);
  return new Set(
    intents.flatMap(intent => {
      if (
        typeof intent.source_inference_id !== 'string' ||
        !intent.source_inference_id.startsWith('sch:')
      ) {
        return [];
      }
      const actorRef = isRecord(intent.actor_ref) ? intent.actor_ref : null;
      const agentId = actorRef && typeof actorRef.agent_id === 'string' ? actorRef.agent_id : null;
      return agentId && agentIdSet.has(agentId) ? [agentId] : [];
    })
  );
};

export const listRecentScheduledDecisionJobs = async (
  context: AppContext,
  agentIds: string[]
): Promise<Map<string, bigint>> => {
  if (agentIds.length === 0) {
    return new Map();
  }

  const jobs = await context.prisma.decisionJob.findMany({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    },
    select: {
      request_input: true,
      created_at: true
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  const recentTicks = new Map<string, bigint>();
  const agentIdSet = new Set(agentIds);
  for (const job of jobs) {
    const requestInput = isRecord(job.request_input) ? job.request_input : null;
    const agentId = requestInput && typeof requestInput.agent_id === 'string' ? requestInput.agent_id : null;
    if (agentId && agentIdSet.has(agentId) && !recentTicks.has(agentId)) {
      recentTicks.set(agentId, job.created_at);
    }
  }

  return recentTicks;
};

export const listRecentRecoveryWindowActors = async (
  context: AppContext,
  sinceTick: bigint,
  intentClasses: InferenceJobIntentClass[],
  untilTick?: bigint
): Promise<Map<string, bigint>> => {
  if (intentClasses.length === 0) {
    return new Map();
  }

  const jobs = await context.prisma.decisionJob.findMany({
    where: {
      intent_class: {
        in: intentClasses
      },
      created_at: {
        gte: sinceTick,
        ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {})
      }
    },
    select: {
      request_input: true,
      created_at: true
    }
  });

  const latestByActor = new Map<string, bigint>();
  for (const job of jobs) {
    const requestInput = isRecord(job.request_input) ? job.request_input : null;
    const agentId = requestInput && typeof requestInput.agent_id === 'string' ? requestInput.agent_id : null;
    if (!agentId) {
      continue;
    }
    if (!latestByActor.has(agentId) || job.created_at > (latestByActor.get(agentId) ?? sinceTick)) {
      latestByActor.set(agentId, job.created_at);
    }
  }

  return latestByActor;
};

export const getLatestSchedulerSignalTick = async (
  context: AppContext,
  sinceTick: bigint,
  untilTick?: bigint
): Promise<bigint | null> => {
  const [latestEvent, latestRelationshipLog, latestSnrLog, latestRecoveryJob, latestOverlay, latestMemoryBlock] = await Promise.all([
    context.prisma.event.findFirst({ where: { created_at: { gte: sinceTick, ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {}) }, source_action_intent_id: { not: null } }, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
    context.prisma.relationshipAdjustmentLog.findFirst({ where: { created_at: { gte: sinceTick, ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {}) } }, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
    context.prisma.sNRAdjustmentLog.findFirst({ where: { created_at: { gte: sinceTick, ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {}) } }, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
    context.prisma.decisionJob.findFirst({ where: { created_at: { gte: sinceTick, ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {}) }, intent_class: { in: ['replay_recovery', 'retry_recovery'] } }, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
    context.prisma.contextOverlayEntry.findFirst({ where: { updated_at_tick: { gte: sinceTick, ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {}) } }, orderBy: { updated_at_tick: 'desc' }, select: { updated_at_tick: true } }),
    context.prisma.memoryBlock.findFirst({ where: { updated_at_tick: { gte: sinceTick, ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {}) } }, orderBy: { updated_at_tick: 'desc' }, select: { updated_at_tick: true } })
  ]);

  return [
    latestEvent?.created_at,
    latestRelationshipLog?.created_at,
    latestSnrLog?.created_at,
    latestRecoveryJob?.created_at,
    latestOverlay?.updated_at_tick,
    latestMemoryBlock?.updated_at_tick
  ].reduce<bigint | null>(
    (latest, current) => (typeof current === 'bigint' && (latest === null || current > latest) ? current : latest),
    null
  );
};

export const listRecentEventFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint,
  untilTick?: bigint
): Promise<Array<{ agent_id: string; reason: 'event_followup'; created_at: bigint }>> => {
  const parseImpactData = (value: unknown): Record<string, unknown> | null => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const events = await context.prisma.event.findMany({
    where: {
      created_at: {
        gte: sinceTick,
        ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {})
      },
      source_action_intent_id: {
        not: null
      }
    },
    include: {
      source_action_intent: {
        select: {
          actor_ref: true
        }
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  return events.flatMap(event => {
    const actorRef = event.source_action_intent && isRecord(event.source_action_intent.actor_ref)
      ? event.source_action_intent.actor_ref
      : null;
    const impactData = parseImpactData(event.impact_data);
    const followupActorIds = Array.isArray(impactData?.followup_actor_ids)
      ? impactData.followup_actor_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const semanticIntent = impactData && isRecord(impactData.semantic_intent) ? impactData.semantic_intent : null;
    const semanticTargetRef = semanticIntent && isRecord(semanticIntent.target_ref) ? semanticIntent.target_ref : null;
    const semanticTargetAgentId = semanticTargetRef && typeof semanticTargetRef.agent_id === 'string'
      ? semanticTargetRef.agent_id.trim()
      : null;

    const candidateAgentIds = new Set<string>();
    if (actorRef && typeof actorRef.agent_id === 'string' && actorRef.agent_id.trim().length > 0) {
      candidateAgentIds.add(actorRef.agent_id.trim());
    }
    if (semanticTargetAgentId) {
      candidateAgentIds.add(semanticTargetAgentId);
    }
    for (const agentId of followupActorIds) {
      candidateAgentIds.add(agentId.trim());
    }

    return Array.from(candidateAgentIds).map(agent_id => ({
      agent_id,
      reason: 'event_followup' as const,
      created_at: event.created_at
    }));
  });
};

export const listRecentRelationshipFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint,
  untilTick?: bigint
): Promise<Array<{ agent_id: string; reason: 'relationship_change_followup'; created_at: bigint }>> => {
  const logs = await context.prisma.relationshipAdjustmentLog.findMany({
    where: {
      created_at: {
        gte: sinceTick,
        ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {})
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  return logs.flatMap(log => [
    { agent_id: log.from_id, reason: 'relationship_change_followup' as const, created_at: log.created_at },
    { agent_id: log.to_id, reason: 'relationship_change_followup' as const, created_at: log.created_at }
  ]);
};

export const listRecentSnrFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint,
  untilTick?: bigint
): Promise<Array<{ agent_id: string; reason: 'snr_change_followup'; created_at: bigint }>> => {
  const logs = await context.prisma.sNRAdjustmentLog.findMany({
    where: {
      created_at: {
        gte: sinceTick,
        ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {})
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  return logs.map(log => ({
    agent_id: log.agent_id,
    reason: 'snr_change_followup' as const,
    created_at: log.created_at
  }));
};

export const listRecentOverlayFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint,
  untilTick?: bigint
): Promise<Array<{ agent_id: string; reason: 'overlay_change_followup'; created_at: bigint }>> => {
  const overlays = await context.prisma.contextOverlayEntry.findMany({
    where: {
      updated_at_tick: {
        gte: sinceTick,
        ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {})
      }
    },
    orderBy: {
      updated_at_tick: 'desc'
    }
  });

  return overlays
    .filter(entry => typeof entry.actor_id === 'string' && entry.actor_id.trim().length > 0)
    .map(entry => ({
      agent_id: entry.actor_id.trim(),
      reason: 'overlay_change_followup' as const,
      created_at: entry.updated_at_tick
    }));
};

export const listRecentMemoryBlockFollowupSignals = async (
  context: AppContext,
  sinceTick: bigint,
  untilTick?: bigint
): Promise<Array<{ agent_id: string; reason: 'memory_change_followup'; created_at: bigint }>> => {
  const blocks = await context.prisma.memoryBlock.findMany({
    where: {
      updated_at_tick: {
        gte: sinceTick,
        ...(typeof untilTick === 'bigint' ? { lte: untilTick } : {})
      }
    },
    orderBy: {
      updated_at_tick: 'desc'
    }
  });

  return blocks.map(block => ({ agent_id: block.owner_agent_id, reason: 'memory_change_followup' as const, created_at: block.updated_at_tick }));
};
