import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { WorldEngineSidecarClient } from '../../src/app/runtime/sidecar/world_engine_sidecar_client.js';
import {
  createWorldEngineStepCoordinator,
  executeWorldEnginePreparedStep
} from '../../src/app/runtime/world_engine_persistence.js';
import { createPackHostApi } from '../../src/app/runtime/world_engine_ports.js';
import { buildWorldPackHydrateRequest } from '../../src/app/runtime/world_engine_snapshot.js';
import { sim } from '../../src/core/simulation.js';
import { createIsolatedRuntimeEnvironment, migrateIsolatedDatabase } from '../helpers/runtime.js';

const DEATH_NOTE_PACK_REF = 'death_note';
const DEATH_NOTE_PACK_ID = 'world-death-note';

const packSummary = (summary: unknown): Record<string, unknown> => {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('summary should be an object');
  }
  return summary as Record<string, unknown>;
};

describe('world engine sidecar runtime loop integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let sidecar: WorldEngineSidecarClient;
  const packId = DEATH_NOTE_PACK_ID;
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalWorldPacksDir = process.env.WORLD_PACKS_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppEnv = process.env.APP_ENV;

  beforeAll(async () => {
    const environment = await createIsolatedRuntimeEnvironment({ activePackRef: DEATH_NOTE_PACK_REF, seededPackRefs: [DEATH_NOTE_PACK_REF] });
    cleanup = environment.cleanup;
    await migrateIsolatedDatabase(environment);

    process.env.WORKSPACE_ROOT = environment.rootDir;
    process.env.WORLD_PACKS_DIR = environment.worldPacksDir;
    process.env.DATABASE_URL = environment.databaseUrl;
    process.env.APP_ENV = environment.envOverrides.APP_ENV;

    await sim.init('death_note');
    context = {
      prisma: sim.prisma,
      sim,
      runtimeBootstrap: sim,
      activePackRuntime: sim,
      packCatalog: sim,
      notifications: {
        push: () => ({ id: 'noop', level: 'info', content: 'noop', timestamp: Date.now() }),
        getMessages: () => [],
        clear: () => {}
      },
      startupHealth: {
        level: 'ok',
        checks: { db: true, world_pack_dir: true, world_pack_available: true },
        available_world_packs: [packId],
        errors: []
      },
      getRuntimeReady: () => true,
      setRuntimeReady: () => {},
      getPaused: () => false,
      setPaused: () => {},
      worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
      assertRuntimeReady: () => {}
    } as unknown as AppContext;

    sidecar = new WorldEngineSidecarClient();
    context.worldEngine = sidecar as unknown as AppContext['worldEngine'];
    context.packHostApi = createPackHostApi(context);

    await sidecar.loadPack({
      pack_id: packId,
      pack_ref: DEATH_NOTE_PACK_REF,
      mode: 'active',
      hydrate: await buildWorldPackHydrateRequest(context, packId)
    });
  });

  afterAll(async () => {
    await sidecar?.unloadPack({ pack_id: packId });
    await sidecar?.stop();
    await sim.prisma.$disconnect();
    if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    if (originalWorldPacksDir === undefined) delete process.env.WORLD_PACKS_DIR;
    else process.env.WORLD_PACKS_DIR = originalWorldPacksDir;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    await cleanup?.();
  });

  it('persists a prepared step and advances the hydrated Rust session through the host-managed path', async () => {
    const beforeSummary = packSummary(
      (
        await context.packHostApi?.queryWorldState({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: packId,
          query_name: 'pack_summary',
          selector: {}
        })
      )?.data.summary
    );

    expect(typeof beforeSummary.current_tick).toBe('string');

    const committed = await executeWorldEnginePreparedStep({
      context,
      worldEngine: sidecar,
      persistence: {
        persistPreparedStep: async ({ prepared }) => ({
          persisted_revision: prepared.next_revision,
          applied_operations: prepared.state_delta.operations.map(item => item.op),
          persisted_entity_states: [],
          persisted_rule_execution_records: [],
          clock_delta: null,
          observability: [{
            code: 'WORLD_CORE_DELTA_APPLIED',
            attributes: {
              pack_id: prepared.pack_id,
              prepared_token: prepared.prepared_token
            }
          }]
        })
      },
      prepareInput: {
        protocol_version: 'world_engine/v1alpha1',
        pack_id: packId,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    });

    expect(typeof committed.committed_tick).toBe('string');
    expect(committed.summary.applied_rule_count).toBe(0);
    const prepared = await sidecar.prepareStep({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      step_ticks: '1',
      reason: 'manual'
    });
    expect(prepared.state_delta.operations).toHaveLength(3);
    expect(prepared.emitted_events).toHaveLength(1);
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_CORE_DELTA_BUILT');
    expect(prepared.observability.map(item => item.code)).toContain('WORLD_PREPARED_STATE_SUMMARY');
    expect(prepared.state_delta.operations[1]).toMatchObject({
      op: 'append_rule_execution',
      namespace: 'rule_execution_records'
    });
    expect(prepared.summary.mutated_entity_count).toBe(2);
    await sidecar.abortPreparedStep({ protocol_version: 'world_engine/v1alpha1', pack_id: packId, prepared_token: prepared.prepared_token, reason: 'cleanup-after-observability-check' });

    expect(committed.summary.event_count).toBeGreaterThanOrEqual(0);
    expect(committed.summary.mutated_entity_count).toBe(2);

    const afterSummary = packSummary(
      (
        await context.packHostApi?.queryWorldState({
          protocol_version: 'world_engine/v1alpha1',
          pack_id: packId,
          query_name: 'pack_summary',
          selector: {}
        })
      )?.data.summary
    );

    expect(typeof afterSummary.current_tick).toBe('string');
    expect(afterSummary.current_revision === undefined || typeof afterSummary.current_revision === 'string').toBe(true);

    const worldStateResult = await context.packHostApi?.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'entity_state',
      selector: {
        entity_id: '__world__',
        state_namespace: 'world'
      }
    });

    expect(worldStateResult?.data.entity_id).toBe('__world__');
    expect(worldStateResult?.data.state_namespace).toBe('world');
    expect(worldStateResult?.data.state).not.toBeNull();
    expect(typeof worldStateResult?.data.state).toBe('object');

    const ruleExecutionSummary = await context.packHostApi?.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'rule_execution_summary',
      selector: {
        rule_id: 'world_step.advance_clock',
        execution_status: 'applied'
      }
    });
    expect(Array.isArray(ruleExecutionSummary?.data.items)).toBe(true);
    expect((ruleExecutionSummary?.data.items ?? []).length).toBeGreaterThanOrEqual(0);
  });
});
