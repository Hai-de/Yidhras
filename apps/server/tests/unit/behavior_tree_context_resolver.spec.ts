import { describe, expect, it } from 'vitest';

import { evaluateCondition, resolveContextValue } from '../../src/inference/providers/behavior_tree/context_resolver.js';
import type { BTCompoundCondition, BTConditionExpr, BTEvalContext } from '../../src/inference/providers/behavior_tree/types.js';
import type { InferenceContext, InferencePackLatestEventSnapshot, InferencePackStateSnapshot } from '../../src/inference/types.js';

const makePackState = (overrides: Partial<InferencePackStateSnapshot> = {}): InferencePackStateSnapshot => ({
  actor_roles: ['investigator', 'observer'],
  actor_state: { murderous_intent: true, suspicion_level: 0.6, knows_notebook_power: false, target_name_confirmed: false },
  owned_artifacts: [{ id: 'artifact-death-note', state: {} }],
  world_state: { opening_phase: 'notebook_claimed', notebook_holder_count: 1 },
  latest_event: { event_id: 'evt-1', title: 'Suspicious death', type: 'narrative', semantic_type: 'suspicious_death_occurred', tick: '7', created_at: '2026-01-01T00:00:00Z' },
  recent_events: [
    { event_id: 'evt-2', title: 'Pressure feedback', type: 'narrative', semantic_type: 'post_execution_pressure_feedback', tick: '8', created_at: '2026-01-01T00:00:05Z' },
    { event_id: 'evt-1', title: 'Suspicious death', type: 'narrative', semantic_type: 'suspicious_death_occurred', tick: '7', created_at: '2026-01-01T00:00:00Z' }
  ],
  ...overrides
});

const makeMockContext = (overrides: Partial<InferencePackStateSnapshot> = {}): InferenceContext => ({
  pack_state: makePackState(overrides)
} as unknown as InferenceContext);

const makeEvalCtx = (overrides: Partial<InferencePackStateSnapshot> = {}): BTEvalContext => ({
  inferenceContext: makeMockContext(overrides),
  blackboard: {}
});

describe('resolveContextValue', () => {
  it('resolves state key from actor_state', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('state', 'murderous_intent', ctx)).toBe(true);
  });

  it('returns undefined for missing state key', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('state', 'nonexistent', ctx)).toBeUndefined();
  });

  it('resolves has_artifact when artifact is held', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('has_artifact', 'artifact-death-note', ctx)).toBe(true);
  });

  it('resolves has_artifact as false when artifact is not held', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('has_artifact', 'artifact-unknown', ctx)).toBe(false);
  });

  it('resolves not_has_artifact as true when artifact is not held', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('not_has_artifact', 'artifact-unknown', ctx)).toBe(true);
  });

  it('resolves not_has_artifact as false when artifact is held', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('not_has_artifact', 'artifact-death-note', ctx)).toBe(false);
  });

  it('resolves event_semantic_type — match found in recent_events', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('event_semantic_type', 'suspicious_death_occurred', ctx)).toBe(true);
  });

  it('resolves event_semantic_type — no match in recent_events', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('event_semantic_type', 'unknown_event_type', ctx)).toBe(false);
  });

  it('resolves world_state key', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('world_state', 'opening_phase', ctx)).toBe('notebook_claimed');
  });

  it('returns undefined for missing world_state key', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('world_state', 'nonexistent', ctx)).toBeUndefined();
  });

  it('resolves ticks_since_event — event found in recent_events', () => {
    // recent_events[0] is post_execution_pressure_feedback at tick... but we don't know the tick.
    // The resolver returns the distance from the *current tick* to the event's tick.
    // For testing without a real tick, we verify the resolver finds the event and returns a number.
    const ctxWithTick = makeEvalCtx();
    (ctxWithTick.inferenceContext as unknown as Record<string, unknown>).tick = BigInt(10);
    // Set the event tick via the created_at field parsed into tick offsets — actually
    // ticks_since_event needs the actual tick. We'll test through evaluateCondition.
    // This unit test just verifies the resolver returns non-null for found events.
    const result = resolveContextValue('ticks_since_event', 'suspicious_death_occurred', ctxWithTick);
    expect(result).toBeTypeOf('bigint');
  });

  it('resolves ticks_since_event — event never occurred', () => {
    const ctx = makeEvalCtx();
    const result = resolveContextValue('ticks_since_event', 'never_occurred', ctx);
    expect(result).toBeNull(); // null signals "never occurred" → treated as +∞
  });

  it('resolves in collection — value is member', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('in', 'investigator', ctx)).toBe(true);
  });

  it('resolves in collection — value is not member', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('in', 'unknown_role', ctx)).toBe(false);
  });

  it('resolves not_in collection — value is not member', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('not_in', 'unknown_role', ctx)).toBe(true);
  });

  it('resolves not_in collection — value is member', () => {
    const ctx = makeEvalCtx();
    expect(resolveContextValue('not_in', 'investigator', ctx)).toBe(false);
  });
});

