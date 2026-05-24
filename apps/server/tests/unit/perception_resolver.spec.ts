import { describe, expect, it } from 'vitest';

import { createRuleBasedPerceptionResolver } from '../../src/perception/default_resolver.js';
import { BUILTIN_PERCEPTION_RULES } from '../../src/perception/default_rules.js';
import { createPerceptionRuleEngine } from '../../src/perception/rule_engine.js';
import type {
  PerceptionEventInput,
  PerceptionResolver,
  PerceptionRuleInput
} from '../../src/perception/types.js';

const buildEngine = (): PerceptionResolver => {
  const engine = createPerceptionRuleEngine(BUILTIN_PERCEPTION_RULES, null);
  return createRuleBasedPerceptionResolver(engine);
};

const eventInput = (overrides: Partial<PerceptionEventInput> = {}): PerceptionEventInput => ({
  eventId: 'e1',
  eventTitle: 'Test Event',
  eventDescription: 'Something happened',
  locationId: 'kitchen',
  visibility: 'public',
  actorEntityId: 'actor-2',
  ...overrides
});

const baseInput = (overrides: Partial<PerceptionRuleInput> = {}): PerceptionRuleInput => ({
  observerEntityId: 'actor-1',
  observerRelation: 'same',
  agentCapabilities: [],
  investigationCount: 0,
  ...overrides
});

describe('PerceptionResolver (unified — event perception)', () => {
  const resolver = buildEngine();

  it('returns full for global events (no location_id)', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'no_location' }),
      event: eventInput({ locationId: null })
    });
    expect(result.level).toBe('full');
  });

  it('returns full when observer is at same location (public)', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same' }),
      event: eventInput({ locationId: 'kitchen', visibility: 'public', actorEntityId: 'actor-2' })
    });
    expect(result.level).toBe('full');
    expect(result.matchedRuleId).toBe('builtin:event-same-location-public');
  });

  it('returns none when observer is at different location', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'different' }),
      event: eventInput({ locationId: 'kitchen', visibility: 'public', actorEntityId: 'actor-2' })
    });
    expect(result.level).toBe('none');
  });

  it('returns full for private event when observer IS the event actor', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same', observerEntityId: 'actor-1' }),
      event: eventInput({ locationId: 'kitchen', visibility: 'private', actorEntityId: 'actor-1' })
    });
    expect(result.level).toBe('full');
    expect(result.matchedRuleId).toBe('builtin:event-same-location-private-actor');
  });

  it('returns none for private event when observer is NOT the event actor (same location)', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same', observerEntityId: 'actor-1' }),
      event: eventInput({ locationId: 'kitchen', visibility: 'private', actorEntityId: 'actor-2' })
    });
    expect(result.level).toBe('none');
    expect(result.matchedRuleId).toBe('builtin:event-same-location-private-other');
  });

  it('returns none when observer has no spatial state (observerRelation=no_location)', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'no_location' }),
      event: eventInput({ locationId: 'kitchen', visibility: 'public', actorEntityId: null })
    });
    expect(result.level).toBe('none');
  });
});

