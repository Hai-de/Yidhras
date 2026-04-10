import type { AppContext } from '../../app/context.js';
import type { IdentityContext } from '../../identity/types.js';
import type { InferenceActorRef, InferencePackStateSnapshot } from '../../inference/types.js';
import type {
  MemoryEvaluationContext,
  MemoryRecentSourceRecord
} from './types.js';

const RECENT_SOURCE_LIMIT = 10;
const MEMORY_POLICY_RESOURCE = 'memory';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const getAllowedFields = async (
  context: AppContext,
  identity: IdentityContext,
  action: 'read_recent_trace' | 'read_recent_intent' | 'read_recent_event',
  fields: string[],
  attributes: Record<string, unknown>
): Promise<Set<string>> => {
  const rules = await context.prisma.policy.findMany({
    where: {
      resource: MEMORY_POLICY_RESOURCE,
      action,
      OR: [
        { subject_id: identity.id },
        { subject_type: identity.type },
        { subject_type: '*' }
      ]
    }
  });

  const allowed = new Set<string>();
  const denied = new Set<string>();

  const matchesConditions = (conditions: unknown): boolean => {
    if (!isRecord(conditions) || Object.keys(conditions).length === 0) {
      return true;
    }

    for (const [key, expected] of Object.entries(conditions)) {
      if (attributes[key] !== expected) {
        return false;
      }
    }

    return true;
  };

  const sortedRules = [...rules].sort((left, right) => {
    const leftPriority = left.priority ?? 0;
    const rightPriority = right.priority ?? 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    if (left.effect !== right.effect) {
      return left.effect === 'deny' ? -1 : 1;
    }

    return 0;
  });

  const matchesField = (pattern: string, field: string): boolean => {
    if (pattern === '*') {
      return true;
    }

    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return field === prefix || field.startsWith(`${prefix}.`);
    }

    return pattern === field;
  };

  for (const field of fields) {
    for (const rule of sortedRules) {
      if (!matchesConditions(rule.conditions)) {
        continue;
      }
      if (!matchesField(rule.field, field)) {
        continue;
      }

      if (rule.effect === 'deny') {
        denied.add(field);
      } else {
        allowed.add(field);
      }
      break;
    }
  }

  return new Set(Array.from(allowed).filter(field => !denied.has(field)));
};

const pickAllowedFields = (record: Record<string, unknown>, allowedFields: Set<string>): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowedFields.has(key)));
};

const buildTraceRecentRecord = async (input: {
  context: AppContext;
  identity: IdentityContext;
  actor_ref: InferenceActorRef;
  resolved_agent_id: string | null;
}): Promise<MemoryRecentSourceRecord[]> => {
  const agentId = input.resolved_agent_id;
  if (!agentId) {
    return [];
  }

  const traces = await input.context.prisma.inferenceTrace.findMany({
    orderBy: [{ updated_at: 'desc' }],
    take: RECENT_SOURCE_LIMIT * 3
  });

  const allowedFields = await getAllowedFields(
    input.context,
    input.identity,
    'read_recent_trace',
    ['id', 'strategy', 'provider', 'decision', 'reasoning', 'updated_at'],
    {
      requested_agent_id: agentId,
      owner_agent_id: agentId,
      same_agent_only: true
    }
  );

  return traces
    .filter(trace => {
      const actorRef = isRecord(trace.actor_ref) ? trace.actor_ref : null;
      return actorRef && typeof actorRef.agent_id === 'string' && actorRef.agent_id === agentId;
    })
    .slice(0, RECENT_SOURCE_LIMIT)
    .map(trace => {
      const decision = isRecord(trace.decision) ? trace.decision : null;
      const payload: Record<string, unknown> = {
        id: trace.id,
        strategy: trace.strategy,
        provider: trace.provider,
        updated_at: trace.updated_at.toString(),
        decision,
        reasoning: decision && typeof decision.reasoning === 'string' ? decision.reasoning : null
      };

      return {
        id: trace.id,
        kind: 'trace',
        payload: pickAllowedFields(payload, allowedFields),
        occurred_at_tick: trace.updated_at.toString()
      };
    });
};

