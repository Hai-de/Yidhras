import type { AppInfrastructure } from '../../app/context.js'
import { logOperatorAudit } from '../../operator/audit/logger.js'
import { AUDIT_ACTION } from '../../operator/constants.js'
import { resolveSubjectForAgentAction } from '../../operator/guard/subject_resolver.js'
import { enforceInvocationRequest } from '../rule/enforcement_engine.js'

/**
 * 请求级 subject 解析缓存。
 * 同一 tick 内同一 agent 的 subject 只解析一次（P3-2）。
 */
const subjectResolutionCache = new Map<
  string,
  { subjectEntityId: string; provenance: string; resolvedAt: bigint }
>()

export interface InvocationRequest {
  id: string
  pack_id: string
  source_action_intent_id: string
  source_inference_id: string
  invocation_type: string
  capability_key: string | null
  subject_entity_id: string | null
  target_ref: Record<string, unknown> | null
  payload: Record<string, unknown>
  mediator_id: string | null
  actor_ref: Record<string, unknown>
  created_at: bigint
}

export interface InvocationDispatchResult {
  outcome: 'completed' | 'dropped'
  reason: string | null
  invocation_request: InvocationRequest
  rule_execution_id: string | null
}

interface DispatchableActionIntentLike {
  id: string
  source_inference_id: string
  intent_type: string
  actor_ref: unknown
  target_ref: unknown
  payload: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const normalizeRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {}
}

const resolveCapabilityKey = (intent: DispatchableActionIntentLike): string | null => {
  const payload = normalizeRecord(intent.payload)
  if (typeof payload.capability_key === 'string' && payload.capability_key.trim().length > 0) {
    return payload.capability_key.trim()
  }

  if (intent.intent_type.startsWith('invoke.')) {
    return intent.intent_type
  }

  return null
}

const resolveMediatorId = (intent: DispatchableActionIntentLike): string | null => {
  const payload = normalizeRecord(intent.payload)
  if (typeof payload.mediator_id === 'string' && payload.mediator_id.trim().length > 0) {
    return payload.mediator_id.trim()
  }

  const targetRef = normalizeRecord(intent.target_ref)
  if (typeof targetRef.mediator_id === 'string' && targetRef.mediator_id.trim().length > 0) {
    return targetRef.mediator_id.trim()
  }

  return null
}

const resolveSubjectEntityId = async (
  context: AppInfrastructure,
  actorRef: Record<string, unknown>
): Promise<string | null> => {
  if (typeof actorRef.agent_id === 'string' && actorRef.agent_id.trim().length > 0) {
    const agentId = actorRef.agent_id.trim()

    // P3-1: Agent 自主行为 → 查找控制 Operator
    // 防御性：仅在 identityNodeBinding 可用时才执行 Operator 解析
    if (!(context.prisma as unknown as Record<string, unknown>)?.identityNodeBinding) {
      return agentId
    }

    const pack = context.activePack.getActivePack()
    const packId = pack?.metadata.id ?? 'default'
    const cacheKey = `${packId}:${agentId}`

    // P3-2: 缓存同一 tick 内的解析结果
    const cached = subjectResolutionCache.get(cacheKey)
    const now = context.clock.getCurrentTick()
    if (cached && cached.resolvedAt === now) {
      return cached.subjectEntityId
    }

    const resolution = await resolveSubjectForAgentAction(context, agentId, packId)
    subjectResolutionCache.set(cacheKey, {
      subjectEntityId: resolution.subjectEntityId ?? agentId,
      provenance: resolution.provenance,
      resolvedAt: now
    })

    return resolution.subjectEntityId ?? agentId
  }
  if (typeof actorRef.identity_id === 'string' && actorRef.identity_id.trim().length > 0) {
    return actorRef.identity_id.trim()
  }
  return null
}

const KERNEL_INTENT_TYPES = ['trigger_event', 'post_message', 'adjust_relationship', 'adjust_snr'] as const

