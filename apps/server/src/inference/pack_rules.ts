import type {
  WorldPackActionConfig,
  WorldPackDecisionRuleConditionConfig,
  WorldPackDecisionRuleConfig,
  WorldPackScenarioValue
} from '../world/schema.js';
import type {
  InferenceContext,
  InferencePackArtifactSnapshot,
  InferencePackStateRecord,
  ProviderDecisionRaw
} from './types.js';

const valuesEqual = (left: WorldPackScenarioValue | undefined, right: WorldPackScenarioValue): boolean => {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
};

const matchesStateSubset = (
  current: InferencePackStateRecord | null,
  expected: Record<string, WorldPackScenarioValue> | undefined
): boolean => {
  if (!expected) {
    return true;
  }

  if (!current) {
    return false;
  }

  return Object.entries(expected).every(([key, value]) => valuesEqual(current[key] as WorldPackScenarioValue | undefined, value));
};

const matchesActorHasArtifact = (
  ownedArtifacts: InferencePackArtifactSnapshot[],
  artifactId: string | undefined
): boolean => {
  if (!artifactId) {
    return true;
  }

  return ownedArtifacts.some(artifact => artifact.id === artifactId);
};

const matchesLatestEventCondition = (
  attributes: Record<string, unknown>,
  latestEvent: WorldPackDecisionRuleConditionConfig['latest_event']
): boolean => {
  if (!latestEvent?.semantic_type) {
    return true;
  }

  return attributes.latest_event_semantic_type === latestEvent.semantic_type;
};

const matchesDecisionRule = (
  context: InferenceContext,
  when: WorldPackDecisionRuleConditionConfig
): boolean => {
  if (!matchesActorHasArtifact(context.pack_state.owned_artifacts, when.actor_has_artifact)) {
    return false;
  }

  if (!matchesStateSubset(context.pack_state.actor_state, when.actor_state)) {
    return false;
  }

  if (!matchesStateSubset(context.pack_state.world_state, when.world_state)) {
    return false;
  }

  if (!matchesLatestEventCondition(context.attributes, when.latest_event)) {
    return false;
  }

  return true;
};

const mergeActionDefaults = (
  actionConfig: WorldPackActionConfig | undefined,
  payload: Record<string, unknown>
): Record<string, unknown> => {
  const defaults = actionConfig?.defaults;
  if (!defaults) {
    return payload;
  }

  return {
    ...defaults,
    ...payload
  };
};

const buildDecisionResult = (
  rule: WorldPackDecisionRuleConfig,
  actionConfig: WorldPackActionConfig | undefined
): ProviderDecisionRaw => {
  return {
    action_type: rule.decide.action_type,
    target_ref: rule.decide.target_ref ?? null,
    payload: mergeActionDefaults(actionConfig, rule.decide.payload ?? {}),
    confidence: 0.95,
    delay_hint_ticks: '1',
    reasoning: `Matched world-pack decision rule ${rule.id}.`,
    meta: {
      provider_mode: 'pack_rule',
      pack_rule_id: rule.id,
      ...(actionConfig ? { pack_action_executor: actionConfig.executor } : {})
    }
  };
};

export const evaluateWorldPackDecisionRules = (context: InferenceContext): ProviderDecisionRaw | null => {
  const decisionRules = context.pack_runtime.decision_rules;
  const actionRegistry = context.pack_runtime.actions;

  if (!Array.isArray(decisionRules) || decisionRules.length === 0) {
    return null;
  }

  const orderedRules = [...decisionRules].sort((left, right) => right.priority - left.priority);
  for (const rule of orderedRules) {
    if (!matchesDecisionRule(context, rule.when)) {
      continue;
    }

    const actionConfig = actionRegistry[rule.decide.action_type];
    return buildDecisionResult(rule, actionConfig);
  }

  return null;
};
