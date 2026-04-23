import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import type { WorldEnginePort } from '../../src/app/runtime/world_engine_ports.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { dispatchInvocationFromActionIntent } from '../../src/domain/invocation/invocation_dispatcher.js';
import { resolveObjectiveRulePlan } from '../../src/domain/rule/objective_rule_resolver.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { listPackEntityStates } from '../../src/packs/storage/entity_state_repo.js';
import { listPackRuleExecutionRecords } from '../../src/packs/storage/rule_execution_repo.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const buildTestContext = (pack: ReturnType<typeof parseWorldPackConstitution>, now = 1000n): AppContext => {
  const context: AppContext = {
    prisma: {} as AppContext['prisma'],
    sim: {
      getActivePack(): typeof pack {
        return pack;
      },
      getCurrentTick(): bigint {
        return now;
      },
      clock: {
        getTicks(): bigint {
          return now;
        }
      }
    } as AppContext['sim'],
    notifications: {
      push(level, content) {
        return { id: 'noop', level, content, timestamp: Date.now() };
      },
      getMessages() {
        return [];
      },
      clear() {
        // noop
      }
    },
    startupHealth: {
      level: 'ok',
      checks: {
        db: true,
        world_pack_dir: true,
        world_pack_available: true
      },
      available_world_packs: [pack.metadata.id],
      errors: []
    },
    getRuntimeReady() {
      return true;
    },
    setRuntimeReady() {
      // noop
    },
    getPaused() {
      return false;
    },
    setPaused() {
      // noop
    },
    assertRuntimeReady() {
      // noop
    }
  };

  const mockWorldEngine: WorldEnginePort = {
    async executeObjectiveRule(request) {
      const invocation = {
        id: request.invocation.id,
        pack_id: request.invocation.pack_id,
        source_action_intent_id: request.invocation.source_action_intent_id,
        source_inference_id: request.invocation.source_inference_id,
        invocation_type: request.invocation.invocation_type,
        capability_key: request.invocation.capability_key,
        subject_entity_id: request.invocation.subject_entity_id,
        target_ref: request.invocation.target_ref,
        payload: request.invocation.payload,
        mediator_id: request.invocation.mediator_id,
        actor_ref: request.invocation.actor_ref,
        created_at: BigInt(request.invocation.created_at)
      };
      const plan = await resolveObjectiveRulePlan(context, {
        invocation,
        capabilityGrant: null,
        mediatorId: request.effective_mediator_id
      });
      return {
        pack_id: request.pack_id,
        rule_id: plan.rule_id,
        capability_key: plan.capability_key,
        mediator_id: plan.mediator_id,
        target_entity_id: plan.target_entity_id,
        mutations: plan.mutations,
        emitted_events: plan.emitted_events,
        diagnostics: plan.diagnostics
      };
    }
  } as unknown as WorldEnginePort;

  context.worldEngine = mockWorldEngine;

  return context;
};

