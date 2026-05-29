import { describe, expect, it } from 'vitest';

import {
  toAgentSnapshot,
  toBindingRef,
  toPackLatestEventSnapshot,
  toPolicyRule
} from '../../../src/inference/mappers.js';

describe('toBindingRef', () => {
  it('maps a binding row to InferenceBindingRef', () => {
    const result = toBindingRef({
      id: 'b1',
      role: 'active',
      status: 'active',
      agent_id: 'agent-1',
      atmosphere_node_id: null
    });
    expect(result).toEqual({
      binding_id: 'b1',
      role: 'active',
      status: 'active',
      agent_id: 'agent-1',
      atmosphere_node_id: null
    });
  });

  it('maps atmosphere role correctly', () => {
    const result = toBindingRef({
      id: 'b2',
      role: 'atmosphere',
      status: 'active',
      agent_id: null,
      atmosphere_node_id: 'atm-1'
    });
    expect(result.role).toBe('atmosphere');
    expect(result.atmosphere_node_id).toBe('atm-1');
  });

  it('falls back to active role for unknown role value', () => {
    const result = toBindingRef({
      id: 'b3',
      role: 'invalid_role',
      status: 'active',
      agent_id: 'agent-1',
      atmosphere_node_id: null
    });
    expect(result.role).toBe('active');
  });
});

describe('toAgentSnapshot', () => {
  it('maps valid fields correctly', () => {
    const result = toAgentSnapshot({
      id: 'agent-1',
      name: 'Alice',
      type: 'agent',
      snr: 0.8,
      is_pinned: true
    });
    expect(result).toEqual({
      id: 'agent-1',
      name: 'Alice',
      type: 'agent',
      snr: 0.8,
      is_pinned: true
    });
  });

  it('returns defaults for missing fields', () => {
    const result = toAgentSnapshot({});
    expect(result).toEqual({
      id: '',
      name: '',
      type: '',
      snr: 0,
      is_pinned: false
    });
  });

  it('coerces wrong types to defaults', () => {
    const result = toAgentSnapshot({
      id: 42,
      name: true,
      type: null,
      snr: 'not-a-number',
      is_pinned: 'yes'
    });
    expect(result).toEqual({
      id: '',
      name: '',
      type: '',
      snr: 0,
      is_pinned: false
    });
  });

  it('only treats boolean true as pinned', () => {
    expect(toAgentSnapshot({ is_pinned: true }).is_pinned).toBe(true);
    expect(toAgentSnapshot({ is_pinned: false }).is_pinned).toBe(false);
    expect(toAgentSnapshot({ is_pinned: 1 }).is_pinned).toBe(false);
  });
});

describe('toPackLatestEventSnapshot', () => {
  it('maps a full event row', () => {
    const result = toPackLatestEventSnapshot({
      id: 'evt-1',
      title: 'Test Event',
      type: 'interaction',
      impact_data: JSON.stringify({ semantic_type: 'investigation_conducted' }),
      tick: 100n,
      created_at: new Date('2025-01-01')
    });
    expect(result.event_id).toBe('evt-1');
    expect(result.title).toBe('Test Event');
    expect(result.type).toBe('interaction');
    expect(result.semantic_type).toBe('investigation_conducted');
    expect(result.tick).toBe('100');
    expect(result.created_at).toBe(new Date('2025-01-01').toString());
  });

  it('handles null impact_data', () => {
    const result = toPackLatestEventSnapshot({
      id: 'evt-2',
      title: 'No Impact',
      type: 'system',
      impact_data: null,
      tick: 200n,
      created_at: new Date('2025-01-02')
    });
    expect(result.semantic_type).toBeNull();
  });

  it('handles bigint created_at', () => {
    const result = toPackLatestEventSnapshot({
      id: 'evt-3',
      title: 'BigInt Time',
      type: 'history',
      impact_data: null,
      tick: 300n,
      created_at: 1700000000000n
    });
    expect(result.created_at).toBe('1700000000000');
  });
});

describe('toPolicyRule', () => {
  it('maps an allow rule', () => {
    const result = toPolicyRule({
      id: 'p1',
      effect: 'allow',
      subject_id: 'identity-1',
      subject_type: 'agent',
      resource: 'social_post',
      action: 'read',
      field: 'content',
      conditions: { visibility: 'public' },
      priority: 10
    });
    expect(result).toEqual({
      id: 'p1',
      effect: 'allow',
      subject_id: 'identity-1',
      subject_type: 'agent',
      resource: 'social_post',
      action: 'read',
      field: 'content',
      conditions: { visibility: 'public' },
      priority: 10
    });
  });

  it('maps a deny rule', () => {
    const result = toPolicyRule({
      id: 'p2',
      effect: 'deny',
      subject_id: null,
      subject_type: null,
      resource: 'social_post',
      action: 'write',
      field: '*',
      conditions: null,
      priority: 0
    });
    expect(result.effect).toBe('deny');
    expect(result.subject_id).toBeNull();
    expect(result.subject_type).toBeNull();
  });

  it('maps null conditions to null', () => {
    const result = toPolicyRule({
      id: 'p3',
      effect: 'allow',
      subject_id: null,
      subject_type: null,
      resource: 'memory',
      action: 'read',
      field: '*',
      conditions: null,
      priority: 0
    });
    expect(result.conditions).toBeNull();
  });
});
