import { describe, expect, it } from 'vitest';

import { buildTransmissionProfile } from '../../../../src/inference/context/transmission_profile.js';
import { makeMockConfig } from '../../../helpers/inference-mocks.js';

const baseInput = {
  actorRef: { identity_id: 'id-1', identity_type: 'agent' as const, role: 'active' as const, agent_id: 'a1', atmosphere_node_id: null },
  agentSnapshot: { id: 'a1', name: 'Alice', type: 'agent', snr: 0.8, is_pinned: true },
  policySummary: { social_post_read_allowed: true, social_post_readable_fields: ['content'], social_post_write_allowed: true, social_post_writable_fields: ['content'] },
  attributes: {}
};

// Default config with builtin transmission profile values
const defaultConfig = makeMockConfig();

describe('buildTransmissionProfile', () => {
  it('returns reliable for high SNR with read access', () => {
    const result = buildTransmissionProfile(baseInput, defaultConfig);
    expect(result.policy).toBe('reliable');
    expect(result.drop_chance).toBe(0);
  });

  it('returns blocked when explicit policy is blocked', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      attributes: { transmission_policy: 'blocked' }
    }, defaultConfig);
    expect(result.policy).toBe('blocked');
    expect(result.drop_chance).toBe(1);
    expect(result.drop_reason).toBe('policy_blocked');
  });

  it('returns fragile for low SNR actor', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      agentSnapshot: { ...baseInput.agentSnapshot, snr: 0.1 }
    }, defaultConfig);
    expect(result.policy).toBe('fragile');
    expect(result.drop_chance).toBe(0.35);
  });

  it('returns best_effort when read is restricted', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      policySummary: { ...baseInput.policySummary, social_post_read_allowed: false }
    }, defaultConfig);
    expect(result.policy).toBe('best_effort');
    expect(result.drop_chance).toBe(0.15);
  });

  it('uses explicit drop_chance over default', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      attributes: { transmission_drop_chance: 0.05 }
    }, defaultConfig);
    expect(result.drop_chance).toBe(0.05);
  });

  it('uses explicit delay_ticks', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      attributes: { transmission_delay_ticks: '5' }
    }, defaultConfig);
    expect(result.delay_ticks).toBe('5');
  });

  it('uses null agentSnapshot snr fallback', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      agentSnapshot: null
    }, defaultConfig);
    // SNR fallback is 0.5, which is above fragile threshold (0.3)
    expect(result.policy).toBe('reliable');
  });

  it('derived_from tracks correct sources for default reliable', () => {
    const result = buildTransmissionProfile(baseInput, defaultConfig);
    expect(result.derived_from).toContain('default.reliable');
  });

  it('derived_from tracks read restriction source', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      policySummary: { ...baseInput.policySummary, social_post_read_allowed: false }
    }, defaultConfig);
    expect(result.derived_from).toContain('policy_summary.social_post_read_allowed');
  });

  it('derived_from tracks explicit policy source', () => {
    const result = buildTransmissionProfile({
      ...baseInput,
      attributes: { transmission_policy: 'fragile' }
    }, defaultConfig);
    expect(result.derived_from).toContain('attributes.transmission_policy');
  });

  it('returns default fallback when no transmission_profile in config', () => {
    // Config without transmission_profile
    const result = buildTransmissionProfile(baseInput, { config_version: 1 });
    expect(result.policy).toBe('reliable');
    expect(result.derived_from).toEqual(['default.fallback']);
  });
});
