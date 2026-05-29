import { describe, expect, it } from 'vitest';

import {
  parseWorldPackConstitution,
  spatialDiscreteEdgeSchema,
  spatialDiscreteLocationSchema,
  spatialDiscreteSchema,
  VALID_INCLUDE_SECTION_KEYS,
  worldPackOpeningSchema,
  worldPackVariablesRecordSchema
} from '../../../src/packs/schema/constitution_schema.js';

/* ──────────────────────────────────────────── helpers ──────────────────────────────────────────── */

const minimalPack = {
  metadata: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' }
} as const;

const packWithActor = (id: string) => ({
  ...minimalPack,
  entities: {
    actors: [{ id, label: `${id} Label` }],
    collectives: [],
    artifacts: [],
    mediators: [],
    domains: [],
    institutions: []
  }
});

/* ──────────────────────────────────────── metadata ─────────────────────────────────────────────── */

describe('metadataSchema', () => {
  it('accepts minimal metadata with required fields only', () => {
    const pack = parseWorldPackConstitution(minimalPack);
    expect(pack.metadata.id).toBe('test-pack');
    expect(pack.metadata.name).toBe('Test Pack');
    expect(pack.metadata.version).toBe('1.0.0');
  });

  it('accepts metadata with all optional fields', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      metadata: {
        id: 'full-meta',
        name: 'Full Meta',
        version: '2.0.0',
        description: 'A test pack',
        instance_id: 'inst-1',
        license: 'MIT',
        homepage: 'https://example.com',
        repository: 'https://github.com/example/repo',
        tags: ['test', 'sample'],
        published_at: '2026-01-01',
        status: 'stable',
        authors: [
          { name: 'Alice', role: 'lead', homepage: 'https://alice.dev' }
        ],
        presentation: {
          cover_image: 'cover.png',
          icon: 'icon.svg',
          theme: { color: 'blue' }
        },
        frontend: { type: 'default' }
      }
    });
    expect(pack.metadata.description).toBe('A test pack');
    expect(pack.metadata.authors).toHaveLength(1);
    expect(pack.metadata.frontend?.type).toBe('default');
  });

  it('accepts custom frontend manifest', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      metadata: {
        ...minimalPack.metadata,
        frontend: { type: 'custom', entry: './my-entry.ts' }
      }
    });
    expect(pack.metadata.frontend?.type).toBe('custom');
  });

  it('rejects empty metadata.id', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        metadata: { id: '', name: 'n', version: '1' }
      })
    ).toThrow(/id/);
  });

  it('rejects missing metadata.name', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        metadata: { id: 'x', version: '1' }
      })
    ).toThrow();
  });
});

/* ──────────────────────────────────── entities ──────────────────────────────────────────── */

describe('entitiesSchema', () => {
  it('defaults all entity groups to empty arrays', () => {
    const pack = parseWorldPackConstitution(minimalPack);
    expect(pack.entities?.actors).toEqual([]);
    expect(pack.entities?.collectives).toEqual([]);
    expect(pack.entities?.artifacts).toEqual([]);
    expect(pack.entities?.mediators).toEqual([]);
    expect(pack.entities?.domains).toEqual([]);
    expect(pack.entities?.institutions).toEqual([]);
  });

  it('accepts actors with all optional fields', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      entities: {
        actors: [
          {
            id: 'hero',
            label: 'Hero',
            kind: 'actor',
            entity_type: 'human',
            tags: ['player'],
            static_schema_ref: 'human_schema',
            state: { hp: 100 },
            claims: { role: 'protagonist' },
            metadata: { gender: 'female' },
            inference: { provider: 'behavior_tree', behavior_tree: 'hero_bt' }
          }
        ],
        collectives: [],
        artifacts: [],
        mediators: [],
        domains: [],
        institutions: []
      }
    });
    const actor = pack.entities?.actors[0];
    expect(actor?.entity_type).toBe('human');
    expect(actor?.tags).toEqual(['player']);
    expect(actor?.state?.hp).toBe(100);
  });

  it('rejects duplicate entity ids across groups', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        entities: {
          actors: [{ id: 'dup', label: 'A' }],
          collectives: [{ id: 'dup', label: 'B' }],
          artifacts: [],
          mediators: [],
          domains: [],
          institutions: []
        }
      })
    ).toThrow(/unique/i);
  });

  it('accepts mediators with grants and effects', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      entities: {
        actors: [{ id: 'a1', label: 'A1' }],
        collectives: [],
        artifacts: [],
        mediators: [
          {
            id: 'm1',
            entity_ref: 'a1',
            mediator_kind: 'contract',
            grants: [{ capability_key: 'read_state' }],
            requires: ['some_requirement'],
            binding_rules: ['rule1'],
            perception_effects: ['effect1'],
            execution_effects: ['effect2'],
            override_rules: [],
            revocation_rules: []
          }
        ],
        domains: [],
        institutions: []
      }
    });
    expect(pack.entities?.mediators[0].mediator_kind).toBe('contract');
    expect(pack.entities?.mediators[0].grants[0].capability_key).toBe('read_state');
  });
});