const shouldBridgeToInvocation = (context: AppInfrastructure, intent: DispatchableActionIntentLike): boolean => {
  const pack = context.activePack.getActivePack()
  if (!pack) {
    return false
  }

  const capabilityKey = resolveCapabilityKey(intent)
  if (capabilityKey && (pack.capabilities ?? []).some(capability => capability.key === capabilityKey)) {
    return true
  }

  const enforcementRules = pack.rules?.objective_enforcement ?? []
  if (
    enforcementRules.some(rule => {
      const when = isRecord(rule.when) ? rule.when : {}
      if (capabilityKey && when.capability === capabilityKey) {
        return true
      }
      return typeof when.invocation_type === 'string' && when.invocation_type === intent.intent_type
    })
  ) {
    return true
  }

  const isKernelAction = KERNEL_INTENT_TYPES.includes(intent.intent_type as (typeof KERNEL_INTENT_TYPES)[number])
  if (!isKernelAction && !intent.intent_type.startsWith('invoke.')) {
    console.warn(
      `[invocation_dispatcher] intent_type '${intent.intent_type}' is not a kernel action and lacks 'invoke.' prefix. ` +
      `This intent will not bridge to objective enforcement. ` +
      `Ensure world pack rules use 'invoke.' prefixed invocation_type values.`
    )
  } else if (intent.intent_type.startsWith('invoke.') && !capabilityKey) {
    console.warn(
      `[invocation_dispatcher] intent_type '${intent.intent_type}' has 'invoke.' prefix but no matching capability key '${capabilityKey}' ` +
      `and no matching enforcement rule. The enforcement pipeline may not process this invocation.`
    )
  }

  return false
}

export const buildInvocationRequestFromActionIntent = async (
  context: AppInfrastructure,
  intent: DispatchableActionIntentLike
): Promise<InvocationRequest | null> => {
  if (!shouldBridgeToInvocation(context, intent)) {
    return null
  }

  const pack = context.activePack.getActivePack()
  if (!pack) {
    return null
  }

  const actorRef = normalizeRecord(intent.actor_ref)
  return {
    id: `${intent.id}:invocation`,
    pack_id: pack.metadata.id,
    source_action_intent_id: intent.id,
    source_inference_id: intent.source_inference_id,
    invocation_type: intent.intent_type,
    capability_key: resolveCapabilityKey(intent),
    subject_entity_id: await resolveSubjectEntityId(context, actorRef),
    target_ref: isRecord(intent.target_ref) ? intent.target_ref : null,
    payload: normalizeRecord(intent.payload),
    mediator_id: resolveMediatorId(intent),
    actor_ref: actorRef,
    created_at: context.clock.getCurrentTick()
  }
}

export const dispatchInvocationFromActionIntent = async (
  context: AppInfrastructure,
  intent: DispatchableActionIntentLike
): Promise<InvocationDispatchResult | null> => {
  const invocationRequest = await buildInvocationRequestFromActionIntent(context, intent)
  if (!invocationRequest) {
    return null
  }

  try {
    const result = await enforceInvocationRequest(context, invocationRequest)
    return {
      outcome: 'completed',
      reason: null,
      invocation_request: invocationRequest,
      rule_execution_id: result.rule_execution_id
    }
  } catch (error) {
    // P3-1: capability 拒绝 → ActionIntent 状态变为 dropped
    const message = error instanceof Error ? error.message : String(error)
    const isCapabilityDenied =
      message.includes('CAPABILITY_FORBIDDEN') ||
      message.includes('INVOCATION_CAPABILITY_FORBIDDEN')

    if (isCapabilityDenied) {
      await logOperatorAudit(context, {
        operator_id: null,
        pack_id: invocationRequest.pack_id,
        action: AUDIT_ACTION.CAPABILITY_DENIED,
        detail_json: {
          capability_key: invocationRequest.capability_key,
          subject_entity_id: invocationRequest.subject_entity_id,
          invocation_type: invocationRequest.invocation_type,
          source_action_intent_id: invocationRequest.source_action_intent_id
        }
      })

      return {
        outcome: 'dropped',
        reason: 'CAPABILITY_DENIED',
        invocation_request: invocationRequest,
        rule_execution_id: null
      }
    }

    throw error
  }
}
