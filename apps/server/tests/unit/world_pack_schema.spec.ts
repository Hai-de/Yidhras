import { describe, expect, it } from 'vitest';

import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';

describe('world pack constitution schema', () => {
  it('accepts the new constitution/storage contract', () => {
    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-test-pack',
        name: '测试世界',
        version: '1.0.0',
        description: '用于测试 world pack 发布元数据与治理 contract 的世界。',
        authors: [
          {
            name: 'Yidhras Team',
            role: 'maintainer',
            homepage: 'https://example.com/team'
          }
        ],
        license: 'MIT',
        homepage: 'https://example.com/world-test-pack',
        repository: 'https://example.com/repo/world-test-pack',
        tags: ['test', 'governance'],
        compatibility: {
          yidhras: '>=0.5.0',
          schema_version: 'world-pack/v1'
        }
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
        invocation: [
          {
            id: 'invocation-1',
            when: {
              'semantic_intent.kind': 'judge_target'
            },
            then: {
              affordance_key: 'execute_judgement',
              requires_capability: 'invoke.death_rule',
              resolution_mode: 'exact'
            }
          }
        ],
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
    expect(pack.metadata.authors?.[0]?.name).toBe('Yidhras Team');
    expect(pack.metadata.license).toBe('MIT');
    expect(pack.metadata.compatibility?.schema_version).toBe('world-pack/v1');
    expect(pack.bootstrap?.initial_states[0]?.state_json.opening_phase).toBe('notebook_unclaimed');
    expect(pack.rules?.invocation[0]?.then.affordance_key).toBe('execute_judgement');
  });

  it('accepts richer death note invocation and objective rule declarations', () => {
    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-death-note-rich',
        name: '死亡笔记测试世界',
        version: '1.0.0'
      },
      entities: {
        actors: [
          {
            id: 'agent-001',
            label: '夜神月',
            kind: 'actor',
            state: {
              alive: true,
              current_target_id: null,
              target_judgement_eligibility: false
            }
          },
          {
            id: 'agent-002',
            label: 'L',
            kind: 'actor',
            state: {
              alive: true
            }
          }
        ],
        artifacts: [
          {
            id: 'artifact-death-note',
            label: '死亡笔记',
            kind: 'artifact',
            state: {
              holder_agent_id: null,
              visibility_level: 'hidden'
            }
          }
        ],
        mediators: [
          {
            id: 'mediator-death-note',
            entity_ref: 'artifact-death-note',
            mediator_kind: 'artifact_vessel',
            grants: [
              { capability_key: 'invoke.claim_death_note' },
              { capability_key: 'invoke.collect_target_intel' },
              { capability_key: 'invoke.execute_death_note' }
            ]
          }
        ],
        domains: [],
        institutions: []
      },
      capabilities: [
        {
          key: 'invoke.claim_death_note',
          category: 'invoke',
          target_schema: 'artifact'
        },
        {
          key: 'invoke.collect_target_intel',
          category: 'invoke',
          target_schema: 'actor'
        },
        {
          key: 'invoke.execute_death_note',
          category: 'invoke',
          target_schema: 'actor'
        }
      ],
      authorities: [
        {
          id: 'grant-claim',
          source_entity_id: 'mediator-death-note',
          target_selector: {
            kind: 'direct_entity',
            entity_id: 'agent-001'
          },
          capability_key: 'invoke.claim_death_note',
          grant_type: 'mediated'
        }
      ],
      rules: {
        invocation: [
          {
            id: 'invocation-ritual-fallback',
            when: {
              'semantic_intent.kind': 'ritual_divination'
            },
            then: {
              affordance_key: 'gather_target_intel',
              resolution_mode: 'narrativized',
              narrativize_event: {
                type: 'history',
                title: '{{ actor.id }} 试图通过民间仪式确认目标命运',
                description: '{{ actor.id }} 进行了一次近乎荒诞的仪式尝试，但世界规则没有给出客观回应。',
                impact_data: {
                  semantic_type: 'failed_ritual_attempt',
                  failed_attempt: true,
                  objective_effect_applied: false
                }
              }
            }
          }
        ],
        objective_enforcement: [
          {
            id: 'rule-collect-intel',
            when: {
              capability: 'invoke.collect_target_intel',
              'target.kind': 'actor'
            },
            then: {
              mutate: {
                subject_state: {
                  known_target_id: '{{ invocation.target_entity_id }}',
                  target_judgement_eligibility: true
                }
              }
            }
          },
          {
            id: 'rule-execute-judgement',
            when: {
              capability: 'invoke.execute_death_note',
              'target.kind': 'actor'
            },
            then: {
              mutate: {
                target_state: {
                  alive: false,
                  death_cause: 'cardiac_arrest'
                },
                world_state: {
                  kira_case_phase: 'kira_active'
                }
              },
              emit_events: [
                {
                  type: 'history',
                  title: '{{ target.id }} 在异常条件下死亡',
                  description: '一次高度可疑且缺乏直接物理证据的死亡事件引发了社会震荡。',
                  impact_data: {
                    semantic_type: 'suspicious_death_occurred',
                    objective_effect_applied: true
                  }
                }
              ]
            }
          }
        ]
      },
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: {
              kira_case_phase: 'pre_kira',
              investigation_heat: 0
            }
          }
        ],
        initial_events: []
      }
    });

    expect(pack.rules?.invocation[0]?.then.resolution_mode).toBe('narrativized');
    const secondRule = pack.rules?.objective_enforcement[1];
    const secondRuleThen = secondRule?.then as Record<string, unknown> | undefined;
    const emittedEvents = Array.isArray(secondRuleThen?.emit_events) ? secondRuleThen.emit_events : [];
    const firstEvent = emittedEvents[0];
    expect((firstEvent as Record<string, unknown>)?.type).toBe('history');
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
