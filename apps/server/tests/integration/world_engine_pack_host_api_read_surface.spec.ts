import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { createPackHostApi } from '../../src/app/runtime/world_engine_ports.js';
import { installPackRuntime } from '../../src/kernel/install/install_pack.js';
import { PackManifestLoader } from '../../src/packs/manifest/loader.js';
import { materializePackRuntimeCoreModels } from '../../src/packs/runtime/materializer.js';
import { createTestAppContext } from '../fixtures/app-context.js';
import { createIsolatedRuntimeEnvironment, createPrismaClientForEnvironment, migrateIsolatedDatabase } from '../helpers/runtime.js';

describe('PackHostApi read surface integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;
  let packId = 'world-death-note';

  beforeAll(async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    cleanup = environment.cleanup;
    await migrateIsolatedDatabase(environment);

    const prisma = createPrismaClientForEnvironment(environment);
    context = createTestAppContext(prisma);

    const loader = new PackManifestLoader(environment.worldPacksDir);
    const pack = loader.loadPack('death_note');
    packId = pack.metadata.id;
    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);
  });

  beforeEach(async () => {
    await context.prisma.schedulerCandidateDecision.deleteMany();
    await context.prisma.schedulerRun.deleteMany();
    await context.prisma.schedulerCursor.deleteMany();
    await context.prisma.schedulerLease.deleteMany();
    await context.prisma.schedulerRebalanceRecommendation.deleteMany();
    await context.prisma.schedulerWorkerRuntimeState.deleteMany();
    await context.prisma.schedulerOwnershipMigrationLog.deleteMany();
    await context.prisma.schedulerPartitionAssignment.deleteMany();
    await context.prisma.relationshipAdjustmentLog.deleteMany();
    await context.prisma.sNRAdjustmentLog.deleteMany();
    await context.prisma.event.deleteMany();
    await context.prisma.actionIntent.deleteMany();
    await context.prisma.decisionJob.deleteMany();
    await context.prisma.inferenceTrace.deleteMany();
    await context.prisma.contextOverlayEntry.deleteMany();
    await context.prisma.memoryBlock.deleteMany();
    await context.prisma.memoryCompactionState.deleteMany();
    await context.prisma.relationship.deleteMany();
  });

  afterAll(async () => {
    await context.prisma.$disconnect();
    await cleanup?.();
  });

  it('exposes stable host-mediated world read models for pack runtime core data', async () => {
    const hostApi = createPackHostApi(context);

    const entities = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'world_entities',
      selector: {}
    });
    expect(Array.isArray(entities.data.items)).toBe(true);
    expect((entities.data.items ?? []).length).toBeGreaterThan(0);

    const worldState = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'entity_state',
      selector: {
        entity_id: '__world__',
        state_namespace: 'world'
      }
    });
    expect(worldState.data.entity_id).toBe('__world__');
    expect(worldState.data.state_namespace).toBe('world');
    expect(worldState.data.state).not.toBeNull();

    const authorityGrants = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'authority_grants',
      selector: {}
    });
    expect(Array.isArray(authorityGrants.data.items)).toBe(true);

    const mediatorBindings = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'mediator_bindings',
      selector: {}
    });
    expect(Array.isArray(mediatorBindings.data.items)).toBe(true);

    const ruleExecutionSummary = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'rule_execution_summary',
      selector: {}
    });
    expect(Array.isArray(ruleExecutionSummary.data.items)).toBe(true);
  });
});