/* ──────────────────────────────────── identities ──────────────────────────────────────────── */

describe('identityDefinitionSchema', () => {
  it('accepts valid identity referencing an existing entity', () => {
    const pack = parseWorldPackConstitution({
      ...packWithActor('actor1'),
      identities: [
        {
          id: 'id1',
          subject_entity_id: 'actor1',
          type: 'player',
          claims: { skill: 'advanced' },
          metadata: { source: 'test' }
        }
      ]
    });
    expect(pack.identities).toHaveLength(1);
    expect(pack.identities?.[0].subject_entity_id).toBe('actor1');
  });

  it('rejects identity referencing unknown entity', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        entities: {
          actors: [],
          collectives: [],
          artifacts: [],
          mediators: [],
          domains: [],
          institutions: []
        },
        identities: [
          { id: 'id1', subject_entity_id: 'nonexistent', type: 'player' }
        ]
      })
    ).toThrow(/unknown actor/i);
  });
});

/* ──────────────────────────────────── capabilities ──────────────────────────────────────────── */

describe('capabilityDefinitionSchema', () => {
  it('accepts capability with all optional fields', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      capabilities: [
        {
          key: 'read_state',
          category: 'perceive',
          description: 'Read entity state',
          target_schema: 'some_schema',
          requires_subject_schema: 'subject_schema',
          default_visibility: 'public',
          default_constraints: { max_depth: 3 }
        }
      ]
    });
    expect(pack.capabilities).toHaveLength(1);
    expect(pack.capabilities?.[0].default_visibility).toBe('public');
  });

  it('accepts minimal capability with only required fields', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      capabilities: [{ key: 'test_cap', category: 'invoke' }]
    });
    expect(pack.capabilities?.[0].key).toBe('test_cap');
  });
});

/* ──────────────────────────────────── authorities & target selectors ─────────────────────────── */

describe('authorityDefinitionSchema & targetSelectorSchema', () => {
  it('accepts authority with direct_entity target selector', () => {
    const pack = parseWorldPackConstitution({
      ...packWithActor('src'),
      authorities: [
        {
          id: 'auth1',
          source_entity_id: 'src',
          target_selector: { kind: 'direct_entity', entity_id: 'src' },
          capability_key: 'read_state',
          grant_type: 'intrinsic'
        }
      ]
    });
    expect(pack.authorities?.[0].grant_type).toBe('intrinsic');
  });

  it('rejects target selector holder_of without entity_id', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...packWithActor('src'),
        authorities: [
          {
            id: 'auth1',
            source_entity_id: 'src',
            target_selector: { kind: 'holder_of' },
            capability_key: 'cap',
            grant_type: 'intrinsic'
          }
        ]
      })
    ).toThrow(/requires entity_id/);
  });

  it('rejects target selector subject_entity without entity_id or identity_id', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...packWithActor('src'),
        authorities: [
          {
            id: 'auth1',
            source_entity_id: 'src',
            target_selector: { kind: 'subject_entity' },
            capability_key: 'cap',
            grant_type: 'intrinsic'
          }
        ]
      })
    ).toThrow(/requires entity_id or identity_id/);
  });

  it('rejects target selector entity_type_is without entity_type', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...packWithActor('src'),
        authorities: [
          {
            id: 'auth1',
            source_entity_id: 'src',
            target_selector: { kind: 'entity_type_is' },
            capability_key: 'cap',
            grant_type: 'intrinsic'
          }
        ]
      })
    ).toThrow(/requires entity_type/);
  });

  it('accepts authority with all optional fields', () => {
    const pack = parseWorldPackConstitution({
      ...packWithActor('src'),
      authorities: [
        {
          id: 'auth2',
          source_entity_id: 'src',
          target_selector: { kind: 'entity_type_is', entity_type: 'human' },
          capability_key: 'cap',
          grant_type: 'mediated',
          mediated_by_entity_id: 'src',
          scope_json: { level: 'admin' },
          conditions_json: { active: true },
          priority: 10,
          status: 'active',
          revocable: true
        }
      ]
    });
    expect(pack.authorities?.[0].priority).toBe(10);
    expect(pack.authorities?.[0].revocable).toBe(true);
  });
});

