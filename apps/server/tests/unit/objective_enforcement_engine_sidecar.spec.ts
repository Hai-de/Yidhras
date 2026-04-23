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
  worldEngine: WorldEngineSidecarClient;
}

const createTestSidecarClient = (): WorldEngineSidecarClient => {
  return new WorldEngineSidecarClient(undefined as WorldEngineSidecarTransport | undefined);
};

const buildTestContext = (pack: ReturnType<typeof parseWorldPackConstitution>, now = 1000n): AppContextWithConcreteSidecar => {
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
    },
    worldEngine: createTestSidecarClient()
  };
};

describe('objective enforcement engine via sidecar', () => {
  it('executes a real objective rule path through Rust sidecar and persists host-managed effects', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-sidecar-bridge-pack',
        name: '侧车桥接世界',
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
              }
            }
          }
        ]
      }
    });

    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);

    const context = buildTestContext(pack);
    await context.worldEngine.loadPack({
      pack_id: pack.metadata.id,
      mode: 'active'
    });

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

    await context.worldEngine.unloadPack({
      pack_id: pack.metadata.id
    });
    await context.worldEngine.stop();
  });
});