const buildIntentRecentRecord = async (input: {
  context: AppContext;
  identity: IdentityContext;
  actor_ref: InferenceActorRef;
  resolved_agent_id: string | null;
}): Promise<MemoryRecentSourceRecord[]> => {
  const agentId = input.resolved_agent_id;
  if (!agentId) {
    return [];
  }

  const intents = await input.context.prisma.actionIntent.findMany({
    orderBy: [{ updated_at: 'desc' }],
    take: RECENT_SOURCE_LIMIT * 3
  });

  const allowedFields = await getAllowedFields(
    input.context,
    input.identity,
    'read_recent_intent',
    ['id', 'intent_type', 'status', 'drop_reason', 'dispatch_error_message', 'updated_at'],
    {
      requested_agent_id: agentId,
      owner_agent_id: agentId,
      same_agent_only: true
    }
  );

  return intents
    .filter(intent => {
      const actorRef = isRecord(intent.actor_ref) ? intent.actor_ref : null;
      return actorRef && typeof actorRef.agent_id === 'string' && actorRef.agent_id === agentId;
    })
    .slice(0, RECENT_SOURCE_LIMIT)
    .map(intent => {
      const payload: Record<string, unknown> = {
        id: intent.id,
        intent_type: intent.intent_type,
        status: intent.status,
        drop_reason: intent.drop_reason,
        dispatch_error_message: intent.dispatch_error_message,
        updated_at: intent.updated_at.toString()
      };

      return {
        id: intent.id,
        kind: 'intent',
        payload: pickAllowedFields(payload, allowedFields),
        occurred_at_tick: intent.updated_at.toString()
      };
    });
};

const buildEventRecentRecord = async (input: {
  context: AppContext;
  identity: IdentityContext;
  actor_ref: InferenceActorRef;
  resolved_agent_id: string | null;
}): Promise<MemoryRecentSourceRecord[]> => {
  const agentId = input.resolved_agent_id;
  if (!agentId) {
    return [];
  }

  const events = await input.context.prisma.event.findMany({
    orderBy: [{ tick: 'desc' }],
    take: RECENT_SOURCE_LIMIT * 3,
    include: {
      source_action_intent: {
        select: {
          actor_ref: true
        }
      }
    }
  });

  const allowedFields = await getAllowedFields(
    input.context,
    input.identity,
    'read_recent_event',
    ['id', 'title', 'description', 'type', 'impact_data', 'tick', 'semantic_type'],
    {
      requested_agent_id: agentId,
      owner_agent_id: agentId,
      same_agent_only: true
    }
  );

  return events
    .filter(event => {
      const actorRef = event.source_action_intent && isRecord(event.source_action_intent.actor_ref)
        ? event.source_action_intent.actor_ref
        : null;
      return actorRef && typeof actorRef.agent_id === 'string' && actorRef.agent_id === agentId;
    })
    .slice(0, RECENT_SOURCE_LIMIT)
    .map(event => {
      let impactData: Record<string, unknown> | null = null;
      if (typeof event.impact_data === 'string' && event.impact_data.trim().length > 0) {
        try {
          const parsed = JSON.parse(event.impact_data) as unknown;
          if (isRecord(parsed)) {
            impactData = parsed;
          }
        } catch {
          impactData = null;
        }
      }

      const payload: Record<string, unknown> = {
        id: event.id,
        title: event.title,
        description: event.description,
        type: event.type,
        impact_data: impactData,
        tick: event.tick.toString(),
        semantic_type: impactData && typeof impactData.semantic_type === 'string' ? impactData.semantic_type : null
      };

      return {
        id: event.id,
        kind: 'event',
        payload: pickAllowedFields(payload, allowedFields),
        occurred_at_tick: event.tick.toString()
      };
    });
};

const toPackStateSnapshot = (packState: InferencePackStateSnapshot): MemoryEvaluationContext['pack_state'] => {
  return {
    actor_state: packState.actor_state,
    world_state: packState.world_state,
    latest_event: packState.latest_event ? {
      event_id: packState.latest_event.event_id,
      title: packState.latest_event.title,
      type: packState.latest_event.type,
      semantic_type: packState.latest_event.semantic_type,
      created_at: packState.latest_event.created_at
    } : null
  };
};

export const buildMemoryEvaluationContext = async (input: {
  context: AppContext;
  actor_ref: InferenceActorRef;
  identity: IdentityContext;
  resolved_agent_id: string | null;
  pack_id: string;
  tick: bigint;
  attributes: Record<string, unknown>;
  pack_state: InferencePackStateSnapshot;
}): Promise<MemoryEvaluationContext> => {
  const [trace, intent, event] = await Promise.all([
    buildTraceRecentRecord(input),
    buildIntentRecentRecord(input),
    buildEventRecentRecord(input)
  ]);

  return {
    actor_ref: input.actor_ref,
    resolved_agent_id: input.resolved_agent_id,
    pack_id: input.pack_id,
    current_tick: input.tick.toString(),
    attributes: input.attributes,
    pack_state: toPackStateSnapshot(input.pack_state),
    recent: {
      trace,
      intent,
      event
    }
  };
}
