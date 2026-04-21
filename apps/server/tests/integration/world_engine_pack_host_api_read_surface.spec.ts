import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { WorldEngineSidecarClient } from '../../src/app/runtime/sidecar/world_engine_sidecar_client.js';
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
  let sidecar: WorldEngineSidecarClient;

  beforeAll(async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    cleanup = environment.cleanup;
    await migrateIsolatedDatabase(environment);

    const prisma = createPrismaClientForEnvironment(environment);
    context = createTestAppContext(prisma);
    sidecar = new WorldEngineSidecarClient();
    process.env.WORKSPACE_ROOT = environment.rootDir;
    process.env.WORLD_PACKS_DIR = environment.worldPacksDir;
    process.env.DATABASE_URL = environment.databaseUrl;
    process.env.APP_ENV = environment.envOverrides.APP_ENV;
    await context.sim.init?.('death_note');

    context.worldEngine = sidecar as unknown as AppContext['worldEngine'];

    const loader = new PackManifestLoader(environment.worldPacksDir);
    const pack = loader.loadPack('death_note');
    packId = pack.metadata.id;
    context.activePackRuntime = {
      async init() {
        // noop
      },
      getActivePack() {
        return pack;
      },
      resolvePackVariables(template: string) {
        return template;
      },
      getStepTicks: () => 1n,
      getRuntimeSpeedSnapshot: () => ({ mode: 'fixed' as const, source: 'default' as const, configured_step_ticks: null, override_step_ticks: null, override_since: null, effective_step_ticks: '1' }),
      setRuntimeSpeedOverride: () => {},
      clearRuntimeSpeedOverride: () => {},
      getCurrentTick: () => 1000n,
      getAllTimes: () => ({ current_tick: '1000' }),
      step: async () => {}
    };
    await installPackRuntime(pack);
    await materializePackRuntimeCoreModels(pack, 1000n);
    await sidecar.loadPack({
      pack_id: packId,
      pack_ref: 'death_note',
      mode: 'active'
    });
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
    await sidecar?.unloadPack({ pack_id: packId });
    await sidecar?.stop();
    await context.prisma.$disconnect();
    await cleanup?.();
  });

  it('exposes stable host-mediated world read models for pack runtime core data', async () => {
    const hostApi = createPackHostApi(context);

    const entities = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'world_entities',
      selector: {
        entity_kind: 'artifact'
      },
      limit: 10
    });
    expect(Array.isArray(entities.data.items)).toBe(true);
    expect((entities.data.items ?? []).length).toBeGreaterThan(0);
    expect((entities.data.items ?? []).every(item => (item as { entity_kind?: string }).entity_kind === 'artifact')).toBe(true);

    const domains = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'world_entities',
      selector: {
        entity_kind: 'domain'
      },
      limit: 10
    });
    expect((domains.data.items ?? []).some(item => (item as { id?: string }).id === `${packId}:entity:domain-investigation`)).toBe(true);

    const institutions = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'world_entities',
      selector: {
        entity_kind: 'institution'
      },
      limit: 10
    });
    expect((institutions.data.items ?? []).some(item => (item as { id?: string }).id === `${packId}:entity:institution-npa-taskforce`)).toBe(true);

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

    const allAuthorityGrants = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'authority_grants',
      selector: {}
    });
    const firstAuthorityGrant = (allAuthorityGrants.data.items ?? [])[0] as { source_entity_id?: string; capability_key?: string } | undefined;
    expect(firstAuthorityGrant).toBeDefined();

    const authorityGrants = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'authority_grants',
      selector: {
        source_entity_id: firstAuthorityGrant?.source_entity_id ?? '',
        capability_key: firstAuthorityGrant?.capability_key ?? ''
      },
      limit: 5
    });
    expect(Array.isArray(authorityGrants.data.items)).toBe(true);
    expect((authorityGrants.data.items ?? []).every(item => (item as { source_entity_id?: string }).source_entity_id === firstAuthorityGrant?.source_entity_id)).toBe(true);

    const allMediatorBindings = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'mediator_bindings',
      selector: {}
    });
    const firstMediatorBinding = (allMediatorBindings.data.items ?? [])[0] as { mediator_id?: string; binding_kind?: string } | undefined;
    expect(firstMediatorBinding).toBeDefined();

    const mediatorBindings = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'mediator_bindings',
      selector: {
        mediator_id: firstMediatorBinding?.mediator_id ?? '',
        binding_kind: firstMediatorBinding?.binding_kind ?? ''
      }
    });
    expect(Array.isArray(mediatorBindings.data.items)).toBe(true);
    expect((mediatorBindings.data.items ?? []).every(item => (item as { mediator_id?: string }).mediator_id === firstMediatorBinding?.mediator_id)).toBe(true);

    const ruleExecutionSummary = await hostApi.queryWorldState({
      protocol_version: 'world_engine/v1alpha1',
      pack_id: packId,
      query_name: 'rule_execution_summary',
      selector: {
        execution_status: 'applied'
      },
      limit: 3
    });
    expect(Array.isArray(ruleExecutionSummary.data.items)).toBe(true);
    expect((ruleExecutionSummary.data.items ?? []).every(item => (item as { execution_status?: string }).execution_status === 'applied')).toBe(true);
  });
});
