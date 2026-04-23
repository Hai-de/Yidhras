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

  it('accepts death note cognition-oriented invocation extensions and ai memory loop config', () => {
    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-death-note-cognition-pack',
        name: '死亡笔记认知扩展世界',
        version: '1.0.0'
      },
      ai: {
        memory_loop: {
          summary_every_n_rounds: 5,
          compaction_every_n_rounds: 5
        },
        tasks: {
          intent_grounding_assist: {
            prompt: {
              preset: 'death_note_intent_grounding_v1',
              include_sections: ['pack_rules', 'recent_events']
            },
            metadata: {
              fallback_policy: 'prefer_existing_capability_or_narrativized'
            }
          },
          context_summary: {
            prompt: {
              preset: 'death_note_context_summary_v1'
            },
            metadata: {
              summary_axes: ['investigation_heat', 'target_profile_completeness']
            }
          },
          memory_compaction: {
            prompt: {
              preset: 'death_note_memory_compaction_v1'
            },
            metadata: {
              retention_bias: ['judgement_eligibility', 'execution_postmortem']
            }
          },
          classification: {
            prompt: {
              preset: 'death_note_classification_v1'
            },
            metadata: {
              labels: ['execution_window', 'false_lead', 'pressure_escalation']
            }
          }
        }
      },
      entities: {
        actors: [
          {
            id: 'agent-001',
            label: '夜神月',
            kind: 'actor',
            state: {
              alive: true,
              last_reflection_kind: null,
              judgement_strategy_phase: 'acquisition',
              exposure_risk: 0,
              last_dossier_update_tick: null,
              last_plan_revision_tick: null,
              last_postmortem_tick: null,
              current_hypothesis: null,
              pressure_response_mode: 'observe',
              target_intel_confidence: 0,
              target_judgement_eligibility: false,
              target_name_confirmed: false,
              target_face_confirmed: false,
              known_target_id: null,
              execution_window_confidence: 0,
              target_profile_completeness: 0,
              counter_investigation_readiness: 0
            }
          }
        ],
        artifacts: [],
        mediators: [],
        domains: [
          {
            id: 'domain-investigation',
            label: '调查域',
            kind: 'domain',
            tags: ['institutional', 'evidence'],
            state: {
              visibility: 'restricted',
              pressure_bias: 0.7
            }
          },
          {
            id: 'domain-public-opinion',
            label: '舆论域',
            kind: 'domain',
            tags: ['media', 'pressure'],
            state: {
              visibility: 'public',
              amplification_bias: 0.8
            }
          }
        ],
        institutions: [
          {
            id: 'institution-npa-taskforce',
            label: '基拉对策本部',
            kind: 'institution',
            tags: ['investigation', 'taskforce'],
            state: {
              alert_stage: 'routine',
              coordination_level: 0
            }
          },
          {
            id: 'institution-public-media',
            label: '公共媒体系统',
            kind: 'institution',
            tags: ['media', 'public_signal'],
            state: {
              amplification_level: 0
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
              investigation_coordination_level: 0,
              media_amplification_level: 0,
              false_lead_density: 0,
              supernatural_signal_visibility: 0,
              institutional_alert_stage: 'routine'
            }
          }
        ],
        initial_events: []
      },
      storage: {
        strategy: 'isolated_pack_db',
        runtime_db_file: 'runtime.sqlite',
        pack_collections: [
          {
            key: 'target_dossiers',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'target_entity_id', type: 'entity_ref', required: true },
              { key: 'confidence', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'target_entity_id']]
          },
          {
            key: 'judgement_plans',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'target_entity_id', type: 'entity_ref' },
              { key: 'phase', type: 'string' },
              { key: 'risk_score', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'phase']]
          },
          {
            key: 'investigation_threads',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'subject_entity_id', type: 'entity_ref', required: true },
              { key: 'evidence_strength', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'subject_entity_id']]
          }
        ],
        install: {
          compile_on_activate: true,
          allow_pack_collections: true,
          allow_raw_sql: false
        }
      },
      rules: {
        invocation: [
          {
            id: 'invocation-revise-plan',
            when: {
              'semantic_intent.kind': 'revise_judgement_plan'
            },
            then: {
              affordance_key: 'revise_judgement_plan',
              resolution_mode: 'narrativized',
              narrativize_event: {
                type: 'history',
                title: '{{ actor.id }} 重新修订了当前计划',
                description: '{{ actor.id }} 对下一步行动顺序、风险和时机判断做了新的内部规划。',
                impact_data: {
                  semantic_type: 'judgement_plan_revised',
                  objective_effect_applied: false
                }
              }
            }
          },
          {
            id: 'invocation-split-attention',
            when: {
              'semantic_intent.kind': 'split_investigation_attention'
            },
            then: {
              affordance_key: 'split_investigation_attention',
              requires_capability: 'invoke.raise_false_suspicion',
              resolution_mode: 'translated',
              translate_to_capability: 'invoke.raise_false_suspicion'
            }
          }
        ],
        objective_enforcement: [
          {
            id: 'rule-collect-intel-expanded',
            when: {
              capability: 'invoke.collect_target_intel'
            },
            then: {
              mutate: {
                subject_state: {
                  execution_window_confidence: 0.75,
                  target_profile_completeness: 0.85
                },
                world_state: {
                  media_amplification_level: 2,
                  false_lead_density: 1,
                  institutional_alert_stage: 'heightened'
                }
              }
            }
          }
        ]
      }
    });

    expect(pack.ai?.memory_loop?.summary_every_n_rounds).toBe(5);
    expect(pack.entities?.actors[0]?.state?.judgement_strategy_phase).toBe('acquisition');
    expect(pack.ai?.tasks?.intent_grounding_assist?.prompt?.preset).toBe('death_note_intent_grounding_v1');
    expect(pack.ai?.tasks?.context_summary?.metadata?.summary_axes).toEqual(['investigation_heat', 'target_profile_completeness']);
    expect(pack.ai?.tasks?.memory_compaction?.metadata?.retention_bias).toEqual(['judgement_eligibility', 'execution_postmortem']);
    expect(pack.ai?.tasks?.classification?.metadata?.labels).toEqual(['execution_window', 'false_lead', 'pressure_escalation']);
    expect(pack.bootstrap?.initial_states[0]?.state_json.institutional_alert_stage).toBe('routine');
    expect(pack.entities?.domains.map(item => item.id)).toEqual(['domain-investigation', 'domain-public-opinion']);
    expect(pack.entities?.institutions.map(item => item.id)).toEqual(['institution-npa-taskforce', 'institution-public-media']);
    expect(pack.storage?.pack_collections.map(item => item.key)).toEqual(['target_dossiers', 'judgement_plans', 'investigation_threads']);
    expect(pack.storage?.install.allow_pack_collections).toBe(true);
    const objectiveRuleThen = pack.rules?.objective_enforcement?.[0]?.then as Record<string, unknown> | undefined;
    const objectiveMutate = objectiveRuleThen?.mutate as Record<string, unknown> | undefined;
    expect((objectiveMutate?.subject_state as Record<string, unknown>)?.execution_window_confidence).toBe(0.75);
    expect((objectiveMutate?.world_state as Record<string, unknown>)?.institutional_alert_stage).toBe('heightened');
    expect(pack.rules?.invocation[0]?.then.narrativize_event).toBeTruthy();
    expect(pack.rules?.invocation[1]?.then.translate_to_capability).toBe('invoke.raise_false_suspicion');
  });

  it('accepts death note storage collections for dossiers, plans and investigation threads', () => {
    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-death-note-storage-pack',
        name: '死亡笔记存储世界',
        version: '1.0.0'
      },
      storage: {
        strategy: 'isolated_pack_db',
        runtime_db_file: 'runtime.sqlite',
        pack_collections: [
          {
            key: 'target_dossiers',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'target_entity_id', type: 'entity_ref', required: true },
              { key: 'confidence', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'target_entity_id']]
          },
          {
            key: 'judgement_plans',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'target_entity_id', type: 'entity_ref' },
              { key: 'phase', type: 'string' },
              { key: 'risk_score', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'phase']]
          },
          {
            key: 'investigation_threads',
            kind: 'table',
            primary_key: 'id',
            fields: [
              { key: 'id', type: 'string', required: true },
              { key: 'owner_actor_id', type: 'entity_ref', required: true },
              { key: 'subject_entity_id', type: 'entity_ref', required: true },
              { key: 'evidence_strength', type: 'number' },
              { key: 'content', type: 'json', required: true }
            ],
            indexes: [['owner_actor_id', 'subject_entity_id']]
          }
        ],
        install: {
          compile_on_activate: true,
          allow_pack_collections: true,
          allow_raw_sql: false
        }
      }
    });

    expect(pack.storage?.pack_collections).toHaveLength(3);
    expect(pack.storage?.pack_collections[0]?.indexes?.[0]).toEqual(['owner_actor_id', 'target_entity_id']);
    expect(pack.storage?.pack_collections[1]?.indexes?.[0]).toEqual(['owner_actor_id', 'phase']);
    expect(pack.storage?.pack_collections[2]?.indexes?.[0]).toEqual(['owner_actor_id', 'subject_entity_id']);
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

  it('rejects bare invocation_type in objective_enforcement rules (requires invoke. prefix)', () => {
    expect(() =>
      parseWorldPackConstitution({
        metadata: {
          id: 'world-bare-invocation-type',
          name: '裸 invocation_type 世界',
          version: '1.0.0'
        },
        entities: {
          actors: [
            {
              id: 'agent-1',
              label: '角色一',
              kind: 'actor',
              state: {}
            }
          ],
          artifacts: [],
          mediators: [],
          domains: [],
          institutions: []
        },
        rules: {
          objective_enforcement: [
            {
              id: 'bare-invocation-type-rule',
              when: {
                invocation_type: 'coordinate_internal_team'
              },
              then: {
                mutate: {
                  target_state: {
                    status: 'coordinated'
                  }
                }
              }
            }
          ]
        }
      })
    ).toThrow(/must use 'invoke\.' prefix/);
  });

  it('accepts kernel action invocation types without invoke. prefix in objective_enforcement', () => {
    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-kernel-action-pack',
        name: '内核动作世界',
        version: '1.0.0'
      },
      entities: {
        actors: [
          {
            id: 'agent-1',
            label: '角色一',
            kind: 'actor',
            state: {}
          }
        ],
        artifacts: [],
        mediators: [],
        domains: [],
        institutions: []
      },
      rules: {
        objective_enforcement: [
          {
            id: 'trigger-event-rule',
            when: {
              invocation_type: 'trigger_event'
            },
            then: {
              mutate: {
                target_state: {}
              }
            }
          }
        ]
      }
    });

    expect(pack.rules?.objective_enforcement?.[0]?.when?.invocation_type).toBe('trigger_event');
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