/* ──────────────────────────────────── rules ──────────────────────────────────────────── */

describe('rulesSchema', () => {
  it('defaults all rule groups to empty arrays', () => {
    const pack = parseWorldPackConstitution(minimalPack);
    expect(pack.rules?.perception).toEqual([]);
    expect(pack.rules?.capability_resolution).toEqual([]);
    expect(pack.rules?.invocation).toEqual([]);
    expect(pack.rules?.objective_enforcement).toEqual([]);
    expect(pack.rules?.projection).toEqual([]);
  });

  it('accepts perception rules', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      rules: {
        perception: [
          {
            id: 'p1',
            when: {
              observer_at: 'same',
              event_visibility: 'public',
              observer_is_actor: true,
              investigation_count_min: 1,
              observer_has_capability: 'see'
            },
            then: {
              level: 'full',
              reveal_public: true,
              reveal_hidden: false,
              max_hidden_segments: 3
            }
          }
        ],
        capability_resolution: [],
        invocation: [],
        objective_enforcement: [],
        projection: []
      }
    });
    expect(pack.rules?.perception[0].when.observer_at).toBe('same');
  });

  it('accepts projection rules', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        objective_enforcement: [],
        projection: [
          {
            id: 'proj1',
            when: { tick_interval: 10, entity_type_is: 'actor' },
            then: {
              compute: 'count',
              source_entity_type: 'actor',
              target_projection: 'total_actors',
              aggregate_by: ['region'],
              filter_condition: { active: true }
            }
          }
        ]
      }
    });
    expect(pack.rules?.projection[0].then.compute).toBe('count');
  });

  it('accepts objective_enforcement with kernel intent types', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        objective_enforcement: [
          {
            id: 'oe1',
            when: { invocation_type: 'trigger_event' },
            then: { action: 'log' }
          },
          {
            id: 'oe2',
            when: { invocation_type: 'post_message' },
            then: { action: 'route' }
          },
          {
            id: 'oe3',
            when: { invocation_type: 'adjust_relationship' },
            then: { action: 'route' }
          },
          {
            id: 'oe4',
            when: { invocation_type: 'adjust_snr' },
            then: { action: 'route' }
          }
        ],
        projection: []
      }
    });
    expect(pack.rules?.objective_enforcement).toHaveLength(4);
  });

  it('accepts objective_enforcement with invoke. prefix', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        objective_enforcement: [
          {
            id: 'oe1',
            when: { invocation_type: 'invoke.my_capability' },
            then: { action: 'do_something' }
          }
        ],
        projection: []
      }
    });
    expect(pack.rules?.objective_enforcement[0].when.invocation_type).toBe('invoke.my_capability');
  });

  it('rejects objective_enforcement with invalid invocation_type', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        rules: {
          perception: [],
          capability_resolution: [],
          invocation: [],
          objective_enforcement: [
            {
              id: 'oe1',
              when: { invocation_type: 'bad_type' },
              then: { action: 'do' }
            }
          ],
          projection: []
        }
      })
    ).toThrow(/invoke\.bad_type/);
  });
});

/* ──────────────────────────────────── state transforms ──────────────────────────────────────────── */

