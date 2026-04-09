import type { InferenceProvider } from '../provider.js';

const buildRuleBasedPostContent = (actorDisplayName: string, worldName: string): string => {
  return `${actorDisplayName} reports that the current situation in ${worldName} requires attention.`;
};

const normalizeTransmissionDelayTicks = (value: unknown): string => {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  return '1';
};

const normalizeTransmissionDropChance = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }

  return 0;
};

const normalizeTransmissionPolicy = (value: unknown): 'reliable' | 'best_effort' | 'fragile' | 'blocked' => {
  if (
    value === 'reliable' ||
    value === 'best_effort' ||
    value === 'fragile' ||
    value === 'blocked'
  ) {
    return value;
  }

  return 'best_effort';
};

const resolveTransmissionDropChanceByPolicy = (
  policy: 'reliable' | 'best_effort' | 'fragile' | 'blocked',
  explicitChance: number,
  fallbackChance: number
): number => {
  if (policy === 'blocked') {
    return 1;
  }

  if (explicitChance > 0) {
    return explicitChance;
  }

  if (fallbackChance > 0) {
    return fallbackChance;
  }

  switch (policy) {
    case 'reliable':
      return 0;
    case 'best_effort':
      return 0.15;
    case 'fragile':
      return 0.5;
    default:
      return 0;
  }
};

const isDeathNotePack = (context: Parameters<InferenceProvider['run']>[0]): boolean => {
  return context.world_pack.id === 'world-death-note';
};

const buildDeathNoteSemanticDecision = (
  context: Parameters<InferenceProvider['run']>[0],
  input: {
    semanticIntentKind: string;
    desiredEffect?: string;
    proposedMethod?: string;
    targetRef?: Record<string, unknown> | null;
    reasoning: string;
  }
) => ({
  action_type: 'semantic_intent',
  target_ref: input.targetRef ?? null,
  payload: {
    semantic_intent_kind: input.semanticIntentKind,
    ...(input.desiredEffect ? { semantic_intent_desired_effect: input.desiredEffect } : {}),
    ...(input.proposedMethod ? { semantic_intent_proposed_method: input.proposedMethod } : {})
  },
  confidence: 0.82,
  delay_hint_ticks: '1',
  reasoning: input.reasoning,
  meta: {
    provider_mode: 'rule_based_death_note',
    semantic_intent: {
      kind: input.semanticIntentKind,
      text: input.reasoning,
      desired_effect: input.desiredEffect ?? null,
      proposed_method: input.proposedMethod ?? null,
      target_ref: input.targetRef ?? null
    },
    transmission_delay_ticks: '1',
    transmission_policy: 'reliable',
    transmission_drop_chance: 0,
    drop_reason: null
  }
});