describe('objective enforcement engine', () => {
  it('enforces invocation types through objective rules without pack.actions bridge', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-bridge-pack',
        name: '桥接世界',
        version: '1.0.0'
      },
      entities: {
        actors: [
          {
            id: 'agent-holder',
            label: '持有者',
            kind: 'actor',
            state: {}
          }
        ],
        artifacts: [
          {
            id: 'artifact-book',
            label: '桥接之书',
            kind: 'artifact',
            state: {
              holder_agent_id: null,
              location: 'desk'
            }
          }
        ],
        mediators: [
          {
            id: 'mediator-book',
            entity_ref: 'artifact-book',
            mediator_kind: 'artifact_vessel',
            grants: [{ capability_key: 'invoke.claim_book' }]
          }
        ],
        domains: [],
        institutions: []
      },
      capabilities: [
        {
          key: 'invoke.claim_book',
          category: 'invoke',
          target_schema: 'artifact'
        }
      ],
      authorities: [
        {
          id: 'grant-claim-book',
          source_entity_id: 'mediator-book',
          target_selector: {
            kind: 'direct_entity',
            entity_id: 'agent-holder'
          },
          capability_key: 'invoke.claim_book',
          grant_type: 'mediated',
          mediated_by_entity_id: 'mediator-book'
        }
      ],
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        projection: [],
        objective_enforcement: [
          {
            id: 'claim-book-objective-rule',
            when: {
              invocation_type: 'invoke.claim_book'
            },
            then: {
              mutate: {
                target_state: {
                  holder_agent_id: '{{ invocation.subject_entity_id }}',
                  location: null
                }
              },
              emit_events: [
                {
                  type: 'history',
                  title: '{{ actor.id }} 取得了 {{ artifact.id }}',
                  description: '{{ actor.id }} 将 {{ artifact.id }} 持有为自身媒介。',
                  impact_data: {
                    semantic_type: 'book_claimed',
                    actor_id: '{{ invocation.subject_entity_id }}',
                    artifact_id: '{{ invocation.artifact_id }}'
                  }
                }
              ]
            }
          }
        ]
      }
    });

    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);

    const context = buildTestContext(pack);
    const result = await dispatchInvocationFromActionIntent(context, {
      id: 'intent-legacy-claim',
      source_inference_id: 'inference-legacy-claim',
      intent_type: 'invoke.claim_book',
      actor_ref: {
        identity_id: 'agent-holder',
        role: 'active',
        agent_id: 'agent-holder',
        atmosphere_node_id: null
      },
      target_ref: null,
      payload: {
        artifact_id: 'artifact-book',
        mediator_id: 'mediator-book'
      }
    });

    expect(result?.outcome).toBe('completed');

    const states = await listPackEntityStates(pack.metadata.id);
    const artifactState = states.find(state => state.entity_id === 'artifact-book' && state.state_namespace === 'core');
    expect(artifactState?.state_json.holder_agent_id).toBe('agent-holder');
    expect(artifactState?.state_json.location).toBeNull();

    const executionRecords = await listPackRuleExecutionRecords(pack.metadata.id);
    expect(executionRecords).toHaveLength(1);
    expect(executionRecords[0]?.rule_id).toBe('claim-book-objective-rule');
    expect(executionRecords[0]?.execution_status).toBe('completed');
    expect(executionRecords[0]?.emitted_events_json).toEqual([
      {
        kind: 'event_skipped',
        type: 'history',
        title: 'agent-holder 取得了 artifact-book',
        description: 'agent-holder 将 artifact-book 持有为自身媒介。',
        impact_data: {
          semantic_type: 'book_claimed',
          actor_id: 'agent-holder',
          artifact_id: 'artifact-book',
          pack_id: 'world-bridge-pack',
          invocation_id: 'intent-legacy-claim:invocation',
          subject_entity_id: 'agent-holder',
          mediator_id: 'mediator-book',
          source_action_intent_id: 'intent-legacy-claim',
          source_inference_id: 'inference-legacy-claim'
        },
        artifact_id: 'artifact-book'
      }
    ]);
  });

  it('enforces objective rules for capability invocations and mutates target state', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-objective-pack',
        name: '客观执行世界',
        version: '1.0.0'
      },
      entities: {
        actors: [
          {
            id: 'agent-light',
            label: '执行者',
            kind: 'actor',
            state: {
              knows_notebook_power: true
            }
          },
          {
            id: 'agent-target',
            label: '目标',
            kind: 'actor',
            state: {
              life_status: 'alive'
            }
          }
        ],
        artifacts: [
          {
            id: 'artifact-note',
            label: '规则媒介',
            kind: 'artifact',
            state: {
              holder_agent_id: 'agent-light'
            }
          }
        ],
        mediators: [
          {
            id: 'mediator-note',
            entity_ref: 'artifact-note',
            mediator_kind: 'artifact_vessel',
            grants: [{ capability_key: 'invoke.death_rule' }]
          }
        ],
        domains: [],
        institutions: []
      },
      capabilities: [
        {
          key: 'invoke.death_rule',
          category: 'invoke',
          target_schema: 'actor'
        }
      ],
      authorities: [
        {
          id: 'grant-invoke-death-rule',
          source_entity_id: 'mediator-note',
          target_selector: {
            kind: 'direct_entity',
            entity_id: 'agent-light'
          },
          capability_key: 'invoke.death_rule',
          grant_type: 'mediated',
          mediated_by_entity_id: 'mediator-note',
          priority: 100
        }
      ],
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        projection: [],
        objective_enforcement: [
          {
            id: 'death-note-enforcement',
            when: {
              capability: 'invoke.death_rule',
              mediator: 'mediator-note',
              'target.kind': 'actor'
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
      }
    });

    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);

    const context = buildTestContext(pack);
    const result = await dispatchInvocationFromActionIntent(context, {
      id: 'intent-capability-death-rule',
      source_inference_id: 'inference-capability-death-rule',
      intent_type: 'invoke.death_rule',
      actor_ref: {
        identity_id: 'agent-light',
        role: 'active',
        agent_id: 'agent-light',
        atmosphere_node_id: null
      },
      target_ref: {
        entity_id: 'agent-target'
      },
      payload: {
        mediator_id: 'mediator-note'
      }
    });

    expect(result?.outcome).toBe('completed');

    const states = await listPackEntityStates(pack.metadata.id);
    const targetState = states.find(state => state.entity_id === 'agent-target' && state.state_namespace === 'core');
    expect(targetState?.state_json.life_status).toBe('dead');

    const executionRecords = await listPackRuleExecutionRecords(pack.metadata.id);
    expect(executionRecords).toHaveLength(1);
    expect(executionRecords[0]?.rule_id).toBe('death-note-enforcement');
    expect(executionRecords[0]?.capability_key).toBe('invoke.death_rule');
    expect(executionRecords[0]?.execution_status).toBe('completed');
  });

  it('supports richer death note objective rules including judgement execution and investigation followup', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-death-note-rich',
        name: '死亡笔记进阶世界',
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
              knows_notebook_power: true,
              murderous_intent: true,
              target_judgement_eligibility: true,
              current_target_id: 'agent-002'
            }
          },
          {
            id: 'agent-002',
            label: 'L',
            kind: 'actor',
            state: {
              alive: true,
              suspicion_level: 0,
              investigation_focus: null
            }
          }
        ],
        artifacts: [
          {
            id: 'artifact-death-note',
            label: '死亡笔记',
            kind: 'artifact',
            state: {
              holder_agent_id: 'agent-001'
            }
          }
        ],
        mediators: [
          {
            id: 'mediator-death-note',
            entity_ref: 'artifact-death-note',
            mediator_kind: 'artifact_vessel',
            grants: [{ capability_key: 'invoke.execute_death_note' }]
          }
        ],
        domains: [],
        institutions: []
      },
      capabilities: [
        {
          key: 'invoke.execute_death_note',
          category: 'invoke',
          target_schema: 'actor'
        }
      ],
      authorities: [
        {
          id: 'grant-execute-death-note',
          source_entity_id: 'mediator-death-note',
          target_selector: {
            kind: 'holder_of',
            entity_id: 'artifact-death-note'
          },
          capability_key: 'invoke.execute_death_note',
          grant_type: 'mediated',
          mediated_by_entity_id: 'mediator-death-note',
          conditions_json: {
            'subject_state.knows_notebook_power': true,
            'subject_state.murderous_intent': true,
            'subject_state.target_judgement_eligibility': true
          },
          priority: 100
        }
      ],
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: {
              investigation_heat: 0,
              public_fear_level: 0,
              death_pattern_visibility: 0,
              kira_case_phase: 'pre_kira'
            }
          }
        ],
        initial_events: []
      },
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        projection: [],
        objective_enforcement: [
          {
            id: 'execute-death-note-objective',
            when: {
              capability: 'invoke.execute_death_note',
              mediator: 'mediator-death-note',
              invocation_type: 'invoke.execute_death_note',
              'target.kind': 'actor'
            },
            then: {
              mutate: {
                subject_state: {
                  current_target_id: null
                },
                target_state: {
                  alive: false,
                  death_cause: 'cardiac_arrest'
                },
                world_state: {
                  kira_case_phase: 'kira_active',
                  investigation_heat: 1,
                  public_fear_level: 1,
                  death_pattern_visibility: 1
                }
              },
              emit_events: [
                {
                  type: 'history',
                  title: '{{ target.id }} 在异常条件下死亡',
                  description: '一次高度可疑且缺乏直接物理证据的死亡事件引发了社会震荡。',
                  impact_data: {
                    semantic_type: 'suspicious_death_occurred',
                    actor_id: '{{ invocation.subject_entity_id }}',
                    target_id: '{{ invocation.target_entity_id }}',
                    objective_effect_applied: true
                  }
                }
              ]
            }
          }
        ]
      }
    });

    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);

    const context = buildTestContext(pack);
    const result = await dispatchInvocationFromActionIntent(context, {
      id: 'intent-execute-death-note',
      source_inference_id: 'inference-execute-death-note',
      intent_type: 'invoke.execute_death_note',
      actor_ref: {
        identity_id: 'agent-001',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      target_ref: {
        entity_id: 'agent-002'
      },
      payload: {
        mediator_id: 'mediator-death-note'
      }
    });

    expect(result?.outcome).toBe('completed');

    const states = await listPackEntityStates(pack.metadata.id);
    const actorState = states.find(state => state.entity_id === 'agent-001' && state.state_namespace === 'core');
    const targetState = states.find(state => state.entity_id === 'agent-002' && state.state_namespace === 'core');
    const worldState = states.find(state => state.entity_id === '__world__' && state.state_namespace === 'world');

    expect(actorState?.state_json.current_target_id).toBeNull();
    expect(targetState?.state_json.alive).toBe(false);
    expect(targetState?.state_json.death_cause).toBe('cardiac_arrest');
    expect(worldState?.state_json.kira_case_phase).toBe('kira_active');
    expect(worldState?.state_json.investigation_heat).toBe(1);
    expect(worldState?.state_json.public_fear_level).toBe(1);

    const executionRecords = await listPackRuleExecutionRecords(pack.metadata.id);
    expect(executionRecords).toHaveLength(1);
    expect(executionRecords[0]?.rule_id).toBe('execute-death-note-objective');
    expect(executionRecords[0]?.execution_status).toBe('completed');
  });
});
