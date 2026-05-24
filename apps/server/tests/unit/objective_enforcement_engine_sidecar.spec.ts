import type { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { WorldEngineSidecarClient, type WorldEngineSidecarTransport } from '../../src/app/runtime/sidecar/world_engine_sidecar_client.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import type { PackRuntimeHost } from '../../src/core/pack_runtime_host.js';
import { dispatchInvocationFromActionIntent } from '../../src/domain/invocation/invocation_dispatcher.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { listPackEntityStates } from '../../src/packs/storage/entity_state_repo.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js';
import { listPackRuleExecutionRecords } from '../../src/packs/storage/rule_execution_repo.js';
import type { NotificationLevel, SystemMessage } from '../../src/utils/notifications.js';
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import { createVariableRuntimeSpeedSnapshot } from '../helpers/runtime_speed.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const createTestSidecarClient = (): WorldEngineSidecarClient => {
  return new WorldEngineSidecarClient(undefined as WorldEngineSidecarTransport | undefined);
};

type SidecarTestContext = AppContext & { worldEngine: WorldEngineSidecarClient };

const buildTestContext = (pack: ReturnType<typeof parseWorldPackConstitution>, packStorageAdapter: PackStorageAdapter, now = 1000n): SidecarTestContext => {
  const sim = {
    getPack(): typeof pack {
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
  } as unknown as AppContext['packRuntime'];

  const repos = wrapPrismaAsRepositories({} as PrismaClient);

  return {
    repos: { ...repos, identityOperator: { ...repos.identityOperator, findOperatorBindingForAgent: async () => null } },
    prisma: {} as AppContext['prisma'],
    packStorageAdapter,
    packRuntime: sim as AppContext['packRuntime'],
    notifications: {
      push(level: NotificationLevel, content: string): SystemMessage {
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
    isRuntimeReady() {
      return true;
    },
    setRuntimeReady() {
      // noop
    },
    isPaused() {
      return false;
    },
    setPaused() {
      // noop
    },
    assertRuntimeReady() {
      // noop
    },
    packRuntimeLookup: {
      hasPackRuntime: (packId: string) => packId.trim() === pack.metadata.id,
      assertPackScope: (packId: string) => packId.trim(),
      getPackRuntimeSummary: () => null
    },
    getPackRuntimeHost: (_packId: string) =>
      ({
        getCurrentTick: () => now,
        getCurrentRevision: () => now,
        getPack: () => pack,
        getRuntimeSpeedSnapshot: () => createVariableRuntimeSpeedSnapshot(),
        getAllTimes: () => [],
        getPackId: () => _packId,
        getStepTicks: () => 1n,
        step: async () => {},
        applyClockProjection: () => {}
      }) as unknown as PackRuntimeHost,
    worldEngine: createTestSidecarClient()
  } as unknown as SidecarTestContext;
};

describe('objective enforcement engine via sidecar', () => {
  const packStorageAdapter = new SqlitePackStorageAdapter();

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

    await installPackRuntime(pack.metadata.id, pack, packStorageAdapter);
    await materializePackRuntimeCoreModels(pack.metadata.id, pack, 1000n, packStorageAdapter);

    const context = buildTestContext(pack, packStorageAdapter);
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

    const states = await listPackEntityStates(packStorageAdapter, pack.metadata.id);
    const artifactState = states.find(state => state.entity_id === 'artifact-book' && state.state_namespace === 'core');
    expect(artifactState?.state_json.holder_agent_id).toBe('agent-holder');
    expect(artifactState?.state_json.location).toBeNull();

    const executionRecords = await listPackRuleExecutionRecords(packStorageAdapter, pack.metadata.id);
    expect(executionRecords).toHaveLength(1);
    expect(executionRecords[0]?.rule_id).toBe('claim-book-objective-rule');
    expect(executionRecords[0]?.execution_status).toBe('completed');

    await context.worldEngine.unloadPack({
      pack_id: pack.metadata.id
    });
    await context.worldEngine.stop();
  });
});
