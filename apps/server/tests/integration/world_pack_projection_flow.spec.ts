import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js';
import { dispatchInvocationFromActionIntent } from '../../src/domain/invocation/invocation_dispatcher.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { extractGlobalProjectionIndex } from '../../src/kernel/projections/projection_extractor.js';
import { parseWorldPackConstitution } from '../../src/packs/manifest/constitution_loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { getPackEntityOverviewProjection } from '../../src/packs/runtime/projections/entity_overview_service.js';
import { listPackNarrativeTimelineProjection } from '../../src/packs/runtime/projections/narrative_projection_service.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

const createdRoots: string[] = [];

afterEach(() => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const buildProjectionTestContext = (
  pack: ReturnType<typeof parseWorldPackConstitution>,
  now = 1000n
): AppContext => {
  const clock = {
    getTicks(): bigint {
      return now;
    },
    getAllTimes() {
      return [];
    }
  };
  const prisma = {
    event: {
        async findMany() {
          return [];
        }
      },
      post: {
        async findMany() {
          return [];
        }
      },
      agent: {
        async count() {
          return 0;
        }
      },
      relationship: {
        async findMany() {
          return [];
        }
      }
    } as unknown as AppContext['prisma'];
  const repos = wrapPrismaAsRepositories(prisma as PrismaClient);
  repos.narrative = {
    ...repos.narrative,
    async listRecentEvents(limit?: number) {
      const events = await prisma.event.findMany({
        orderBy: { created_at: 'desc' },
        take: limit ?? 100
      });
      return events as Array<{
        id: string;
        title: string;
        description: string;
        tick: bigint;
        type: string;
        impact_data: string | null;
        source_action_intent_id: string | null;
        created_at: bigint;
      }>;
    }
  };
  return {
    clock: { getCurrentTick() { return now; }, getAllTimes() { return []; } } as unknown as AppContext['clock'],
    activePack: { getActivePack(): typeof pack { return pack; } } as unknown as AppContext['activePack'],
    prisma,
    repos,
    sim: {
      getActivePack(): typeof pack {
        return pack;
      },
      getCurrentTick(): bigint {
        return now;
      },
      getAllTimes() {
        return [];
      },
      clock,
      isRuntimeReady: () => true,
      isPaused: () => false,
      getPackRuntimeHandle: () => null,
      getRuntimeSpeedSnapshot() {
        return {
          mode: 'fixed' as const,
          source: 'default' as const,
          configured_step_ticks: null,
          override_step_ticks: null,
          override_since: null,
          effective_step_ticks: '1'
        };
      }
    } as unknown as AppContext['sim'],
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
    assertRuntimeReady() {
      // noop
    },
    worldEngine: {
      async loadPack() {
        return {
          protocol_version: 'world_engine/v1alpha1',
          pack_id: pack.metadata.id,
          loaded: true,
          current_tick: '1000',
          current_revision: '0'
        };
      },
      async unloadPack() {},
      async prepareStep() {
        return {
          protocol_version: 'world_engine/v1alpha1',
          pack_id: pack.metadata.id,
          prepared_token: 'mock-token',
          base_revision: '0',
          next_revision: '1',
          next_tick: '1001',
          summary: {
            step_ticks: '1',
            operation_count: 0,
            delta_operations: [],
            rule_execution_records: [],
            observation_records: []
          }
        };
      },
      async commitPreparedStep() {
        return {
          protocol_version: 'world_engine/v1alpha1',
          pack_id: pack.metadata.id,
          prepared_token: 'mock-token',
          committed_revision: '1',
          committed_tick: '1001',
          summary: {
            step_ticks: '1',
            operation_count: 0,
            delta_operations: [],
            rule_execution_records: [],
            observation_records: []
          }
        };
      },
      async abortPreparedStep() {},
      async queryState() {
        return {
          protocol_version: 'world_engine/v1alpha1',
          pack_id: pack.metadata.id,
          data: {}
        };
      },
      async getStatus() {
        return {
          protocol_version: 'world_engine/v1alpha1',
          pack_id: pack.metadata.id,
          loaded: true,
          current_tick: '1000',
          current_revision: '0'
        };
      },
      async getHealth() {
        return {
          protocol_version: 'world_engine/v1alpha1',
          status: 'ready',
          transport: 'mock',
          uptime_ms: 0
        };
      },
      async executeObjectiveRule(input) {
        return {
          protocol_version: 'world_engine/v1alpha1',
          pack_id: input.pack_id,
          rule_id: 'judgement-enforcement',
          capability_key: 'invoke.judgement',
          mediator_id: input.effective_mediator_id,
          target_entity_id: 'agent-target',
          mutations: [
            {
              entity_id: 'agent-target',
              state_namespace: 'default',
              state_patch: { life_status: 'sealed' }
            }
          ],
          emitted_events: [],
          diagnostics: {
            matched_rule_id: 'judgement-enforcement',
            evaluated_rule_count: 1,
            rendered_template_count: 0,
            mutation_count: 1,
            emitted_event_count: 0
          }
        };
      }
    } as unknown as AppContext['worldEngine'],
    activePackRuntime: {
      getActivePack() {
        return pack;
      },
      getRuntimeSpeedSnapshot: () => ({
        mode: 'fixed' as const,
        source: 'default' as const,
        configured_step_ticks: null,
        override_step_ticks: null,
        override_since: null,
        effective_step_ticks: '1'
      }),
      getCurrentRevision: () => 0n
    } as unknown as AppContext['activePackRuntime'],
    packStorageAdapter: (() => {
      const store = new Map<string, Map<string, Array<Record<string, unknown>>>>();
      const getTable = (packId: string, tableName: string): Array<Record<string, unknown>> => {
        const packStore = store.get(packId) ?? new Map<string, Array<Record<string, unknown>>>();
        if (!store.has(packId)) store.set(packId, packStore);
        const table = packStore.get(tableName) ?? [];
        if (!packStore.has(tableName)) packStore.set(tableName, table);
        return table;
      };
      return {
        backend: 'sqlite',
        ping: async () => true,
        destroyPackStorage: async () => {},
        ensureEngineOwnedSchema: async () => {},
        listEngineOwnedRecords: async (packId, tableName) => getTable(packId, tableName),
        upsertEngineOwnedRecord: async (packId, tableName, record) => {
          const table = getTable(packId, tableName);
          const rec = record as Record<string, unknown>;
          const id = String(rec.id ?? '');
          const idx = table.findIndex(r => String(r.id) === id);
          if (idx >= 0) {
            table[idx] = { ...table[idx], ...rec };
          } else {
            table.push(rec);
          }
          return rec as never;
        },
        ensureCollection: async () => {},
        upsertCollectionRecord: async () => null,
        listCollectionRecords: async () => [],
        exportPackData: async () => ({}),
        importPackData: async () => {}
      };
    })(),
    schedulerStorage: {
      open: () => {},
      close: () => {},
      destroyPackSchedulerStorage: () => {},
      listOpenPackIds: () => [],
      upsertLease: () => ({ key: '', partition_id: '', holder: '', acquired_at: 0n, expires_at: 0n }),
      getLease: () => null,
      updateLeaseIfClaimable: () => ({ count: 0 }),
      deleteLeaseByHolder: () => ({ count: 0 }),
      upsertCursor: () => ({ key: '', partition_id: '', last_scanned_tick: 0n, last_signal_tick: 0n, updated_at: 0n }),
      getCursor: () => null,
      getPartition: () => null,
      listPartitions: () => [],
      createPartition: (_packId: string, input: Record<string, unknown>) => input as never,
      updatePartition: (_packId: string, input: Record<string, unknown>) => input as never,
      listMigrations: () => [],
      countMigrationsInProgress: () => 0,
      getMigrationById: () => null,
      findLatestActiveMigrationForPartition: () => null,
      createMigration: (_packId: string, input: Record<string, unknown>) => ({ id: 'mock_migration', ...input }) as never,
      updateMigration: (_packId: string, input: Record<string, unknown>) => input as never,
      listWorkerStates: () => [],
      getWorkerState: () => null,
      upsertWorkerState: (_packId: string, input: Record<string, unknown>) => input as never,
      updateWorkerStatus: (_packId: string, _workerId: string, _status: string, _updatedAt: bigint) => ({ worker_id: _workerId, status: _status, updated_at: _updatedAt }) as never,
      findOpenRecommendation: () => null,
      createRecommendation: (_packId: string, input: Record<string, unknown>) => ({ id: 'mock_rec', ...input }) as never,
      listRecentRecommendations: () => [],
      getRecommendationById: () => null,
      updateRecommendation: (_packId: string, input: Record<string, unknown>) => input as never,
      listPendingRecommendationsForWorker: () => [],
      writeDetailedSnapshot: (_packId: string, input: Record<string, unknown>) => input,
      writeCandidateDecision: (_packId: string, _schedulerRunId: string, input: Record<string, unknown>) => input,
      listRuns: () => [],
      listCandidateDecisions: () => [],
      getAgentDecisions: () => []
    } as AppContext['schedulerStorage']
  };
};

describe('world-pack projection flow integration', () => {
  it('projects runtime entities and executions after install/materialize/invocation', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;

    const pack = parseWorldPackConstitution({
      metadata: {
        id: 'world-projection-pack',
        name: '投影世界',
        version: '1.0.0'
      },
      entities: {
        actors: [
          {
            id: 'agent-judge',
            label: '裁决者',
            kind: 'actor',
            state: {
              role: 'judge'
            }
          },
          {
            id: 'agent-target',
            label: '被裁决者',
            kind: 'actor',
            state: {
              life_status: 'alive'
            }
          }
        ],
        artifacts: [
          {
            id: 'artifact-seal',
            label: '裁决印记',
            kind: 'artifact',
            state: {
              holder_agent_id: 'agent-judge'
            }
          }
        ],
        mediators: [
          {
            id: 'mediator-seal',
            entity_ref: 'artifact-seal',
            mediator_kind: 'artifact_vessel',
            grants: [{ capability_key: 'invoke.judgement' }]
          }
        ],
        domains: [],
        institutions: []
      },
      capabilities: [
        {
          key: 'invoke.judgement',
          category: 'invoke',
          target_schema: 'actor'
        }
      ],
      authorities: [
        {
          id: 'grant-judgement',
          source_entity_id: 'mediator-seal',
          target_selector: {
            kind: 'direct_entity',
            entity_id: 'agent-judge'
          },
          capability_key: 'invoke.judgement',
          grant_type: 'mediated',
          mediated_by_entity_id: 'mediator-seal',
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
            id: 'judgement-enforcement',
            when: {
              capability: 'invoke.judgement',
              mediator: 'mediator-seal',
              'target.kind': 'actor'
            },
            then: {
              mutate: {
                target_state: {
                  life_status: 'sealed'
                }
              }
            }
          }
        ]
      }
    });

    const context = buildProjectionTestContext(pack);
    await installPackRuntime(pack, context.packStorageAdapter);
    await materializePackRuntimeCoreModels(pack, 1000n, context.packStorageAdapter);
    await dispatchInvocationFromActionIntent(context, {
      id: 'intent-judgement',
      source_inference_id: 'inference-judgement',
      intent_type: 'invoke.judgement',
      actor_ref: {
        identity_id: 'agent-judge',
        role: 'active',
        agent_id: 'agent-judge',
        atmosphere_node_id: null
      },
      target_ref: {
        entity_id: 'agent-target'
      },
      payload: {
        mediator_id: 'mediator-seal'
      }
    });

    const entityProjection = await getPackEntityOverviewProjection(context, pack.metadata.id);
    expect(entityProjection.summary.entity_count).toBeGreaterThanOrEqual(3);
    expect(entityProjection.summary.authority_count).toBe(1);
    expect(entityProjection.summary.rule_execution_count).toBe(1);
    expect(entityProjection.entities.some(entity => entity.id === 'agent-target')).toBe(true);
    expect(entityProjection.recent_rule_executions[0]?.rule_id).toBe('judgement-enforcement');

    const targetProjection = entityProjection.entities.find(entity => entity.id === 'agent-target');
    expect(targetProjection?.state.some(state => state.value.life_status === 'sealed')).toBe(true);

    const narrativeProjection = await listPackNarrativeTimelineProjection(context, pack.metadata.id);
    expect(narrativeProjection.timeline.some(item => item.kind === 'rule_execution')).toBe(true);

    const globalProjection = await extractGlobalProjectionIndex(context);
    expect(globalProjection.pack?.entity_summary.entity_count).toBe(entityProjection.summary.entity_count);
    expect(globalProjection.pack?.timeline_count).toBe(narrativeProjection.timeline.length);
  });
});
