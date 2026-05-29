import { describe, expect, it, vi } from 'vitest';

import { createPerceptionRuleEngine } from '../../../src/perception/rule_engine.js';
import type {
  PerceptionEventInput,
  PerceptionLocationInput,
  PerceptionRuleDef,
  PerceptionRuleInput
} from '../../../src/perception/types.js';

function makeRule(overrides: Partial<PerceptionRuleDef> = {}): PerceptionRuleDef {
  return {
    id: 'rule-test',
    when: {},
    then: { level: 'full' },
    ...overrides
  };
}

function makeInput(overrides: Partial<PerceptionRuleInput> = {}): PerceptionRuleInput {
  return {
    observerEntityId: 'obs-1',
    observerRelation: 'same',
    agentCapabilities: [],
    investigationCount: 0,
    ...overrides
  };
}

function makeEvent(overrides: Partial<PerceptionEventInput> = {}): PerceptionEventInput {
  return {
    eventId: 'evt-1',
    eventTitle: 'Test Event',
    eventDescription: 'A test event',
    locationId: 'loc-1',
    visibility: 'public',
    actorEntityId: 'actor-1',
    ...overrides
  };
}

function makeLocation(overrides: Partial<PerceptionLocationInput> = {}): PerceptionLocationInput {
  return {
    locationId: 'loc-1',
    publicDescription: 'A public area',
    hiddenDetails: null,
    tags: [],
    ...overrides
  };
}

describe('perception/rule_engine', () => {
  describe('createPerceptionRuleEngine', () => {
    it('should return fallback when no rules match and no plugin resolver', async () => {
      const engine = createPerceptionRuleEngine([]);
      const result = await engine.evaluate(makeInput());
      expect(result.level).toBe('none');
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });

    it('should return full for global events (locationId=null) when no rule matches', async () => {
      const engine = createPerceptionRuleEngine([]);
      const result = await engine.evaluate(makeInput({ event: makeEvent({ locationId: null }) }));
      expect(result.level).toBe('full');
      expect(result.matchedRuleId).toBe('builtin:global-event-fallback');
    });

    it('should match first rule when multiple rules match', async () => {
      const rules: PerceptionRuleDef[] = [
        makeRule({ id: 'first', when: {}, then: { level: 'full' } }),
        makeRule({ id: 'second', when: {}, then: { level: 'none' } })
      ];
      const engine = createPerceptionRuleEngine(rules);
      const result = await engine.evaluate(makeInput());
      expect(result.matchedRuleId).toBe('first');
    });

    it('should use plugin resolver when no rules match', async () => {
      const resolver = {
        resolve: vi.fn().mockResolvedValue({
          level: 'partial',
          visibleDescription: 'plugin resolved',
          hiddenDescription: null,
          matchedRuleId: 'plugin:custom'
        })
      };
      const engine = createPerceptionRuleEngine([], resolver);
      const result = await engine.evaluate(makeInput());
      expect(result.matchedRuleId).toBe('plugin:custom');
      expect(resolver.resolve).toHaveBeenCalledOnce();
    });
  });

  describe('rule matching — observer_at', () => {
    it('should match when observer_at=same and observerRelation=same', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_at: 'same' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ observerRelation: 'same' }));
      expect(result.level).toBe('full');
    });

    it('should not match when observer_at=same and observerRelation=different', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_at: 'same' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ observerRelation: 'different' }));
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });

    it('should skip observer_at check for global events (locationId=null)', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_at: 'same' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(
        makeInput({ observerRelation: 'different', event: makeEvent({ locationId: null }) })
      );
      expect(result.level).toBe('full');
    });
  });

  describe('rule matching — event_visibility', () => {
    it('should match when event_visibility=public and event is public', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { event_visibility: 'public' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ event: makeEvent({ visibility: 'public' }) }));
      expect(result.level).toBe('full');
    });

    it('should not match when event_visibility does not match', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { event_visibility: 'private' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ event: makeEvent({ visibility: 'public' }) }));
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });

    it('should not match when event_visibility specified but no event', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { event_visibility: 'public' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput());
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });
  });

  describe('rule matching — observer_is_actor', () => {
    it('should match when observer_is_actor=true and observer is the actor', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_is_actor: true }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(
        makeInput({ observerEntityId: 'actor-1', event: makeEvent({ actorEntityId: 'actor-1' }) })
      );
      expect(result.level).toBe('full');
    });

    it('should not match when observer_is_actor=true but observer is not the actor', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_is_actor: true }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(
        makeInput({ observerEntityId: 'other', event: makeEvent({ actorEntityId: 'actor-1' }) })
      );
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });
  });

  describe('rule matching — investigation_count_min', () => {
    it('should match when investigation count meets minimum', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { investigation_count_min: 3 }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ investigationCount: 5 }));
      expect(result.level).toBe('full');
    });

    it('should not match when investigation count below minimum', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { investigation_count_min: 3 }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ investigationCount: 1 }));
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });
  });

  describe('rule matching — observer_has_capability', () => {
    it('should match when observer has the required capability', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_has_capability: 'stealth' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ agentCapabilities: ['stealth', 'combat'] }));
      expect(result.level).toBe('full');
    });

    it('should not match when observer lacks the required capability', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ when: { observer_has_capability: 'stealth' }, then: { level: 'full' } })
      ]);
      const result = await engine.evaluate(makeInput({ agentCapabilities: ['combat'] }));
      expect(result.matchedRuleId).toBe('builtin:fallback-deny');
    });
  });

  describe('buildDescriptions', () => {
    it('should reveal public description when reveal_public=true', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ then: { level: 'full', reveal_public: true } })
      ]);
      const result = await engine.evaluate(makeInput({ location: makeLocation({ publicDescription: 'Town Square' }) }));
      expect(result.visibleDescription).toContain('Town Square');
    });

    it('should reveal hidden segments based on investigation count', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ then: { level: 'full', reveal_hidden: true, max_hidden_segments: 3 } })
      ]);
      const result = await engine.evaluate(
        makeInput({
          location: makeLocation({ hiddenDetails: ['Secret1', 'Secret2', 'Secret3', 'Secret4'] }),
          investigationCount: 2
        })
      );
      expect(result.visibleDescription).toContain('[调查发现]');
      expect(result.visibleDescription).toContain('Secret1');
      expect(result.visibleDescription).toContain('Secret2');
      expect(result.visibleDescription).not.toContain('Secret3');
      expect(result.hiddenDescription).toContain('Secret3');
      expect(result.hiddenDescription).toContain('Secret4');
    });

    it('should handle string hiddenDetails', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ then: { level: 'full', reveal_hidden: true } })
      ]);
      const result = await engine.evaluate(
        makeInput({
          location: makeLocation({ hiddenDetails: 'A single secret' }),
          investigationCount: 1
        })
      );
      expect(result.visibleDescription).toContain('A single secret');
    });

    it('should return empty visibleDescription when no location', async () => {
      const engine = createPerceptionRuleEngine([
        makeRule({ then: { level: 'full', reveal_public: true } })
      ]);
      const result = await engine.evaluate(makeInput());
      expect(result.visibleDescription).toBe('');
    });
  });
});