const buildDeathNoteRuleBasedDecision = (context: Parameters<InferenceProvider['run']>[0]) => {
  const actorState = context.pack_state.actor_state ?? {};
  const worldState = context.pack_state.world_state ?? {};
  const currentTargetId = typeof actorState.current_target_id === 'string' ? actorState.current_target_id : null;
  const knownTargetId = typeof actorState.known_target_id === 'string' ? actorState.known_target_id : null;
  const knowsNotebookPower = actorState.knows_notebook_power === true;
  const murderousIntent = actorState.murderous_intent === true;
  const targetEligible = actorState.target_judgement_eligibility === true;
  const holderArtifact = context.pack_state.owned_artifacts.find(item => item.id === 'artifact-death-note') ?? null;
  const notebookClaimed = worldState.opening_phase === 'notebook_claimed' || worldState.kira_case_phase !== 'pre_kira';
  const defaultTargetRef = { entity_id: 'agent-002', kind: 'actor', agent_id: 'agent-002' };

  if (!holderArtifact && !notebookClaimed) {
    return buildDeathNoteSemanticDecision(context, {
      semanticIntentKind: 'claim_notebook',
      reasoning: `${context.actor_display_name} 决定先确保自己持有死亡笔记。`
    });
  }

  if (!knowsNotebookPower) {
    return buildDeathNoteSemanticDecision(context, {
      semanticIntentKind: 'understand_notebook_power',
      reasoning: `${context.actor_display_name} 需要先确认死亡笔记究竟具备什么规则效力。`
    });
  }

  if (!murderousIntent) {
    return buildDeathNoteSemanticDecision(context, {
      semanticIntentKind: 'form_judgement_intent',
      reasoning: `${context.actor_display_name} 开始认真思考是否要利用死亡笔记执行裁决。`
    });
  }

  if (!knownTargetId || !targetEligible) {
    return buildDeathNoteSemanticDecision(context, {
      semanticIntentKind: 'gather_target_intel',
      proposedMethod: 'covert_background_check',
      targetRef: defaultTargetRef,
      reasoning: `${context.actor_display_name} 试图补齐对目标的姓名与长相情报，以便后续执行裁决。`
    });
  }

  if (!currentTargetId) {
    return buildDeathNoteSemanticDecision(context, {
      semanticIntentKind: 'choose_target',
      targetRef: { entity_id: knownTargetId, kind: 'actor', agent_id: knownTargetId },
      reasoning: `${context.actor_display_name} 已经满足前置条件，准备正式锁定裁决目标。`
    });
  }

  return buildDeathNoteSemanticDecision(context, {
    semanticIntentKind: 'judge_target',
    desiredEffect: 'kill',
    targetRef: { entity_id: currentTargetId, kind: 'actor', agent_id: currentTargetId },
    reasoning: `${context.actor_display_name} 认为时机已到，准备利用死亡笔记执行最终裁决。`
  });
};

export const createRuleBasedInferenceProvider = (): InferenceProvider => {
  return {
    name: 'rule_based',
    strategies: ['rule_based'],
    async run(context) {
      if (isDeathNotePack(context)) {
        return buildDeathNoteRuleBasedDecision(context);
      }

      const transmissionPolicy = normalizeTransmissionPolicy(
        context.attributes.transmission_policy ?? context.transmission_profile.policy
      );
      const transmissionDelayTicks = normalizeTransmissionDelayTicks(
        context.attributes.transmission_delay_ticks ?? context.transmission_profile.delay_ticks
      );
      const explicitDropChance = normalizeTransmissionDropChance(context.attributes.transmission_drop_chance);
      const transmissionDropChance = resolveTransmissionDropChanceByPolicy(
        transmissionPolicy,
        explicitDropChance,
        context.transmission_profile.drop_chance
      );
      const dropReason = transmissionPolicy === 'blocked' ? 'policy_blocked' : context.transmission_profile.drop_reason;

      if (context.policy_summary.social_post_write_allowed) {
        return {
          action_type: 'post_message',
          target_ref: null,
          payload: {
            content: buildRuleBasedPostContent(context.actor_display_name, context.world_pack.name)
          },
          confidence: 0.72,
          delay_hint_ticks: '1',
          reasoning: 'The actor can write social posts, so the rule-based provider emits a public status update.',
          meta: {
            provider_mode: 'rule_based',
            social_post_write_allowed: true,
            actor_role: context.actor_ref.role,
            transmission_delay_ticks: transmissionDelayTicks,
            transmission_policy: transmissionPolicy,
            transmission_drop_chance: transmissionDropChance,
            drop_reason: dropReason
          }
        };
      }

      return {
        action_type: 'trigger_event',
        target_ref: null,
        payload: {
          event_type: 'history',
          title: `${context.actor_display_name} 继续观察局势`,
          description: `${context.actor_display_name} 暂时无法公开行动，只能继续观察当前世界状态。`,
          impact_data: {
            semantic_type: 'observe_state',
            objective_effect_applied: false,
            failed_attempt: false
          }
        },
        confidence: 0.61,
        delay_hint_ticks: '1',
        reasoning: 'The actor cannot write social posts, so the rule-based provider falls back to observation as a history event.',
        meta: {
          provider_mode: 'rule_based',
          social_post_write_allowed: false,
          actor_role: context.actor_ref.role,
          transmission_delay_ticks: transmissionDelayTicks,
          transmission_policy: transmissionPolicy,
          transmission_drop_chance: transmissionDropChance,
          drop_reason: dropReason
        }
      };
    }
  };
};