describe('PerceptionResolver (unified — environment perception)', () => {
  const resolver = buildEngine();

  it('returns partial with public description when no investigation', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same', investigationCount: 0 }),
      location: {
        locationId: 'kitchen',
        publicDescription: 'A warm and inviting kitchen.',
        hiddenDetails: 'A hidden key under the table.',
        tags: ['indoor']
      }
    });
    expect(result.level).toBe('partial');
    expect(result.visibleDescription).toContain('A warm and inviting kitchen.');
    expect(result.hiddenDescription).toBeNull();
    expect(result.matchedRuleId).toBe('builtin:environment-no-investigation');
  });

  it('returns full with hidden details after investigation', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same', investigationCount: 1 }),
      location: {
        locationId: 'kitchen',
        publicDescription: 'A warm and inviting kitchen.',
        hiddenDetails: 'A hidden key under the table.',
        tags: ['indoor']
      }
    });
    expect(result.level).toBe('full');
    expect(result.visibleDescription).toContain('A warm and inviting kitchen.');
    expect(result.visibleDescription).toContain('[调查发现]');
    expect(result.matchedRuleId).toBe('builtin:environment-investigated');
  });

  it('reveals first segment of array hidden_details on investigation 1', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same', investigationCount: 1 }),
      location: {
        locationId: 'study',
        publicDescription: 'A dusty study room.',
        hiddenDetails: ['old diary', 'secret letter', 'bloodstains'],
        tags: ['indoor']
      }
    });
    expect(result.level).toBe('full');
    expect(result.visibleDescription).toContain('old diary');
    expect(result.visibleDescription).not.toContain('secret letter');
    expect(result.hiddenDescription).toContain('secret letter');
    expect(result.hiddenDescription).toContain('bloodstains');
  });

  it('reveals all segments when investigationCount >= array length', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'same', investigationCount: 3 }),
      location: {
        locationId: 'study',
        publicDescription: 'A dusty study room.',
        hiddenDetails: ['old diary', 'secret letter', 'bloodstains'],
        tags: ['indoor']
      }
    });
    expect(result.level).toBe('full');
    expect(result.visibleDescription).toContain('old diary');
    expect(result.visibleDescription).toContain('secret letter');
    expect(result.visibleDescription).toContain('bloodstains');
    expect(result.hiddenDescription).toBeNull();
  });

  it('returns level none when observer is at different location', async () => {
    const result = await resolver.resolve({
      ...baseInput({ observerRelation: 'different' }),
      location: {
        locationId: 'kitchen',
        publicDescription: 'A kitchen.',
        hiddenDetails: null,
        tags: []
      }
    });
    expect(result.level).toBe('none');
  });
});

describe('PerceptionRuleEngine (rule matching)', () => {
  it('pack rules override built-in rules', async () => {
    const engine = createPerceptionRuleEngine([
      { id: 'custom:always-none', when: { observer_at: 'same' }, then: { level: 'none' as const } }
    ], null);

    const result = await engine.evaluate({
      ...baseInput({ observerRelation: 'same' }),
      event: eventInput({ locationId: 'kitchen', visibility: 'public' })
    });
    expect(result.level).toBe('none');
    expect(result.matchedRuleId).toBe('custom:always-none');
  });

  it('plugin resolver used as fallback when no rule matches', async () => {
    const emptyRules = [
      { id: 'custom:unreachable', when: { observer_has_capability: 'impossible.cap' }, then: { level: 'full' as const } }
    ];
    const pluginResolver: PerceptionResolver = {
      async resolve() {
        return { level: 'partial', visibleDescription: '', hiddenDescription: null, matchedRuleId: 'plugin:fallback' };
      }
    };
    const engine = createPerceptionRuleEngine(emptyRules, pluginResolver);

    const result = await engine.evaluate({
      ...baseInput({ observerRelation: 'same', agentCapabilities: [] }),
      event: eventInput({ locationId: 'kitchen', visibility: 'public' })
    });
    expect(result.level).toBe('partial');
    expect(result.matchedRuleId).toBe('plugin:fallback');
  });

  it('observer_has_capability filters rules', async () => {
    const rules = [
      { id: 'custom:needs-cap', when: { observer_has_capability: 'perceive.mastermind' }, then: { level: 'full' as const } }
    ];
    const engine = createPerceptionRuleEngine(rules, null);

    const withoutCap = await engine.evaluate({
      ...baseInput({ agentCapabilities: [] }),
      event: eventInput()
    });
    expect(withoutCap.level).toBe('none'); // falls through to engine fallback

    const withCap = await engine.evaluate({
      ...baseInput({ agentCapabilities: ['perceive.mastermind'] }),
      event: eventInput()
    });
    expect(withCap.level).toBe('full');
    expect(withCap.matchedRuleId).toBe('custom:needs-cap');
  });

  it('investigation_count_min filters environment rules', async () => {
    const engine = createPerceptionRuleEngine(BUILTIN_PERCEPTION_RULES, null);

    const noInv = await engine.evaluate({
      ...baseInput({ investigationCount: 0, observerRelation: 'same' }),
      location: { locationId: 'lab', publicDescription: 'A lab.', hiddenDetails: null, tags: [] }
    });
    expect(noInv.level).toBe('partial');

    const withInv = await engine.evaluate({
      ...baseInput({ investigationCount: 5, observerRelation: 'same' }),
      location: { locationId: 'lab', publicDescription: 'A lab.', hiddenDetails: null, tags: [] }
    });
    expect(withInv.level).toBe('full');
  });
});