describe('stateTransformSchema', () => {
  it('accepts valid state transform with non-overlapping ranges', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      state_transforms: [
        {
          source: 'trust',
          ranges: [
            { min: 0, max: 30, label: 'hostile' },
            { min: 31, max: 70, label: 'neutral' },
            { min: 71, max: 100, label: 'friendly' }
          ],
          target: 'trust_level'
        }
      ]
    });
    expect(pack.state_transforms).toHaveLength(1);
    expect(pack.state_transforms?.[0].target).toBe('trust_level');
  });

  it('rejects range with min > max', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        state_transforms: [
          {
            source: 's',
            ranges: [{ min: 100, max: 0, label: 'bad' }],
            target: 't'
          }
        ]
      })
    ).toThrow(/min.*max/);
  });

  it('rejects duplicate range labels', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        state_transforms: [
          {
            source: 's',
            ranges: [
              { min: 0, max: 50, label: 'same' },
              { min: 51, max: 100, label: 'same' }
            ],
            target: 't'
          }
        ]
      })
    ).toThrow(/unique/);
  });

  it('rejects duplicate state_transform targets', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        state_transforms: [
          {
            source: 'a',
            ranges: [{ min: 0, max: 100, label: 'x' }],
            target: 'dup_target'
          },
          {
            source: 'b',
            ranges: [{ min: 0, max: 100, label: 'y' }],
            target: 'dup_target'
          }
        ]
      })
    ).toThrow(/Duplicate state_transform target/);
  });
});

/* ──────────────────────────────────── spatial ──────────────────────────────────────────── */

describe('spatialSchema', () => {
  it('accepts valid discrete spatial model', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      entities: {
        actors: [],
        collectives: [],
        artifacts: [],
        mediators: [],
        domains: [{ id: 'town', label: 'Town' }, { id: 'forest', label: 'Forest' }],
        institutions: []
      },
      spatial: {
        model: 'discrete',
        locations: [{ id: 'town' }, { id: 'forest' }],
        edges: [
          { from: 'town', to: 'forest', type: 'bidirectional', weight: 2 }
        ]
      }
    });
    expect(pack.spatial?.model).toBe('discrete');
  });

  it('rejects spatial location referencing non-domain entity', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        entities: {
          actors: [],
          collectives: [],
          artifacts: [],
          mediators: [],
          domains: [],
          institutions: []
        },
        spatial: {
          model: 'discrete',
          locations: [{ id: 'nonexistent' }]
        }
      })
    ).toThrow(/entities\.domains/);
  });

  it('rejects spatial edge.from referencing non-domain entity', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        entities: {
          actors: [],
          collectives: [],
          artifacts: [],
          mediators: [],
          domains: [{ id: 'd1', label: 'D1' }],
          institutions: []
        },
        spatial: {
          model: 'discrete',
          locations: [{ id: 'd1' }],
          edges: [{ from: 'missing', to: 'd1' }]
        }
      })
    ).toThrow(/entities\.domains/);
  });

  it('rejects spatial edge.to referencing non-domain entity', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        entities: {
          actors: [],
          collectives: [],
          artifacts: [],
          mediators: [],
          domains: [{ id: 'd1', label: 'D1' }],
          institutions: []
        },
        spatial: {
          model: 'discrete',
          locations: [{ id: 'd1' }],
          edges: [{ from: 'd1', to: 'missing' }]
        }
      })
    ).toThrow(/entities\.domains/);
  });

  it('rejects empty locations array', () => {
    expect(() =>
      spatialDiscreteSchema.parse({
        model: 'discrete',
        locations: []
      })
    ).toThrow();
  });
});


/* ──────────────────────────────────── bootstrap & opening ─────────────────────────────────── */

describe('bootstrapSchema', () => {
  it('defaults initial_states and initial_events to empty', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      bootstrap: {}
    });
    expect(pack.bootstrap?.initial_states).toEqual([]);
    expect(pack.bootstrap?.initial_events).toEqual([]);
  });

  it('accepts bootstrap with initial states and events', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: { phase: 'dawn' }
          }
        ],
        initial_events: [
          {
            event_type: 'world.init',
            payload: { key: 'value' }
          }
        ]
      }
    });
    expect(pack.bootstrap?.initial_states).toHaveLength(1);
    expect(pack.bootstrap?.initial_events).toHaveLength(1);
  });
});

describe('worldPackOpeningSchema', () => {
  it('accepts opening with all fields', () => {
    const opening = worldPackOpeningSchema.parse({
      name: 'Opening 1',
      description: 'First opening',
      variables: { difficulty: 'hard' },
      initial_states: [
        {
          entity_id: 'e1',
          state_namespace: 'ns',
          state_json: { val: 42 }
        }
      ],
      initial_events: [
        {
          event_type: 'start',
          payload: { signal: true }
        }
      ]
    });
    expect(opening.name).toBe('Opening 1');
    expect(opening.initial_states).toHaveLength(1);
  });

  it('defaults initial_states and initial_events to empty arrays', () => {
    const opening = worldPackOpeningSchema.parse({});
    expect(opening.initial_states).toEqual([]);
    expect(opening.initial_events).toEqual([]);
  });
});

