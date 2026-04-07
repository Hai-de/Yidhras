import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { dispatchInvocationFromActionIntent } from '../../src/domain/invocation/invocation_dispatcher.js';
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
  return {
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
        mediators: [],
        domains: [],
        institutions: []
      },
      rules: {
        perception: [],
        capability_resolution: [],
        invocation: [],
        projection: [],
        objective_enforcement: [
          {
            id: 'claim-book-objective-rule',
            when: {
              invocation_type: 'claim_book'
            },
            then: {
              mutate: {
                target_state: {
                  holder_agent_id: '{{subject_entity_id}}',
                  location: null
                }
              },
              emit_events: [
                {
                  type: 'history',
                  title: '{{actor.id}} 取得了 {{artifact.id}}',
                  description: '{{actor.id}} 将 {{artifact.id}} 持有为自身媒介。',
                  impact_data: {
                    semantic_type: 'book_claimed',
                    actor_id: '{{subject_entity_id}}',
                    artifact_id: '{{artifact_id}}'
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
      intent_type: 'claim_book',
      actor_ref: {
        identity_id: 'agent-holder',
        role: 'active',
        agent_id: 'agent-holder',
        atmosphere_node_id: null
      },
      target_ref: null,
      payload: {
        artifact_id: 'artifact-book'
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
          mediator_id: null,
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
});
