import { afterEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import { buildExtendedInferenceContext } from '../../src/app/services/context/context_assembler.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { SimulationManager } from '../../src/core/simulation.js';
import { resolveAuthorityForSubject } from '../../src/domain/authority/resolver.js';
import { SqlitePackStorageAdapter } from '../../src/packs/storage/internal/SqlitePackStorageAdapter.js';
import { resolvePerceptionForSubject } from '../../src/domain/perception/resolver.js';
import { createNotificationManager } from '../../src/utils/notifications.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';

const DEATH_NOTE_PACK_REF = 'death_note';
const DEATH_NOTE_PACK_ID = 'world-death-note';

const createdRoots: string[] = [];

afterEach(async () => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  delete process.env.WORLD_PACKS_DIR;
  delete process.env.DATABASE_URL;
  createdRoots.splice(0, createdRoots.length);
});

describe('authority/perception/context assembly', () => {
  it('resolves capabilities and pack-state visibility for the current subject', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test', packRef: DEATH_NOTE_PACK_REF, seededPackRefs: [DEATH_NOTE_PACK_REF] });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;
    process.env.DATABASE_URL = environment.databaseUrl;
    process.env.WORLD_PACKS_DIR = environment.worldPacksDir;

    await prepareIsolatedRuntime(environment);

    const prisma = createPrismaClientForEnvironment(environment);
    const notifications = createNotificationManager();
    const sim = new SimulationManager({ prisma, packStorageAdapter: new SqlitePackStorageAdapter() } as any);

    await sim.prepareDatabase();
    await sim.loadExperimentalPackRuntime('death_note');

    const appContext = {
      prisma,
      packStorageAdapter: new SqlitePackStorageAdapter(),
      repos: createPrismaRepositories(prisma),
      startupHealth: {
        level: 'ok',
        checks: {
          db: true,
          world_pack_dir: true,
          world_pack_available: true
        },
        errors: [],
        available_world_packs: [DEATH_NOTE_PACK_REF]
      },
      isRuntimeReady(): boolean {
        return true;
      },
      setRuntimeReady(): void {
        // noop for unit test
      },
      isPaused(): boolean {
        return false;
      },
      setPaused(): void {
        // noop for unit test
      },
      assertRuntimeReady(): void {
        // noop for unit test
      },
      packRuntimeLookup: {
        hasPackRuntime: (packId: string) => sim.listLoadedPackRuntimeIds().includes(packId),
        assertPackScope: (id: string) => id,
        getPackRuntimeSummary: (packId: string) => {
          const handle = sim.getPackRuntimeHandle(packId);
          if (!handle) return null;
          return {
            pack_id: handle.pack_id,
            pack_folder_name: handle.pack_folder_name,
            health_status: handle.getHealthSnapshot().status,
            current_tick: handle.getClockSnapshot().current_tick,
            runtime_ready: true
          };
        }
      },
      getPackRuntimeHost: (packId: string) => {
        const host = sim.getPackRuntimeRegistry().getHost(packId);
        return host ?? null;
      },
      getPackRuntimeHandle: (packId: string) => sim.getPackRuntimeHandle(packId) ?? null
    } as unknown as AppContext & { identity?: { id: string; type: 'agent'; name: string } };

    appContext.identity = {
      id: 'agent-001',
      type: 'agent',
      name: '夜神月'
    };

    const authority = await resolveAuthorityForSubject(appContext, {
      packId: DEATH_NOTE_PACK_ID,
      subjectEntityId: 'agent-001'
    });
    expect(Array.isArray(authority.resolved_capabilities)).toBe(true);

    const inferenceContextV2 = await buildExtendedInferenceContext(appContext, {
      identity_id: 'agent-001',
      strategy: 'mock'
    }, DEATH_NOTE_PACK_ID);

    expect(inferenceContextV2.subject_context.resolved_agent_id).toBe('agent-001');
    expect(inferenceContextV2.authority_context.subject_entity_id).toBe('agent-001');
    expect(Array.isArray(inferenceContextV2.authority_context.resolved_capabilities)).toBe(true);
    expect(Array.isArray(inferenceContextV2.base.pack_runtime.invocation_rules)).toBe(true);
    expect(inferenceContextV2.base.pack_runtime.invocation_rules?.length).toBeGreaterThan(0);

    const perception = await resolvePerceptionForSubject(appContext, {
      packId: DEATH_NOTE_PACK_ID,
      packState: inferenceContextV2.base.pack_state
    });
    expect(perception.visible_state_entries.some(entry => entry.entity_id === '__world__')).toBe(true);

    await prisma.$disconnect();
  });
});