describe('worldPackVariablesRecordSchema', () => {
  it('accepts string, number, boolean, array, and nested record values', () => {
    const parsed = worldPackVariablesRecordSchema.parse({
      name: 'world',
      count: 42,
      active: true,
      tags: ['a', 'b'],
      nested: { deep: true }
    });
    expect(parsed.name).toBe('world');
    expect(parsed.count).toBe(42);
  });

  it('rejects null values', () => {
    expect(() => worldPackVariablesRecordSchema.parse({ bad: null })).toThrow();
  });
});

/* ──────────────────────────────────── time systems / calendar ───────────────────────────────── */

describe('timeUnitSchema & calendarConfigSchema', () => {
  it('accepts time unit with ratio', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      time_systems: [
        {
          id: 'cal1',
          name: 'Standard Calendar',
          tick_rate: 1,
          units: [
            { name: 'hour', ratio: 60 },
            { name: 'day', ratio: 24 }
          ]
        }
      ]
    });
    expect(pack.time_systems).toHaveLength(1);
    expect(pack.time_systems?.[0].units).toHaveLength(2);
  });

  it('accepts time unit with irregular_ratios', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      time_systems: [
        {
          id: 'cal1',
          name: 'Lunar Calendar',
          tick_rate: 1,
          units: [{ name: 'moon', irregular_ratios: [28, 29, 30] }]
        }
      ]
    });
    expect(pack.time_systems?.[0].units[0].irregular_ratios).toEqual([28, 29, 30]);
  });

  it('rejects time unit without ratio or irregular_ratios', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        time_systems: [
          {
            id: 'cal1',
            name: 'Bad Calendar',
            tick_rate: 1,
            units: [{ name: 'bad_unit' }]
          }
        ]
      })
    ).toThrow(/ratio or irregular_ratios/);
  });

  it('rejects negative tick_rate', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        time_systems: [
          {
            id: 'cal1',
            name: 'Bad Calendar',
            tick_rate: -1,
            units: [{ name: 'hour', ratio: 60 }]
          }
        ]
      })
    ).toThrow();
  });
});

/* ──────────────────────────────────── simulation time ──────────────────────────────────────── */

describe('simulationTimeConfigSchema', () => {
  it('accepts simulation time with tick-like strings and numbers', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      simulation_time: {
        min_tick: 0,
        max_tick: 1000,
        initial_tick: 'start_tick',
        step: {
          strategy: 'variable',
          range: { min: 1, max: 10 },
          loop_interval_ms: 100,
          adaptive: {
            target_loop_ms: 200,
            scale_up_threshold_ms: 300,
            scale_down_threshold_ms: 50
          }
        }
      }
    });
    expect(pack.simulation_time?.min_tick).toBe(0);
    expect(pack.simulation_time?.step?.strategy).toBe('variable');
  });

  it('accepts empty simulation_time (all fields optional)', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      simulation_time: {}
    });
    expect(pack.simulation_time).toBeDefined();
  });
});

/* ──────────────────────────────────── AI config ──────────────────────────────────── */

describe('aiPackConfigSchema', () => {
  it('accepts ai config with defaults, memory_loop, tasks, and slots', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      ai: {
        defaults: {
          prompt_preset: 'default_preset',
          decoder: 'json',
          route_id: 'route1',
          privacy_tier: 'local_only'
        },
        memory_loop: {
          summary_every_n_rounds: 5,
          compaction_every_n_rounds: 10
        },
        tasks: {
          agent_decision: {
            prompt: {
              preset: 'custom',
              system_append: 'extra system prompt',
              developer_append: 'dev note',
              user_prefix: 'User says:',
              include_sections: ['context', 'history'],
              examples: [{ input: 'hi', output: 'hello' }]
            },
            output: {
              mode: 'json_object',
              schema: { response: 'string' },
              strict: true
            },
            parse: {
              decoder: 'json',
              unwrap: 'data',
              field_alias: { resp: 'response' },
              required_fields: ['resp'],
              defaults: { resp: '' }
            },
            route: {
              route_id: 'r1',
              provider: 'openai',
              model: 'gpt-4',
              latency_tier: 'interactive',
              determinism_tier: 'strict',
              privacy_tier: 'local_only'
            },
            metadata: { extra: 'info' }
          }
        },
        slots: {
          main: {
            display_name: 'Main Slot',
            description: 'Primary prompt slot',
            default_priority: 10,
            position: 0,
            anchor: { ref: 'base', relation: 'after' },
            default_template: 'Hello {{name}}',
            template_context: 'inference',
            message_role: 'system',
            include_in_combined: true,
            combined_heading: 'Main',
            enabled: true,
            metadata: { custom: true }
          }
        }
      }
    });
    expect(pack.ai?.defaults?.privacy_tier).toBe('local_only');
    expect(pack.ai?.tasks?.agent_decision?.output?.mode).toBe('json_object');
    expect(pack.ai?.slots?.main?.display_name).toBe('Main Slot');
  });
});

