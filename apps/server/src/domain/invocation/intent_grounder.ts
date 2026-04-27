import type { AppInfrastructure } from '../../app/context.js';
import type { ActorResolvable, DecisionResult, InferenceContext, PackStateResolvable } from '../../inference/types.js';
import { resolveAuthorityForSubject } from '../authority/resolver.js';

export type IntentGroundingResolutionMode = 'exact' | 'translated' | 'narrativized' | 'blocked';

export interface SemanticIntentSnapshot {
  kind: string | null;
  text: string | null;
  desired_effect: string | null;
  proposed_method: string | null;
  target_ref: Record<string, unknown> | null;
}

export interface IntentGroundingSnapshot {
  resolution_mode: IntentGroundingResolutionMode;
  affordance_key: string | null;
  required_capability_key: string | null;
  explanation: string | null;
  objective_effect_applied: boolean;
  failure_kind: 'failed_attempt' | 'blocked' | null;
}

export interface GroundedDecisionResult {
  decision: DecisionResult;
  semantic_intent: SemanticIntentSnapshot;
  grounding: IntentGroundingSnapshot;
}

interface InvocationRuleRecord {
  id: string;
  when: Record<string, unknown>;
  then: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  return isRecord(value) ? value : null;
};

const buildSemanticIntentFromDecision = (decision: DecisionResult): SemanticIntentSnapshot => {
  const semanticIntent = isRecord(decision.meta?.semantic_intent) ? decision.meta?.semantic_intent : null;
  return {
    kind: toNullableString(semanticIntent?.kind) ?? toNullableString(decision.payload.semantic_intent_kind),
    text: toNullableString(semanticIntent?.text) ?? toNullableString(decision.reasoning),
    desired_effect:
      toNullableString(semanticIntent?.desired_effect) ?? toNullableString(decision.payload.semantic_intent_desired_effect),
    proposed_method:
      toNullableString(semanticIntent?.proposed_method) ?? toNullableString(decision.payload.semantic_intent_proposed_method),
    target_ref: toRecord(semanticIntent?.target_ref) ?? decision.target_ref
  };
};

const getWorldPackInvocationRules = (context: PackStateResolvable): InvocationRuleRecord[] => {
  const runtimeRules = (context.pack_runtime as Record<string, unknown> | null)?.invocation_rules;
  if (!Array.isArray(runtimeRules)) {
    return [];
  }

  return runtimeRules.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string') {
      return [];
    }

    return [{
      id: item.id,
      when: isRecord(item.when) ? item.when : {},
      then: isRecord(item.then) ? item.then : {}
    } satisfies InvocationRuleRecord];
  });
};

const matchesSemanticIntent = (rule: InvocationRuleRecord, semanticIntent: SemanticIntentSnapshot): boolean => {
  const expectedKind = toNullableString(rule.when['semantic_intent.kind']);
  if (expectedKind && expectedKind !== semanticIntent.kind) {
    return false;
  }

  const expectedDesiredEffect = toNullableString(rule.when['semantic_intent.desired_effect']);
  if (expectedDesiredEffect && expectedDesiredEffect !== semanticIntent.desired_effect) {
    return false;
  }

  const targetCondition = toNullableString(rule.when['semantic_intent.target.kind']);
  if (targetCondition) {
    const targetRef = semanticIntent.target_ref;
    const targetKind =
      toNullableString(targetRef?.kind) ??
      (typeof targetRef?.agent_id === 'string' || typeof targetRef?.entity_id === 'string' ? 'actor' : null);
    if (targetCondition !== targetKind) {
      return false;
    }
  }

  return true;
};

const hasCapability = async (
  context: AppInfrastructure,
  actorContext: ActorResolvable & PackStateResolvable,
  capabilityKey: string | null
): Promise<boolean> => {
  if (!capabilityKey) {
    return false;
  }

  const authority = await resolveAuthorityForSubject(context, {
    packId: actorContext.world_pack.id,
    subjectEntityId: actorContext.resolved_agent_id
  });
  return authority.resolved_capabilities.some(item => item.capability_key === capabilityKey);
};

