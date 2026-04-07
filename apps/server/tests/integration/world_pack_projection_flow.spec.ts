import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
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
  return {
    prisma: {
      schedulerPartitionAssignment: {
        async findMany() {
          return [];
        }
      },
      schedulerWorkerRuntimeState: {
        async findUnique() {
          return null;
        }
      },
      schedulerOwnershipMigrationLog: {
        async count() {
          return 0;
        }
      },
      schedulerLease: {
        async findUnique() {
          return null;
        }
      },
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
    } as unknown as AppContext['prisma'],
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

    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);

    const context = buildProjectionTestContext(pack);
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