/* ──────────────────────────────────── constitution ──────────────────────────────────── */

describe('constitutionSchema', () => {
  it('defaults axioms and namespaces to empty arrays', () => {
    const pack = parseWorldPackConstitution(minimalPack);
    expect(pack.constitution?.axioms).toEqual([]);
    expect(pack.constitution?.namespaces).toEqual([]);
  });

  it('accepts custom axioms and namespaces', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      constitution: {
        axioms: ['axiom1', 'axiom2'],
        namespaces: ['ns1']
      }
    });
    expect(pack.constitution?.axioms).toEqual(['axiom1', 'axiom2']);
  });
});

/* ──────────────────────────────────── variables & prompts ─────────────────────────────────── */

describe('variables & prompts', () => {
  it('accepts top-level variables with nested values', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      variables: {
        greeting: 'hello',
        max_hp: 100,
        is_active: true,
        tags: ['ranger', 'mage'],
        settings: { difficulty: 'hard' }
      }
    });
    expect(pack.variables?.greeting).toBe('hello');
    expect(pack.variables?.settings).toEqual({ difficulty: 'hard' });
  });

  it('accepts prompts as string record', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      prompts: {
        system: 'You are a game master.',
        user: 'Player action:'
      }
    });
    expect(pack.prompts?.system).toBe('You are a game master.');
  });
});

/* ──────────────────────────────────── legacy field rejection ──────────────────────────────────── */

describe('legacy field rejection', () => {
  it('rejects legacy field actions', () => {
    expect(() =>
      parseWorldPackConstitution({ ...minimalPack, actions: [] })
    ).toThrow(/Legacy field actions/);
  });

  it('rejects legacy field decision_rules', () => {
    expect(() =>
      parseWorldPackConstitution({ ...minimalPack, decision_rules: [] })
    ).toThrow(/Legacy field decision_rules/);
  });

  it('rejects legacy scenario.agents', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        scenario: { agents: [] }
      })
    ).toThrow(/Legacy scenario\.agents/);
  });

  it('rejects legacy scenario.artifacts', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        scenario: { artifacts: [] }
      })
    ).toThrow(/Legacy scenario\.artifacts/);
  });

  it('rejects legacy scenario.relationships', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        scenario: { relationships: [] }
      })
    ).toThrow(/Legacy scenario\.relationships/);
  });

  it('rejects legacy field event_templates', () => {
    expect(() =>
      parseWorldPackConstitution({ ...minimalPack, event_templates: [] })
    ).toThrow(/Legacy field event_templates/);
  });

  it('rejects standalone legacy scenario field', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        scenario: { someField: true }
      })
    ).toThrow(/Legacy field scenario/);
  });
});

/* ──────────────────────────────────── scheduler config ──────────────────────────────────── */

describe('scheduler config', () => {
  it('accepts scheduler with partition_count', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      scheduler: { partition_count: 4 }
    });
    expect(pack.scheduler?.partition_count).toBe(4);
  });

  it('accepts empty scheduler object', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      scheduler: {}
    });
    expect(pack.scheduler).toBeDefined();
  });

  it('rejects non-positive partition_count', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        scheduler: { partition_count: 0 }
      })
    ).toThrow();
  });
});

/* ──────────────────────────────────── include ──────────────────────────────────── */

describe('include schema', () => {
  it('accepts include record with valid keys', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      include: {
        schema_version: 'path/to/schema.yaml',
        metadata: 'path/to/metadata.yaml'
      }
    });
    expect(pack.include?.schema_version).toBe('path/to/schema.yaml');
  });

  it('export VALID_INCLUDE_SECTION_KEYS has expected keys', () => {
    expect(VALID_INCLUDE_SECTION_KEYS).toContain('schema_version');
    expect(VALID_INCLUDE_SECTION_KEYS).toContain('metadata');
    expect(VALID_INCLUDE_SECTION_KEYS).toContain('entities');
    expect(VALID_INCLUDE_SECTION_KEYS).toContain('workflows');
  });
});

