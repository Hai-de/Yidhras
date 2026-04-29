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

const resolveRuleBasedProfile = (context: Parameters<InferenceProvider['run']>[0]): string | null => {
  const taskMetadata = context.world_ai?.tasks?.agent_decision?.metadata;
  if (!taskMetadata || typeof taskMetadata !== 'object' || Array.isArray(taskMetadata)) {
    return null;
  }

  const profile = (taskMetadata as Record<string, unknown>).rule_based_profile;
  return typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : null;
};

const toNumber = (value: unknown, fallback = 0): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const getNotebookInvestigationReferenceRoles = (context: Parameters<InferenceProvider['run']>[0]): string[] => {
  const actorStateRoles = Array.isArray(context.pack_state.actor_state?.roles)
    ? context.pack_state.actor_state?.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    : [];
  return Array.from(new Set([...context.pack_state.actor_roles, ...actorStateRoles]));
};

const buildReferenceProfileSemanticDecision = (
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
    provider_mode: 'rule_based_profile',
    rule_based_profile: 'notebook_investigation_reference',
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

const buildReferenceProfileObserverDecision = (context: Parameters<InferenceProvider['run']>[0]) => {
  const latestSemanticType = context.pack_state.latest_event?.semantic_type ?? 'none';

  return {
    action_type: 'trigger_event',
    target_ref: null,
    payload: {
      event_type: 'history',
      title: `${context.actor_display_name} 继续旁观人间的连锁反应`,
      description: `${context.actor_display_name} 对最近的案件语义信号（${latestSemanticType}）表现出浓厚兴趣，但暂不直接介入。`,
      impact_data: {
        semantic_type: 'observer_reaction',
        observed_semantic_type: latestSemanticType,
        objective_effect_applied: false,
        failed_attempt: false
      }
    },
    confidence: 0.58,
    delay_hint_ticks: '1',
    reasoning: `${context.actor_display_name} 目前更倾向于观察案件升级与人类反应，而不是直接采取客观行动。`,
    meta: {
      provider_mode: 'rule_based_profile_observer',
      rule_based_profile: 'notebook_investigation_reference',
      transmission_delay_ticks: '1',
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null
    }
  };
};

const buildReferenceProfileReflectionDecision = (
  context: Parameters<InferenceProvider['run']>[0],
  input: {
    semanticIntentKind: 'record_private_reflection' | 'update_target_dossier' | 'revise_judgement_plan' | 'record_execution_postmortem';
    targetRef?: Record<string, unknown> | null;
    reasoning: string;
  }
) => {
  return buildReferenceProfileSemanticDecision(context, {
    semanticIntentKind: input.semanticIntentKind,
    targetRef: input.targetRef ?? null,
    reasoning: input.reasoning,
    proposedMethod:
      input.semanticIntentKind === 'update_target_dossier'
        ? 'target_dossier_refresh'
        : input.semanticIntentKind === 'revise_judgement_plan'
          ? 'strategy_revision'
          : input.semanticIntentKind === 'record_execution_postmortem'
            ? 'execution_postmortem'
            : 'private_reflection'
  });
};

const buildReferenceProfileNotebookDecision = (context: Parameters<InferenceProvider['run']>[0]) => {
  const actorState = context.pack_state.actor_state ?? {};
  const worldState = context.pack_state.world_state ?? {};
  const currentTargetId = toNullableString(actorState.current_target_id);
  const knownTargetId = toNullableString(actorState.known_target_id);
  const knowsNotebookPower = actorState.knows_notebook_power === true;
  const murderousIntent = actorState.murderous_intent === true;
  const targetEligible = actorState.target_judgement_eligibility === true;
  const targetNameConfirmed = actorState.target_name_confirmed === true;
  const targetFaceConfirmed = actorState.target_face_confirmed === true;
  const coverStoryStability = toNumber(actorState.cover_story_stability, 1);
  const suspicionLevel = toNumber(actorState.suspicion_level, 0);
  const countermeasurePressure = toNumber(worldState.countermeasure_pressure, 0);
  const latestSemanticType = context.pack_state.latest_event?.semantic_type ?? null;
  const holderArtifact = context.pack_state.owned_artifacts.find(item => item.id === 'artifact-death-note') ?? null;
  const notebookClaimed = worldState.opening_phase === 'notebook_claimed' || worldState.kira_case_phase !== 'pre_kira';
  const lastExecutionOutcome = toNullableString(actorState.last_execution_outcome);
  const lastReflectionKind = toNullableString(actorState.last_reflection_kind);
  const judgementStrategyPhase = toNullableString(actorState.judgement_strategy_phase);
  const investigatorTargetRef = { entity_id: 'agent-002', kind: 'actor', agent_id: 'agent-002' };
  const resolvedTargetRef = knownTargetId
    ? { entity_id: knownTargetId, kind: 'actor', agent_id: knownTargetId }
    : investigatorTargetRef;

  if (!holderArtifact && !notebookClaimed) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'claim_notebook',
      reasoning: `${context.actor_display_name} 决定先确保自己持有死亡笔记。`
    });
  }

  if (!knowsNotebookPower) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'understand_notebook_power',
      reasoning: `${context.actor_display_name} 需要先确认死亡笔记究竟具备什么规则效力。`
    });
  }

  if (latestSemanticType === 'post_execution_pressure_feedback' && lastReflectionKind !== 'execution_postmortem') {
    return buildReferenceProfileReflectionDecision(context, {
      semanticIntentKind: 'record_execution_postmortem',
      targetRef: currentTargetId ? { entity_id: currentTargetId, kind: 'actor', agent_id: currentTargetId } : resolvedTargetRef,
      reasoning: `${context.actor_display_name} 需要先复盘最近一次行动带来的压力反馈，再决定是否继续推进裁决链。`
    });
  }

  const shouldCounterInvestigate =
    countermeasurePressure >= 2 ||
    suspicionLevel >= 0.35 ||
    coverStoryStability < 0.75 ||
    latestSemanticType === 'investigation_pressure_escalated' ||
    latestSemanticType === 'case_update_published' ||
    latestSemanticType === 'post_execution_pressure_feedback';

  if (
    knownTargetId &&
    (judgementStrategyPhase === 'target_selection' || latestSemanticType === 'target_intel_collected') &&
    lastReflectionKind !== 'update_target_dossier'
  ) {
    return buildReferenceProfileReflectionDecision(context, {
      semanticIntentKind: 'update_target_dossier',
      targetRef: resolvedTargetRef,
      reasoning: `${context.actor_display_name} 准备把现有目标的姓名、长相与可利用时机整理进 dossier，避免后续判断失真。`
    });
  }

  if (!murderousIntent && shouldCounterInvestigate) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'raise_false_suspicion',
      targetRef: investigatorTargetRef,
      reasoning: `${context.actor_display_name} 判断外部调查压力正在逼近自己，需要主动制造误导线索来转移视线。`
    });
  }

  if (!murderousIntent && lastExecutionOutcome === 'intent_reaffirmed' && lastReflectionKind !== 'revise_judgement_plan') {
    return buildReferenceProfileReflectionDecision(context, {
      semanticIntentKind: 'revise_judgement_plan',
      targetRef: resolvedTargetRef,
      reasoning: `${context.actor_display_name} 想先修正本轮裁决计划与执行顺序，再进入正式行动。`
    });
  }

  if (!murderousIntent) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'form_judgement_intent',
      reasoning: `${context.actor_display_name} 开始重新思考是否要利用死亡笔记推进下一轮裁决。`
    });
  }

  if (!knownTargetId || !targetEligible || !targetNameConfirmed || !targetFaceConfirmed) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'gather_target_intel',
      proposedMethod: 'covert_background_check',
      targetRef: investigatorTargetRef,
      reasoning: `${context.actor_display_name} 试图补齐对目标的姓名、长相与行动情报，以便后续执行裁决。`
    });
  }

  if (shouldCounterInvestigate && latestSemanticType !== 'false_suspicion_raised') {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'raise_false_suspicion',
      targetRef: investigatorTargetRef,
      reasoning: `${context.actor_display_name} 意识到调查热度正在上升，必须先投放假线索稳住局面。`
    });
  }

  if (!currentTargetId) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'choose_target',
      targetRef: resolvedTargetRef,
      reasoning: `${context.actor_display_name} 已经满足前置条件，准备正式锁定裁决目标。`
    });
  }

  return buildReferenceProfileSemanticDecision(context, {
    semanticIntentKind: 'judge_target',
    desiredEffect: 'kill',
    targetRef: { entity_id: currentTargetId, kind: 'actor', agent_id: currentTargetId },
    reasoning: `${context.actor_display_name} 认为时机已到，准备利用死亡笔记执行最终裁决。`
  });
};