const buildNarrativizedDecision = (
  semanticIntent: SemanticIntentSnapshot,
  grounding: IntentGroundingSnapshot,
  sourceDecision: DecisionResult,
  narrativizeEvent: Record<string, unknown> | null
): DecisionResult => {
  const eventType = toNullableString(narrativizeEvent?.type) ?? 'history';
  const title = toNullableString(narrativizeEvent?.title) ?? '发生了一次失败但真实存在的尝试';
  const description =
    toNullableString(narrativizeEvent?.description) ??
    semanticIntent.text ??
    sourceDecision.reasoning ??
    '该行为没有产生客观效果，但已被系统记录。';
  const impactData = isRecord(narrativizeEvent?.impact_data) ? narrativizeEvent?.impact_data : {};

  return {
    action_type: 'trigger_event',
    target_ref: semanticIntent.target_ref,
    payload: {
      event_type: eventType,
      title,
      description,
      impact_data: {
        ...impactData,
        semantic_type: toNullableString(impactData.semantic_type) ?? semanticIntent.kind ?? 'narrativized_attempt',
        failed_attempt: true,
        objective_effect_applied: false,
        grounding_mode: grounding.resolution_mode,
        semantic_intent: {
          kind: semanticIntent.kind,
          text: semanticIntent.text,
          desired_effect: semanticIntent.desired_effect,
          proposed_method: semanticIntent.proposed_method,
          target_ref: semanticIntent.target_ref
        },
        intent_grounding: grounding
      }
    },
    confidence: sourceDecision.confidence,
    delay_hint_ticks: sourceDecision.delay_hint_ticks,
    reasoning: sourceDecision.reasoning,
    meta: {
      ...(sourceDecision.meta ?? {}),
      semantic_intent: {
        kind: semanticIntent.kind,
        text: semanticIntent.text,
        desired_effect: semanticIntent.desired_effect,
        proposed_method: semanticIntent.proposed_method,
        target_ref: semanticIntent.target_ref
      },
      intent_grounding: grounding,
      objective_effect_applied: false,
      semantic_outcome: 'failed_attempt'
    }
  };
};

const buildRewrittenDecision = (
  sourceDecision: DecisionResult,
  semanticIntent: SemanticIntentSnapshot,
  grounding: IntentGroundingSnapshot,
  actionType: string,
  targetRef: Record<string, unknown> | null,
  payloadPatch: Record<string, unknown>
): DecisionResult => ({
  ...sourceDecision,
  action_type: actionType,
  target_ref: targetRef,
  payload: {
    ...sourceDecision.payload,
    ...payloadPatch,
    intent_grounding: grounding,
    semantic_intent: semanticIntent,
    objective_effect_applied: grounding.objective_effect_applied
  },
  meta: {
    ...(sourceDecision.meta ?? {}),
    semantic_intent: {
      kind: semanticIntent.kind,
      text: semanticIntent.text,
      desired_effect: semanticIntent.desired_effect,
      proposed_method: semanticIntent.proposed_method,
      target_ref: semanticIntent.target_ref
    },
    intent_grounding: grounding,
    objective_effect_applied: grounding.objective_effect_applied,
    semantic_outcome: grounding.failure_kind ?? 'resolved'
  }
});