/* ──────────────────────────────────── parseWorldPackConstitution ──────────────────────────────── */

describe('parseWorldPackConstitution', () => {
  it('returns parsed data on valid input', () => {
    const pack = parseWorldPackConstitution(minimalPack);
    expect(pack.metadata.id).toBe('test-pack');
  });

  it('throws with formatted validation error on invalid input', () => {
    expect(() => parseWorldPackConstitution({})).toThrow(/WorldPackLoader/);
  });

  it('uses custom source label in error message', () => {
    expect(() => parseWorldPackConstitution({}, 'my-pack')).toThrow(/my-pack/);
  });

  it('accepts schema_version', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      schema_version: 1
    });
    expect(pack.schema_version).toBe(1);
  });

  it('defaults schema_version to 0', () => {
    const pack = parseWorldPackConstitution(minimalPack);
    expect(pack.schema_version).toBe(0);
  });
});

/* ──────────────────────────────────── actor inference ──────────────────────────────────── */

describe('actorInferenceSchema', () => {
  it('accepts behavior_tree provider', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      entities: {
        actors: [
          {
            id: 'a1',
            label: 'A1',
            inference: { provider: 'behavior_tree', behavior_tree: 'my_tree' }
          }
        ],
        collectives: [],
        artifacts: [],
        mediators: [],
        domains: [],
        institutions: []
      }
    });
    expect(pack.entities?.actors[0].inference?.provider).toBe('behavior_tree');
  });

  it('accepts anthropic provider with model', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      entities: {
        actors: [
          {
            id: 'a1',
            label: 'A1',
            inference: { provider: 'anthropic', model: 'claude-3' }
          }
        ],
        collectives: [],
        artifacts: [],
        mediators: [],
        domains: [],
        institutions: []
      }
    });
    expect(pack.entities?.actors[0].inference?.provider).toBe('anthropic');
  });

  it('accepts openai_compatible provider with model', () => {
    const pack = parseWorldPackConstitution({
      ...minimalPack,
      entities: {
        actors: [
          {
            id: 'a1',
            label: 'A1',
            inference: { provider: 'openai_compatible', model: 'gpt-4' }
          }
        ],
        collectives: [],
        artifacts: [],
        mediators: [],
        domains: [],
        institutions: []
      }
    });
    expect(pack.entities?.actors[0].inference?.provider).toBe('openai_compatible');
  });

  it('rejects unknown provider', () => {
    expect(() =>
      parseWorldPackConstitution({
        ...minimalPack,
        entities: {
          actors: [
            {
              id: 'a1',
              label: 'A1',
              inference: { provider: 'unknown_provider', model: 'x' }
            }
          ],
          collectives: [],
          artifacts: [],
          mediators: [],
          domains: [],
          institutions: []
        }
      })
    ).toThrow(/provider/);
  });
});

/* ──────────────────────────────────── spatial schemas exported ──────────────────────────────── */

describe('spatialDiscreteLocationSchema', () => {
  it('accepts valid location', () => {
    const loc = spatialDiscreteLocationSchema.parse({ id: 'town' });
    expect(loc.id).toBe('town');
  });

  it('rejects empty id', () => {
    expect(() => spatialDiscreteLocationSchema.parse({ id: '' })).toThrow();
  });
});

describe('spatialDiscreteEdgeSchema', () => {
  it('accepts edge with defaults', () => {
    const edge = spatialDiscreteEdgeSchema.parse({ from: 'a', to: 'b' });
    expect(edge.type).toBe('bidirectional');
    expect(edge.weight).toBe(1);
  });

  it('accepts directed edge with custom weight', () => {
    const edge = spatialDiscreteEdgeSchema.parse({
      from: 'a',
      to: 'b',
      type: 'directed',
      weight: 5.5
    });
    expect(edge.type).toBe('directed');
    expect(edge.weight).toBe(5.5);
  });

  it('rejects non-positive weight', () => {
    expect(() =>
      spatialDiscreteEdgeSchema.parse({ from: 'a', to: 'b', weight: 0 })
    ).toThrow();
  });
});
