import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { WorldEngineSidecarClient, type WorldEngineSidecarTransport } from '../../src/app/runtime/sidecar/world_engine_sidecar_client.js';
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

interface AppContextWithConcreteSidecar extends AppContext {
  worldEngine?: WorldEngineSidecarClient;
}

const createTestSidecarClient = (): WorldEngineSidecarClient => {
  return new WorldEngineSidecarClient(undefined as WorldEngineSidecarTransport | undefined);
};

const buildTestContext = (
  pack: ReturnType<typeof parseWorldPackConstitution>,
  options?: {
    now?: bigint;
  }
): AppContextWithConcreteSidecar => {
  const now = options?.now ?? 1000n;
  const sim = {
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
  } as AppContext['sim'];

  return {
    prisma: {} as AppContext['prisma'],
    sim,
    clock: sim as AppContext['clock'],
    activePack: sim as AppContext['activePack'],
    activePackRuntime: {
      getActivePack(): typeof pack {
        return pack;
      },
      getCurrentTick(): bigint {
        return now;
      },
      getStepTicks(): bigint {
        return 1n;
      },
      getRuntimeSpeedSnapshot() {
        return {
          mode: 'fixed' as const,
          source: 'default' as const,
          configured_step_ticks: null,
          override_step_ticks: null,
          override_since: null,
          effective_step_ticks: '1'
        };
      },
      setRuntimeSpeedOverride() {
        // noop
      },
      clearRuntimeSpeedOverride() {
        // noop
      },
      getAllTimes() {
        return { current_tick: now.toString() };
      },
      async init() {
        // noop
      },
      async step() {
        // noop
      },
      resolvePackVariables(template: string) {
        return template;
      }
    },
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
    },
    worldEngine: createTestSidecarClient()
  };
};

describe('objective enforcement sidecar parity', () => {
  it('matches objective enforcement results for a richer subject/target/world/event scenario', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-death-note-parity-pack',
        name: '死亡笔记 parity 世界',
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
              current_target_id: 'agent-002'
            }
          },
          {
            id: 'agent-002',
            label: 'L',
            kind: 'actor',
            state: {
              alive: true,
              suspicion_level: 0
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
            kind: 'direct_entity',
            entity_id: 'agent-001'
          },
          capability_key: 'invoke.execute_death_note',
          grant_type: 'mediated',
          mediated_by_entity_id: 'mediator-death-note',
          priority: 100
        }
      ],
      bootstrap: {
        initial_states: [
          {
            entity_id: '__world__',
            state_namespace: 'world',
            state_json: {
              kira_case_phase: 'pre_kira',
              investigation_heat: 0,
              public_fear_level: 0
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
              target: {
                kind: 'actor'
              }
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
                  public_fear_level: 1
                }
              },
              emit_events: [
                {
                  type: 'history',
                  title: '{{ target.id }} 在异常条件下死亡',
                  description: '{{ actor.id }} 触发了针对 {{ target.entity_id }} 的客观执行。',
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

    const firstContext = buildTestContext(pack);
    await firstContext.worldEngine?.loadPack({
      pack_id: pack.metadata.id,
      mode: 'active'
    });
    const secondContext = buildTestContext(pack);
    await secondContext.worldEngine?.loadPack({
      pack_id: pack.metadata.id,
      mode: 'active'
    });

    const invocation = {
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
    };

    await dispatchInvocationFromActionIntent(firstContext, invocation);
    const firstStates = await listPackEntityStates(pack.metadata.id);
    const firstRecords = await listPackRuleExecutionRecords(pack.metadata.id);

    await materializePackRuntimeCoreModels(pack, 1000n);

    await dispatchInvocationFromActionIntent(secondContext, invocation);
    const secondStates = await listPackEntityStates(pack.metadata.id);
    const secondRecords = await listPackRuleExecutionRecords(pack.metadata.id);

    const pickState = (states: Awaited<ReturnType<typeof listPackEntityStates>>, entityId: string, namespace: string) => {
      return states.find(state => state.entity_id === entityId && state.state_namespace === namespace)?.state_json ?? null;
    };

    expect(pickState(secondStates, 'agent-001', 'core')).toEqual(pickState(firstStates, 'agent-001', 'core'));
    expect(pickState(secondStates, 'agent-002', 'core')).toEqual(pickState(firstStates, 'agent-002', 'core'));
    expect(pickState(secondStates, '__world__', 'world')).toEqual(pickState(firstStates, '__world__', 'world'));

    expect(secondRecords).toHaveLength(firstRecords.length);
    expect(secondRecords.at(-1)?.rule_id).toBe(firstRecords.at(-1)?.rule_id);
    expect(secondRecords.at(-1)?.execution_status).toBe(firstRecords.at(-1)?.execution_status);

    await firstContext.worldEngine?.unloadPack({ pack_id: pack.metadata.id });
    await firstContext.worldEngine?.stop();
    await secondContext.worldEngine?.unloadPack({ pack_id: pack.metadata.id });
    await secondContext.worldEngine?.stop();
  });
});