export const groundDecisionIntent = async (
  context: AppInfrastructure,
  inferenceContext: InferenceContext,
  decision: DecisionResult
): Promise<GroundedDecisionResult> => {
  const directAction = decision.action_type.trim();
  const semanticIntent = buildSemanticIntentFromDecision(decision);
  const invocationRules = getWorldPackInvocationRules(inferenceContext);
  const isDirectKernelAction =
    directAction === 'trigger_event' ||
    directAction === 'post_message' ||
    directAction === 'adjust_relationship' ||
    directAction === 'adjust_snr';

  if (directAction.startsWith('invoke.') || isDirectKernelAction) {
    return {
      decision: buildRewrittenDecision(
        decision,
        semanticIntent,
        {
          resolution_mode: 'exact',
          affordance_key: null,
          required_capability_key:
            directAction.startsWith('invoke.')
              ? directAction
              : isDirectKernelAction
                ? directAction
                : null,
          explanation: 'Direct action passthrough',
          objective_effect_applied: directAction.startsWith('invoke.') || directAction === 'adjust_relationship' || directAction === 'adjust_snr',
          failure_kind: null
        },
        decision.action_type,
        decision.target_ref,
        {}
      ),
      semantic_intent: semanticIntent,
      grounding: {
        resolution_mode: 'exact',
        affordance_key: null,
        required_capability_key:
          directAction.startsWith('invoke.')
            ? directAction
            : isDirectKernelAction
              ? directAction
              : null,
        explanation: 'Direct action passthrough',
        objective_effect_applied:
          directAction.startsWith('invoke.') ||
          directAction === 'adjust_relationship' ||
          directAction === 'adjust_snr',
        failure_kind: null
      }
    };
  }

  const matchedRule = invocationRules.find(rule => matchesSemanticIntent(rule, semanticIntent)) ?? null;
  if (!matchedRule) {
    const grounding: IntentGroundingSnapshot = {
      resolution_mode: 'narrativized',
      affordance_key: null,
      required_capability_key: null,
      explanation: 'No invocation rule matched semantic intent; fallback to narrativized failure.',
      objective_effect_applied: false,
      failure_kind: 'failed_attempt'
    };
    return {
      decision: buildNarrativizedDecision(semanticIntent, grounding, decision, null),
      semantic_intent: semanticIntent,
      grounding
    };
  }

  const then = matchedRule.then;
  const resolutionMode =
    (toNullableString(then.resolution_mode) as IntentGroundingResolutionMode | null) ?? 'exact';
  const affordanceKey = toNullableString(then.affordance_key);
  const requiredCapabilityKey = toNullableString(then.requires_capability);
  const translateToCapability = toNullableString(then.translate_to_capability);
  const translateToKernelIntent = toNullableString(then.translate_to_kernel_intent);
  const mediatorId = toNullableString(then.mediator_id);
  const explanation = toNullableString(then.explanation);

  const capabilitySatisfied = await hasCapability(context, inferenceContext, requiredCapabilityKey ?? translateToCapability);

  if ((resolutionMode === 'exact' || resolutionMode === 'translated') && capabilitySatisfied && translateToCapability) {
    const grounding: IntentGroundingSnapshot = {
      resolution_mode: resolutionMode,
      affordance_key: affordanceKey,
      required_capability_key: requiredCapabilityKey ?? translateToCapability,
      explanation,
      objective_effect_applied: true,
      failure_kind: null
    };
    const targetRef = semanticIntent.target_ref ?? decision.target_ref;
    const targetEntityId =
      toNullableString(targetRef?.entity_id) ??
      toNullableString(targetRef?.agent_id) ??
      toNullableString((decision.payload as Record<string, unknown>).target_entity_id);

    return {
      decision: buildRewrittenDecision(decision, semanticIntent, grounding, translateToCapability, targetRef, {
        ...(mediatorId ? { mediator_id: mediatorId } : {}),
        ...(targetEntityId ? { target_entity_id: targetEntityId } : {})
      }),
      semantic_intent: semanticIntent,
      grounding
    };
  }

  if (resolutionMode === 'translated' && translateToKernelIntent) {
    const grounding: IntentGroundingSnapshot = {
      resolution_mode: 'translated',
      affordance_key: affordanceKey,
      required_capability_key: requiredCapabilityKey,
      explanation,
      objective_effect_applied: false,
      failure_kind: null
    };

    if (translateToKernelIntent === 'post_message') {
      return {
        decision: buildRewrittenDecision(decision, semanticIntent, grounding, 'post_message', decision.target_ref, {
          content:
            toNullableString((decision.payload as Record<string, unknown>).content) ??
            semanticIntent.text ??
            decision.reasoning ??
            '未指定内容的案件进展通告。'
        }),
        semantic_intent: semanticIntent,
        grounding
      };
    }
  }

  const grounding: IntentGroundingSnapshot = {
    resolution_mode: 'narrativized',
    affordance_key: affordanceKey,
    required_capability_key: requiredCapabilityKey,
    explanation: explanation ?? 'Capability unavailable or world does not grant objective execution; fallback to narrativized failure.',
    objective_effect_applied: false,
    failure_kind: 'failed_attempt'
  };
  return {
    decision: buildNarrativizedDecision(
      semanticIntent,
      grounding,
      decision,
      isRecord(then.narrativize_event) ? then.narrativize_event : null
    ),
    semantic_intent: semanticIntent,
    grounding
  };
};
