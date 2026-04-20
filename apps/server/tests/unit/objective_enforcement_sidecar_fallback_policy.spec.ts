import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { dispatchInvocationFromActionIntent } from '../../src/domain/invocation/invocation_dispatcher.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { listPackRuleExecutionRecords } from '../../src/packs/storage/rule_execution_repo.js';
import { ApiError } from '../../src/utils/api_error.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const createObjectiveOnlyWorldEngineStub = (input: {
  executeObjectiveRule: NonNullable<AppContext['worldEngine']>['executeObjectiveRule'];
}): AppContext['worldEngine'] => {
  return {
    loadPack: async () => ({ protocol_version: 'world_engine/v1alpha1', pack_id: 'stub', mode: 'active', session_status: 'ready', hydrated_from_persistence: true, current_tick: '0', current_revision: '0' }),
    unloadPack: async () => {},
    prepareStep: async () => ({ prepared_token: 'stub', pack_id: 'stub', base_revision: '0', next_revision: '0', next_tick: '0', state_delta: { operations: [] }, emitted_events: [], observability: [], summary: { applied_rule_count: 0, event_count: 0, mutated_entity_count: 0 } }),
    commitPreparedStep: async () => ({ protocol_version: 'world_engine/v1alpha1', pack_id: 'stub', prepared_token: 'stub', committed_revision: '0', committed_tick: '0', summary: { applied_rule_count: 0, event_count: 0, mutated_entity_count: 0 } }),
    abortPreparedStep: async () => {},
    queryState: async () => ({ protocol_version: 'world_engine/v1alpha1', pack_id: 'stub', query_name: 'pack_summary', current_tick: '0', current_revision: '0', data: { summary: null }, warnings: [] }),
    getStatus: async () => ({ protocol_version: 'world_engine/v1alpha1', pack_id: 'stub', mode: 'active', session_status: 'ready', runtime_ready: true, current_tick: '0', current_revision: '0' }),
    getHealth: async () => ({ protocol_version: 'world_engine/v1alpha1', transport: 'stdio_jsonrpc', engine_status: 'ready', engine_instance_id: 'stub', uptime_ms: 0, loaded_pack_ids: [], tainted_pack_ids: [] }),
    executeObjectiveRule: input.executeObjectiveRule
  };
};

const buildTestContext = (
  pack: ReturnType<typeof parseWorldPackConstitution>,
  options?: {
    now?: bigint;
    worldEngine?: AppContext['worldEngine'];
  }
): AppContext => {
  const now = options?.now ?? 1000n;
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
    worldEngine: options?.worldEngine
  };
};

describe('objective enforcement sidecar fallback policy', () => {
  it('does not silently fall back to TS objective resolution when a configured sidecar reports OBJECTIVE_RULE_NOT_FOUND', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-sidecar-fallback-policy-pack',
        name: '侧车回退策略世界',
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

    const context = buildTestContext(pack, {
      worldEngine: createObjectiveOnlyWorldEngineStub({
        executeObjectiveRule: async () => {
          throw new ApiError(500, 'OBJECTIVE_RULE_NOT_FOUND', 'sidecar reported no matching objective rule', {
            pack_id: pack.metadata.id,
            invocation_type: 'claim_book'
          });
        }
      })
    });

    await expect(
      dispatchInvocationFromActionIntent(context, {
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
      })
    ).rejects.toMatchObject({
      code: 'OBJECTIVE_RULE_NOT_FOUND'
    });

    const executionRecords = await listPackRuleExecutionRecords(pack.metadata.id);
    expect(executionRecords).toHaveLength(1);
    expect(executionRecords[0]?.execution_status).toBe('failed');
    expect(executionRecords[0]?.rule_id).toBe('failed:claim_book');

    const payload = executionRecords[0]?.payload_json ?? null;
    expect(payload).toMatchObject({
      invocation_type: 'claim_book',
      error_message: 'sidecar reported no matching objective rule'
    });
  });
});
