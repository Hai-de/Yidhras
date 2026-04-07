import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { sim } from '../../src/core/simulation.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';
import { buildInferenceContextV2 } from '../../src/domain/inference/context_assembler.js';
import { resolveAuthorityForSubject } from '../../src/domain/authority/resolver.js';
import { resolvePerceptionForSubject } from '../../src/domain/perception/resolver.js';
import { notifications } from '../../src/utils/notifications.js';
import { createIsolatedRuntimeEnvironment } from '../helpers/runtime.js';

const createdRoots: string[] = [];

afterEach(async () => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  delete process.env.WORLD_PACKS_DIR;
  delete process.env.DATABASE_URL;
  createdRoots.splice(0, createdRoots.length);
  await sim.prisma.$disconnect();
});

describe('authority/perception/context assembly', () => {
  it('resolves capabilities and pack-state visibility for the current subject', async () => {
    const environment = await createIsolatedRuntimeEnvironment({ appEnv: 'test' });
    createdRoots.push(environment.rootDir);
    process.env.WORKSPACE_ROOT = environment.rootDir;
    process.env.DATABASE_URL = environment.databaseUrl;
    process.env.WORLD_PACKS_DIR = environment.worldPacksDir;

    await sim.prepareDatabase();
    await sim.init('death_note');

    const appContext: AppContext & { identity?: { id: string; type: 'agent'; name: string } } = {
      sim,
      prisma: sim.prisma,
      notifications,
      startupHealth: {
        level: 'ok',
        checks: {
          db: true,
          world_pack_dir: true,
          world_pack_available: true
        },
        errors: [],
        available_world_packs: ['death_note']
      },
      getRuntimeReady(): boolean {
        return true;
      },
      setRuntimeReady(): void {
        // noop for unit test
      },
      getPaused(): boolean {
        return false;
      },
      setPaused(): void {
        // noop for unit test
      },
      assertRuntimeReady(): void {
        // noop for unit test
      }
    };

    appContext.identity = {
      id: 'agent-light',
      type: 'agent',
      name: '夜神月'
    };

    const authority = await resolveAuthorityForSubject(appContext, {
      packId: 'world-death-note',
      subjectEntityId: 'agent-light'
    });
    expect(Array.isArray(authority.resolved_capabilities)).toBe(true);

    const inferenceContextV2 = await buildInferenceContextV2(appContext, {
      identity_id: 'agent-light',
      strategy: 'rule_based'
    });

    expect(inferenceContextV2.subject_context.resolved_agent_id).toBe('agent-light');
    expect(inferenceContextV2.authority_context.subject_entity_id).toBe('agent-light');
    expect(Array.isArray(inferenceContextV2.authority_context.resolved_capabilities)).toBe(true);

    const perception = await resolvePerceptionForSubject(appContext, {
      packId: 'world-death-note',
      packState: inferenceContextV2.base.pack_state
    });
    expect(perception.visible_state_entries.some(entry => entry.entity_id === '__world__')).toBe(true);
  });
});
