import type { AppContext } from '../../app/context.js';
import { enforceInvocationRequest } from '../rule/enforcement_engine.js';

export interface InvocationRequest {
  id: string;
  pack_id: string;
  source_action_intent_id: string;
  source_inference_id: string;
  invocation_type: string;
  capability_key: string | null;
  subject_entity_id: string | null;
  target_ref: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  mediator_id: string | null;
  actor_ref: Record<string, unknown>;
  created_at: bigint;
}

export interface InvocationDispatchResult {
  outcome: 'completed' | 'dropped';
  reason: string | null;
  invocation_request: InvocationRequest;
  rule_execution_id: string | null;
}

interface DispatchableActionIntentLike {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_ref: unknown;
  target_ref: unknown;
  payload: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const normalizeRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const resolveCapabilityKey = (intent: DispatchableActionIntentLike): string | null => {
  const payload = normalizeRecord(intent.payload);
  if (typeof payload.capability_key === 'string' && payload.capability_key.trim().length > 0) {
    return payload.capability_key.trim();
  }

  if (intent.intent_type.startsWith('invoke.')) {
    return intent.intent_type;
  }

  return null;
};

const resolveMediatorId = (intent: DispatchableActionIntentLike): string | null => {
  const payload = normalizeRecord(intent.payload);
  if (typeof payload.mediator_id === 'string' && payload.mediator_id.trim().length > 0) {
    return payload.mediator_id.trim();
  }

  const targetRef = normalizeRecord(intent.target_ref);
  if (typeof targetRef.mediator_id === 'string' && targetRef.mediator_id.trim().length > 0) {
    return targetRef.mediator_id.trim();
  }

  return null;
};

const resolveSubjectEntityId = (actorRef: Record<string, unknown>): string | null => {
  if (typeof actorRef.agent_id === 'string' && actorRef.agent_id.trim().length > 0) {
    return actorRef.agent_id.trim();
  }
  if (typeof actorRef.identity_id === 'string' && actorRef.identity_id.trim().length > 0) {
    return actorRef.identity_id.trim();
  }
  return null;
};

const shouldBridgeToInvocation = (context: AppContext, intent: DispatchableActionIntentLike): boolean => {
  const pack = context.sim.getActivePack();
  if (!pack) {
    return false;
  }

  const capabilityKey = resolveCapabilityKey(intent);
  if (capabilityKey && (pack.capabilities ?? []).some(capability => capability.key === capabilityKey)) {
    return true;
  }

  if (
    (pack.rules?.objective_enforcement ?? []).some(rule => {
      const when = isRecord(rule.when) ? rule.when : {};
      if (capabilityKey && when.capability === capabilityKey) {
        return true;
      }
      return typeof when.invocation_type === 'string' && when.invocation_type === intent.intent_type;
    })
  ) {
    return true;
  }

  return false;
};

export const buildInvocationRequestFromActionIntent = (
  context: AppContext,
  intent: DispatchableActionIntentLike
): InvocationRequest | null => {
  if (!shouldBridgeToInvocation(context, intent)) {
    return null;
  }

  const pack = context.sim.getActivePack();
  if (!pack) {
    return null;
  }

  const actorRef = normalizeRecord(intent.actor_ref);
  return {
    id: `${intent.id}:invocation`,
    pack_id: pack.metadata.id,
    source_action_intent_id: intent.id,
    source_inference_id: intent.source_inference_id,
    invocation_type: intent.intent_type,
    capability_key: resolveCapabilityKey(intent),
    subject_entity_id: resolveSubjectEntityId(actorRef),
    target_ref: isRecord(intent.target_ref) ? intent.target_ref : null,
    payload: normalizeRecord(intent.payload),
    mediator_id: resolveMediatorId(intent),
    actor_ref: actorRef,
    created_at: context.sim.getCurrentTick()
  };
};

export const dispatchInvocationFromActionIntent = async (
  context: AppContext,
  intent: DispatchableActionIntentLike
): Promise<InvocationDispatchResult | null> => {
  const invocationRequest = buildInvocationRequestFromActionIntent(context, intent);
  if (!invocationRequest) {
    return null;
  }

  const result = await enforceInvocationRequest(context, invocationRequest);
  return {
    outcome: 'completed',
    reason: null,
    invocation_request: invocationRequest,
    rule_execution_id: result.rule_execution_id
  };
};