describe('evaluateCondition', () => {
  it('eq: value matches → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'murderous_intent', eq: true };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('eq: value does not match → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'murderous_intent', eq: false };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('eq: key missing → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'nonexistent', eq: true };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('neq: value does not match → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'murderous_intent', neq: false };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('gte: numeric value at threshold → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'suspicion_level', gte: 0.5 };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('gte: numeric value below threshold → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'suspicion_level', gte: 0.9 };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('lt: numeric value below threshold → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'suspicion_level', lt: 0.9 };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('lte: numeric value at threshold → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'suspicion_level', lte: 0.6 };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('gt: numeric value above threshold → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { state: 'suspicion_level', gt: 0.5 };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('numeric operator on string value → failure (no throw)', () => {
    // opening_phase is 'notebook_claimed' at world_state level, but we're querying state (actor_state).
    // Use a string-valued actor_state key instead.
    const ctxWithStr = makeEvalCtx({ actor_state: { name: 'Light' } });
    const condStr: BTConditionExpr = { state: 'name', gte: 0.5 };
    expect(evaluateCondition(condStr, ctxWithStr)).toBe(false);
  });

  it('has_artifact: artifact held → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { has_artifact: 'artifact-death-note' };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('has_artifact: artifact not held → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { has_artifact: 'artifact-unknown' };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('not_has_artifact: artifact not held → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { not_has_artifact: 'artifact-unknown' };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('not_has_artifact: artifact held → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { not_has_artifact: 'artifact-death-note' };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('event_semantic_type: match in recent_events → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { event_semantic_type: 'suspicious_death_occurred' };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('event_semantic_type: no match → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { event_semantic_type: 'unknown_event' };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('event_semantic_type with eq: false — no match → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { event_semantic_type: 'unknown_event', eq: false };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('event_semantic_type with eq: false — match exists → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { event_semantic_type: 'suspicious_death_occurred', eq: false };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('world_state: value match → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { world_state: 'opening_phase', eq: 'notebook_claimed' };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('world_state: key missing → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTConditionExpr = { world_state: 'nonexistent', eq: 'value' };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('ticks_since_event: recent event within threshold → success', () => {
    const recentWithTick: InferencePackLatestEventSnapshot[] = [
      { event_id: 'evt-2', title: 'P', type: 'n', semantic_type: 'post_execution_pressure_feedback', tick: '8', created_at: '2026-01-01T00:00:00Z' },
      { event_id: 'evt-1', title: 'S', type: 'n', semantic_type: 'suspicious_death_occurred', tick: '7', created_at: '2026-01-01T00:00:00Z' }
    ];
    const ctxTick = makeEvalCtx({ recent_events: recentWithTick });
    (ctxTick.inferenceContext as unknown as Record<string, unknown>).tick = BigInt(10);
    const cond: BTConditionExpr = { ticks_since_event: 'suspicious_death_occurred', lt: 5 };
    // 10 - 7 = 3 < 5 → success
    expect(evaluateCondition(cond, ctxTick)).toBe(true);
  });

  it('ticks_since_event: recent event outside threshold → failure', () => {
    const recentWithTick: InferencePackLatestEventSnapshot[] = [
      { event_id: 'evt-2', title: 'P', type: 'n', semantic_type: 'post_execution_pressure_feedback', tick: '8', created_at: '2026-01-01T00:00:00Z' },
      { event_id: 'evt-1', title: 'S', type: 'n', semantic_type: 'suspicious_death_occurred', tick: '2', created_at: '2026-01-01T00:00:00Z' }
    ];
    const ctxTick = makeEvalCtx({ recent_events: recentWithTick });
    (ctxTick.inferenceContext as unknown as Record<string, unknown>).tick = BigInt(10);
    const cond: BTConditionExpr = { ticks_since_event: 'suspicious_death_occurred', lt: 5 };
    // 10 - 2 = 8 >= 5 → failure
    expect(evaluateCondition(cond, ctxTick)).toBe(false);
  });

  it('ticks_since_event: never occurred → failure', () => {
    const ctx = makeEvalCtx();
    (ctx.inferenceContext as unknown as Record<string, unknown>).tick = BigInt(10);
    const cond: BTConditionExpr = { ticks_since_event: 'never_occurred', lt: 999 };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('all: both satisfy → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTCompoundCondition = {
      all: [
        { state: 'murderous_intent', eq: true },
        { state: 'suspicion_level', gte: 0.5 }
      ]
    };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('all: one fails → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTCompoundCondition = {
      all: [
        { state: 'murderous_intent', eq: true },
        { state: 'suspicion_level', gte: 0.9 }
      ]
    };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('any: one satisfies → success', () => {
    const ctx = makeEvalCtx();
    const cond: BTCompoundCondition = {
      any: [
        { state: 'murderous_intent', eq: false },
        { state: 'suspicion_level', gte: 0.5 }
      ]
    };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('any: none satisfy → failure', () => {
    const ctx = makeEvalCtx();
    const cond: BTCompoundCondition = {
      any: [
        { state: 'murderous_intent', eq: false },
        { state: 'suspicion_level', gte: 0.9 }
      ]
    };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('nested all + any → correct evaluation', () => {
    const ctx = makeEvalCtx();
    const cond: BTCompoundCondition = {
      all: [
        { state: 'suspicion_level', gte: 0.55 },
        { state: 'suspicion_level', lt: 0.68 },
        {
          any: [
            { event_semantic_type: 'suspicious_death_occurred' },
            { event_semantic_type: 'post_execution_pressure_feedback' }
          ]
        }
      ]
    };
    // suspicion_level 0.6: 0.55 <= 0.6 < 0.68 → true
    // recent_events contains both event types → any is true
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });
});
