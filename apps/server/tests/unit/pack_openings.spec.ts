import { describe, expect, it } from 'vitest';

import { applyOpening } from '../../src/packs/openings/applicator.js';
import {
  parseWorldPackConstitution,
  worldPackOpeningSchema
} from '../../src/packs/schema/constitution_schema.js';

const minimalPackYaml = {
  metadata: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' }
};

const packWithBootstrap = {
  ...minimalPackYaml,
  variables: { currency: 'yen', trust: 70, region: 'kanto' },
  bootstrap: {
    initial_states: [
      {
        entity_id: '__world__',
        state_namespace: 'world',
        state_json: { phase: 'idle' }
      }
    ],
    initial_events: []
  }
};

describe('applyOpening', () => {
  it('replaces initial_states from opening', () => {
    const pack = parseWorldPackConstitution(packWithBootstrap);
    const opening = worldPackOpeningSchema.parse({
      initial_states: [
        {
          entity_id: '__world__',
          state_namespace: 'world',
          state_json: { phase: 'crisis' }
        }
      ]
    });

    const result = applyOpening(pack, opening);
    expect(result.bootstrap?.initial_states).toHaveLength(1);
    expect(result.bootstrap?.initial_states?.[0]?.state_json).toEqual({ phase: 'crisis' });
  });

  it('shallow-merges variables from opening', () => {
    const pack = parseWorldPackConstitution(packWithBootstrap);
    const opening = worldPackOpeningSchema.parse({
      variables: { trust: 30, difficulty: 'hard' }
    });

    const result = applyOpening(pack, opening);
    expect(result.variables).toEqual({
      currency: 'yen',
      trust: 30,
      region: 'kanto',
      difficulty: 'hard'
    });
  });

  it('returns original pack when opening has no overrides', () => {
    const pack = parseWorldPackConstitution(packWithBootstrap);
    const opening = worldPackOpeningSchema.parse({});

    const result = applyOpening(pack, opening);
    expect(result.bootstrap?.initial_states).toEqual(pack.bootstrap?.initial_states);
    expect(result.variables).toEqual(pack.variables);
  });

  it('replaces initial_events from opening', () => {
    const pack = parseWorldPackConstitution(packWithBootstrap);
    const opening = worldPackOpeningSchema.parse({
      initial_events: [
        { event_type: 'world_opening', payload: { msg: 'hello' } }
      ]
    });

    const result = applyOpening(pack, opening);
    expect(result.bootstrap?.initial_events).toHaveLength(1);
    expect(result.bootstrap?.initial_events?.[0]).toMatchObject({
      event_type: 'world_opening',
      payload: { msg: 'hello' }
    });
  });

  it('re-validates merged result', () => {
    const pack = parseWorldPackConstitution(packWithBootstrap);
    const opening = worldPackOpeningSchema.parse({
      initial_states: [] // valid but empty
    });

    const result = applyOpening(pack, opening);
    expect(result.metadata.id).toBe('test-pack');
  });
});

describe('worldPackOpeningSchema', () => {
  it('accepts valid opening with all fields', () => {
    const opening = worldPackOpeningSchema.parse({
      name: 'Hard Mode',
      description: 'A harder start',
      variables: { difficulty: 'hard' },
      initial_states: [
        {
          entity_id: '__world__',
          state_namespace: 'world',
          state_json: { phase: 'crisis' }
        }
      ],
      initial_events: [
        { event_type: 'world_opening', payload: { msg: 'start' } }
      ]
    });

    expect(opening.name).toBe('Hard Mode');
    expect(opening.variables).toEqual({ difficulty: 'hard' });
    expect(opening.initial_states).toHaveLength(1);
    expect(opening.initial_events).toHaveLength(1);
  });

  it('accepts minimal opening with only name', () => {
    const opening = worldPackOpeningSchema.parse({ name: 'Minimal' });
    expect(opening.name).toBe('Minimal');
    expect(opening.initial_states).toEqual([]);
    expect(opening.initial_events).toEqual([]);
  });

  it('accepts empty object with defaults', () => {
    const opening = worldPackOpeningSchema.parse({});
    expect(opening.name).toBeUndefined();
    expect(opening.initial_states).toEqual([]);
    expect(opening.initial_events).toEqual([]);
  });

  it('rejects invalid fields', () => {
    expect(() =>
      worldPackOpeningSchema.parse({
        name: 'Bad',
        invalid_field: 123
      })
    ).toThrow();
  });

  it('rejects initial_events without event_type', () => {
    expect(() =>
      worldPackOpeningSchema.parse({
        initial_events: [{ payload: { msg: 'bad' } }]
      })
    ).toThrow();
  });

  it('accepts initial_events with empty payload', () => {
    const opening = worldPackOpeningSchema.parse({
      initial_events: [
        { event_type: 'test' }
      ]
    });
    expect(opening.initial_events?.[0]?.payload).toEqual({});
  });
});