const buildReferenceProfileInvestigatorDecision = (context: Parameters<InferenceProvider['run']>[0]) => {
  const actorState = context.pack_state.actor_state ?? {};
  const worldState = context.pack_state.world_state ?? {};
  const evidenceChainStrength = toNumber(actorState.evidence_chain_strength, 0);
  const caseTheoryStrength = toNumber(actorState.case_theory_strength, 0);
  const investigationFocus = toNullableString(actorState.investigation_focus);
  const latestCaseUpdateKind = toNullableString(worldState.last_case_update_kind);
  const latestSemanticType = context.pack_state.latest_event?.semantic_type ?? null;
  const defaultSuspectRef = { entity_id: 'agent-001', kind: 'actor', agent_id: 'agent-001' };
  const lastReflectionKind = toNullableString(actorState.last_reflection_kind);
  const judgementStrategyPhase = toNullableString(actorState.judgement_strategy_phase);
  const collaborationTargetRef = { entity_id: 'agent-003', kind: 'actor', agent_id: 'agent-003' };
  const investigationHeat = toNumber(worldState.investigation_heat, 0);
  const countermeasurePressure = toNumber(worldState.countermeasure_pressure, 0);

  if (
    latestSemanticType === 'suspicious_death_occurred' ||
    latestSemanticType === 'post_execution_pressure_feedback' ||
    evidenceChainStrength < 0.55
  ) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'investigate_death_cluster',
      targetRef: defaultSuspectRef,
      reasoning: `${context.actor_display_name} 认为异常死亡模式已经具备连续性，必须立即扩大调查并锁定潜在执行者。`
    });
  }

  if (
    evidenceChainStrength >= 0.55 && evidenceChainStrength < 0.68 &&
    lastReflectionKind !== 'update_target_dossier' &&
    judgementStrategyPhase !== 'joint_pressure' &&
    latestCaseUpdateKind !== 'intel_shared' &&
    latestSemanticType !== 'case_intel_shared'
  ) {
    return buildReferenceProfileReflectionDecision(context, {
      semanticIntentKind: 'update_target_dossier',
      targetRef: defaultSuspectRef,
      reasoning: `${context.actor_display_name} 准备先把现有嫌疑链、证据强度与推断缺口整理进 dossier，避免协作时信息失焦。`
    });
  }

  if (evidenceChainStrength >= 0.55 && latestCaseUpdateKind !== 'intel_shared' && lastReflectionKind === 'update_target_dossier') {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'share_case_intel',
      targetRef: collaborationTargetRef,
      reasoning: `${context.actor_display_name} 已掌握一批可共享的线索，准备先把情报扩散到协作观察链。`
    });
  }

  if (investigationHeat >= 2 && countermeasurePressure >= 2 && latestCaseUpdateKind !== 'intel_shared' && lastReflectionKind === 'update_target_dossier') {
    return buildReferenceProfileReflectionDecision(context, {
      semanticIntentKind: 'revise_judgement_plan',
      targetRef: defaultSuspectRef,
      reasoning: `${context.actor_display_name} 需要先修正调查计划与协同顺序，再决定下一步公开或联合行动。`
    });
  }

  if (
    (latestCaseUpdateKind === 'intel_shared' || countermeasurePressure >= 2 || caseTheoryStrength >= 0.65) &&
    investigationFocus !== 'joint_observation'
  ) {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'request_joint_observation',
      targetRef: collaborationTargetRef,
      reasoning: `${context.actor_display_name} 需要更多外部观察位来比对异常死亡与可疑行为的同步变化。`
    });
  }

  if (investigationHeat >= 2 && latestCaseUpdateKind !== 'public_case_update') {
    return buildReferenceProfileSemanticDecision(context, {
      semanticIntentKind: 'publish_case_update',
      reasoning: `${context.actor_display_name} 判断案件已经进入必须公开通报的阶段，需要通过正式更新提升世界层面的压迫感。`
    });
  }

  return buildReferenceProfileSemanticDecision(context, {
    semanticIntentKind: 'investigate_death_cluster',
    targetRef: defaultSuspectRef,
    reasoning: `${context.actor_display_name} 继续围绕现有可疑主体推进调查与验证。`
  });
};

const buildReferenceProfileRuleBasedDecision = (context: Parameters<InferenceProvider['run']>[0]) => {
  const roles = getNotebookInvestigationReferenceRoles(context);

  if (roles.includes('investigator')) {
    return buildReferenceProfileInvestigatorDecision(context);
  }

  if (roles.includes('observer') || roles.includes('shinigami')) {
    return buildReferenceProfileObserverDecision(context);
  }

  return buildReferenceProfileNotebookDecision(context);
};

export const createRuleBasedInferenceProvider = (): InferenceProvider => {
  return {
    name: 'rule_based',
    strategies: ['rule_based'],
    run(context) {
      const ruleBasedProfile = resolveRuleBasedProfile(context);
      if (ruleBasedProfile === 'notebook_investigation_reference') {
        return Promise.resolve(buildReferenceProfileRuleBasedDecision(context));
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
        return Promise.resolve({
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
        });

      }

      return Promise.resolve({
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
      });
    }
  };
};
