import { describe, expect, it } from 'vitest';

import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';

describe('world pack constitution schema', () => {
  it('accepts the new constitution/storage contract', () => {
    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-test-pack',
        name: '测试世界',
        version: '1.0.0'
      },
      constitution: {
        axioms: ['world_rule_objective'],
        namespaces: ['core']
      },
      entities: {
        actors: [
          {
            id: 'actor-1',
            label: '主体一',
            kind: 'actor',
            tags: ['human']
          }
        ],
        artifacts: [
          {
            id: 'artifact-1',
            label: '器物一',
            kind: 'artifact'
          }
        ],
        mediators: [
          {
            id: 'mediator-1',
            entity_ref: 'artifact-1',
            mediator_kind: 'artifact_vessel',
            grants: [{ capability_key: 'invoke.death_rule' }]
          }
        ],
        domains: [],
        institutions: []
      },
      identities: [
        {
          id: 'identity-1',
          subject_entity_id: 'actor-1',
          type: 'mortal'
        }
      ],
      capabilities: [
        {
          key: 'invoke.death_rule',
          category: 'invoke',
          target_schema: 'actor'
        }
      ],
      authorities: [
        {
          id: 'authority-1',
          source_entity_id: 'mediator-1',
          target_selector: {
            kind: 'holder_of',
            entity_id: 'artifact-1'
          },
          capability_key: 'invoke.death_rule',
          grant_type: 'mediated'
        }
      ],
      rules: {
        objective_enforcement: [
          {
            id: 'rule-1',
            when: {
              capability: 'invoke.death_rule'
            },
            then: {
              mutate: {
                target_state: {
                  life_status: 'dead'
                }
              }
            }
          }
        ]
      },
      storage: {
        strategy: 'isolated_pack_db',
        runtime_db_file: 'runtime.sqlite',
        engine_owned_collections: ['world_entities', 'authority_grants'],
        pack_collections: [
          {
            key: 'death_rule_targets',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'target_entity_id', type: 'entity_ref', required: true },
              { key: 'status', type: 'string', required: true }
            ],
            indexes: [['target_entity_id']]
          }
        ],
        install: {
          compile_on_activate: true,
          allow_pack_collections: true,
          allow_raw_sql: false
        }
      },
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: {
              opening_phase: 'notebook_unclaimed'
            }
          }
        ],
        initial_events: []
      }
    });

    expect(pack.metadata.id).toBe('world-test-pack');
    expect(pack.storage?.pack_collections[0]?.key).toBe('death_rule_targets');
    expect(pack.authorities?.[0]?.target_selector.kind).toBe('holder_of');
    expect(pack.bootstrap?.initial_states[0]?.state_json.opening_phase).toBe('notebook_unclaimed');
  });

  it('rejects storage schemas that shadow engine-owned collections', () => {
    expect(() =>
      parseWorldPackConstitution({
        metadata: {
          id: 'world-invalid-pack',
          name: '非法世界',
          version: '1.0.0'
        },
        storage: {
          strategy: 'isolated_pack_db',
          runtime_db_file: 'runtime.sqlite',
          engine_owned_collections: ['world_entities'],
          pack_collections: [
            {
              key: 'world_entities',
              kind: 'table',
              primary_key: 'id',
              fields: [{ key: 'id', type: 'string', required: true }]
            }
          ]
        }
      })
    ).toThrow(/shadow engine-owned collection/);
  });

  it('rejects legacy actions/decision_rules/scenario/event_templates compatibility', () => {
    expect(() =>
      parseWorldPackConstitution({
        metadata: {
          id: 'world-legacy-pack',
          name: '旧世界',
          version: '0.1.0'
        },
        scenario: {
          agents: [
            {
              id: 'agent-1',
              name: '角色一',
              type: 'active'
            }
          ],
          artifacts: [
            {
              id: 'artifact-legacy',
              kind: 'notebook',
              label: '旧笔记'
            }
          ],
          world_state: {
            opening_phase: 'legacy'
          }
        },
        event_templates: {
          legacy_event: {
            type: 'history',
            title: 'legacy',
            description: 'legacy'
          }
        },
        actions: {
          legacy_action: {
            executor: 'emit_event'
          }
        },
        decision_rules: [
          {
            id: 'legacy-rule',
            priority: 10,
            when: {
              latest_event: {
                semantic_type: 'legacy_event'
              }
            },
            decide: {
              action_type: 'legacy_action'
            }
          }
        ]
      })
    ).toThrow(
      /Legacy field actions is no longer accepted|Legacy field decision_rules is no longer accepted|Legacy field scenario is no longer accepted|Legacy field event_templates is no longer accepted/
    );
  });

  it('requires structured bootstrap initial_states records', () => {
    expect(() =>
      parseWorldPackConstitution({
        metadata: {
          id: 'world-invalid-bootstrap-pack',
          name: '非法初始化世界',
          version: '1.0.0'
        },
        bootstrap: {
          initial_states: [
            {
              opening_phase: 'notebook_unclaimed'
            }
          ],
          initial_events: []
        }
      })
    ).toThrow(/entity_id|state_namespace|state_json/);
  });
});
