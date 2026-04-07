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

export const createRuleBasedInferenceProvider = (): InferenceProvider => {
  return {
    name: 'rule_based',
    strategies: ['rule_based'],
    async run(context) {
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
        action_type: 'observe_state',
        target_ref: null,
        payload: {
          summary: `${context.actor_display_name} can only observe the current world state.`
        },
        confidence: 0.61,
        delay_hint_ticks: '1',
        reasoning: 'The actor cannot write social posts, so the rule-based provider falls back to observation.',
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
