import type { InferenceTransmissionProfile } from '../types.js';
import type { InferenceContextConfig } from './config_loader.js';
import type { TransmissionProfileInput } from './types.js';

const resolveTransmissionProfile = (
  input: TransmissionProfileInput,
  tpConfig: NonNullable<InferenceContextConfig['transmission_profile']>
): InferenceTransmissionProfile => {
  const snrFallback = tpConfig.defaults?.snr_fallback ?? 0.5;
  const fragileSnr = tpConfig.thresholds?.fragile_snr ?? 0.3;
  const fragileDrop = tpConfig.drop_chances?.fragile ?? 0.35;
  const bestEffortDrop = tpConfig.drop_chances?.best_effort ?? 0.15;
  const reliableDrop = tpConfig.drop_chances?.reliable ?? 0.0;
  const readRestrictedBase = tpConfig.policies?.read_restricted_base ?? 'best_effort';
  const lowSnrBase = tpConfig.policies?.low_snr_base ?? 'fragile';
  const defaultBase = tpConfig.policies?.default_base ?? 'reliable';

  const explicitPolicy = typeof input.attributes.transmission_policy === 'string'
    ? input.attributes.transmission_policy
    : null;
  const explicitDropChance = typeof input.attributes.transmission_drop_chance === 'number'
    ? input.attributes.transmission_drop_chance
    : null;
  const explicitDelayTicks =
    typeof input.attributes.transmission_delay_ticks === 'string' ||
    typeof input.attributes.transmission_delay_ticks === 'number'
      ? String(input.attributes.transmission_delay_ticks)
      : null;

  if (explicitPolicy === 'blocked') {
    return {
      policy: 'blocked',
      drop_reason: 'policy_blocked',
      delay_ticks: explicitDelayTicks ?? '0',
      drop_chance: 1,
      derived_from: ['attributes.transmission_policy']
    };
  }

  const actorSNR = input.agentSnapshot?.snr ?? snrFallback;
  const readRestricted = !input.policySummary.social_post_read_allowed;

  const resolvedBasePolicy = readRestricted
    ? readRestrictedBase
    : actorSNR < fragileSnr
      ? lowSnrBase
      : defaultBase;

  const resolvedPolicy: InferenceTransmissionProfile['policy'] =
    explicitPolicy === 'reliable' || explicitPolicy === 'best_effort' || explicitPolicy === 'fragile'
      ? explicitPolicy
      : resolvedBasePolicy;

  const dropChance =
    explicitDropChance ??
    (resolvedPolicy === 'fragile' ? fragileDrop : resolvedPolicy === 'best_effort' ? bestEffortDrop : reliableDrop);

  // Accurate derived_from tracking (fixes blind spot 8)
  const derivedFrom: string[] = [];
  if (explicitPolicy) {
    derivedFrom.push('attributes.transmission_policy');
  } else {
    if (readRestricted) {
      derivedFrom.push('policy_summary.social_post_read_allowed');
    }
    if (actorSNR < fragileSnr && !readRestricted) {
      derivedFrom.push('agent_snapshot.snr');
    }
    if (!readRestricted && actorSNR >= fragileSnr) {
      derivedFrom.push('default.reliable');
    }
  }
  if (input.actorRef.role === 'atmosphere') {
    derivedFrom.push('actor_ref.role');
  }

  return {
    policy: resolvedPolicy,
    drop_reason: null,
    delay_ticks: explicitDelayTicks ?? '1',
    drop_chance: dropChance,
    derived_from: derivedFrom
  };
};

export const buildTransmissionProfile = (
  input: TransmissionProfileInput,
  config?: InferenceContextConfig
): InferenceTransmissionProfile => {
  const tpConfig = config?.transmission_profile;
  if (!tpConfig) {
    return {
      policy: 'reliable',
      drop_reason: null,
      delay_ticks: '1',
      drop_chance: 0,
      derived_from: ['default.fallback']
    };
  }
  return resolveTransmissionProfile(input, tpConfig);
};
