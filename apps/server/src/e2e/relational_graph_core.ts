import { Prisma, PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import { getGraphView } from '../app/services/relational.js';
import { parseGraphViewFilters } from '../app/services/relational/graph_filters.js';
import { buildContainerNodeId, buildRelayNodeId, getNeighborhoodNodeIds } from '../app/services/relational/graph_traversal.js';
import { ChronosEngine } from '../clock/engine.js';
import type { SimulationManager } from '../core/simulation.js';
import { notifications } from '../utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from './config.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }

  throw new Error(message);
}

const buildTestContext = (prisma: PrismaClient): AppContext => {
  let paused = false;
  let runtimeReady = true;

  const sim = {
    prisma,
    clock: new ChronosEngine([], 2000n),
    getStepTicks: () => 1n,
    step: async () => {},
    getActivePack: () => null,
    getRuntimeSpeedSnapshot: () => ({
      mode: 'fixed' as const,
      source: 'default' as const,
      configured_step_ticks: null,
      override_step_ticks: null,
      override_since: null,
      effective_step_ticks: '1'
    }),
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {},
    getGraphData: async () => ({ nodes: [], edges: [] })
  } as unknown as SimulationManager;

  const startupHealth: StartupHealth = {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: [DEFAULT_E2E_WORLD_PACK],
    errors: []
  };

  return {
    prisma,
    sim,
    notifications,
    startupHealth,
    getRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    getPaused: () => paused,
    setPaused: next => {
      paused = next;
    },
    assertRuntimeReady: () => {}
  };
};

const testGraphFilters = () => {
  const defaults = parseGraphViewFilters({});
  assert(defaults.view === 'mesh', 'default graph view should be mesh');
  assert(defaults.depth === 1, 'default graph depth should be 1');
  assert(defaults.kinds === null, 'default graph kinds should be null');
  assert(defaults.search === null, 'default graph search should be null');
  assert(defaults.includeInactive === false, 'default includeInactive should be false');
  assert(defaults.includeUnresolved === true, 'default includeUnresolved should be true');

  const normalized = parseGraphViewFilters({
    view: 'tree',
    depth: 99,
    kinds: ['agent', 'relay', 'agent'],
    root_id: '  agent-001  ',
    search: '  Alpha  ',
    include_inactive: true,
    include_unresolved: false
  });
  assert(normalized.view === 'tree', 'explicit graph view should be tree');
  assert(normalized.depth === 3, 'graph depth should clamp to max 3');
  assert(Array.isArray(normalized.kinds) && normalized.kinds.length === 2, 'graph kinds should dedupe values');
  assert(normalized.rootId === 'agent-001', 'graph root id should trim whitespace');
  assert(normalized.search === 'alpha', 'graph search should be lowercased and trimmed');
  assert(normalized.includeInactive === true, 'includeInactive should reflect explicit true');
  assert(normalized.includeUnresolved === false, 'includeUnresolved should reflect explicit false');

  assertThrows(
    () => parseGraphViewFilters({ kinds: ['agent', 'unknown-kind'] }),
    'parseGraphViewFilters should reject unsupported kinds'
  );
};

const testGraphTraversal = () => {
  const rootId = 'agent-001';
  const neighborhood = getNeighborhoodNodeIds(
    rootId,
    1,
    [{ from_id: 'agent-001', to_id: 'agent-002' }],
    [{ id: 'atmo-001', owner_id: 'agent-001' }],
    [{
      id: 'intent-001',
      actor_ref: { agent_id: 'agent-001' },
      source_inference_id: 'trace-001',
      status: 'failed'
    }]
  );

  assert(neighborhood.has('agent-001'), 'traversal should include root');
  assert(neighborhood.has('agent-002'), 'traversal should include related agent');
  assert(neighborhood.has('atmo-001'), 'traversal should include owned atmosphere node');
  assert(neighborhood.has(buildRelayNodeId('intent-001')), 'traversal should include relay node for actor intent');
  assert(neighborhood.has(buildContainerNodeId('intent-001')), 'traversal should include failed intent container node');
};

const ensureAgent = async (
  prisma: PrismaClient,
  input: { id: string; name: string; type?: 'active' | 'noise' | 'system'; is_pinned?: boolean; snr?: number }
) => {
  await prisma.agent.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      type: input.type ?? 'active',
      is_pinned: input.is_pinned ?? false,
      snr: input.snr ?? 0.5
    },
    create: {
      id: input.id,
      name: input.name,
      type: input.type ?? 'active',
      is_pinned: input.is_pinned ?? false,
      snr: input.snr ?? 0.5,
      created_at: 2000n,
      updated_at: 2000n
    }
  });
};

const testGraphProjection = async (context: AppContext) => {
  const prisma = context.prisma;
  const successTraceId = `trace-graph-success-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const failedTraceId = `trace-graph-failed-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  await ensureAgent(prisma, { id: 'agent-001', name: 'Alpha Agent', type: 'active', is_pinned: true, snr: 0.9 });
  await ensureAgent(prisma, { id: 'agent-002', name: 'Beta Agent', type: 'noise', snr: 0.3 });

  await prisma.relationship.upsert({
    where: { id: 'rel-001' },
    update: {
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'ally',
      weight: 0.8
    },
    create: {
      id: 'rel-001',
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'ally',
      weight: 0.8,
      created_at: 2000n,
      updated_at: 2000n
    }
  });

  await prisma.atmosphereNode.upsert({
    where: { id: 'atmo-001' },
    update: {
      owner_id: 'agent-001',
      name: 'Alpha Atmosphere',
      expires_at: null
    },
    create: {
      id: 'atmo-001',
      owner_id: 'agent-001',
      name: 'Alpha Atmosphere',
      expires_at: null,
      created_at: 2000n
    }
  });

  await prisma.identityNodeBinding.create({
    data: {
      id: `binding-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      identity_id: 'agent-001',
      agent_id: 'agent-001',
      atmosphere_node_id: null,
      role: 'active',
      status: 'active',
      created_at: 2000n,
      updated_at: 2000n,
      expires_at: null
    }
  });

  await prisma.inferenceTrace.create({
    data: {
      id: successTraceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-001' },
      input: { agent_id: 'agent-001' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: '2000', strategy: 'mock', provider: 'mock' },
      decision: { action_type: 'post_message', payload: { content: 'hello' } },
      created_at: 2000n,
      updated_at: 2000n
    }
  });

  await prisma.actionIntent.upsert({
    where: { id: 'intent-graph-001' },
    update: {
      source_inference_id: successTraceId,
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: Prisma.JsonNull,
      payload: { content: 'hello' },
      status: 'completed',
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null,
      dispatch_error_code: null,
      dispatch_error_message: null
    },
    create: {
      id: 'intent-graph-001',
      source_inference_id: successTraceId,
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: Prisma.JsonNull,
      payload: { content: 'hello' },
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      status: 'completed',
      dispatch_started_at: null,
      dispatched_at: null,
      transmission_delay_ticks: null,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null,
      dispatch_error_code: null,
      dispatch_error_message: null,
      created_at: 2000n,
      updated_at: 2000n
    }
  });

  await prisma.inferenceTrace.create({
    data: {
      id: failedTraceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-001' },
      input: { agent_id: 'agent-001' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: '2001', strategy: 'mock', provider: 'mock' },
      decision: { action_type: 'adjust_relationship', payload: { relationship: 'ally' } },
      created_at: 2001n,
      updated_at: 2001n
    }
  });

  await prisma.actionIntent.upsert({
    where: { id: 'intent-graph-failed' },
    update: {
      source_inference_id: failedTraceId,
      intent_type: 'adjust_relationship',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: Prisma.JsonNull,
      payload: { relationship: 'ally' },
      status: 'failed',
      transmission_policy: 'fragile',
      transmission_drop_chance: 0.5,
      drop_reason: null,
      dispatch_error_code: 'ACTION_DISPATCH_FAIL',
      dispatch_error_message: 'dispatch failed'
    },
    create: {
      id: 'intent-graph-failed',
      source_inference_id: failedTraceId,
      intent_type: 'adjust_relationship',
      actor_ref: { agent_id: 'agent-001' },
      target_ref: Prisma.JsonNull,
      payload: { relationship: 'ally' },
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      status: 'failed',
      dispatch_started_at: null,
      dispatched_at: null,
      transmission_delay_ticks: null,
      transmission_policy: 'fragile',
      transmission_drop_chance: 0.5,
      drop_reason: null,
      dispatch_error_code: 'ACTION_DISPATCH_FAIL',
      dispatch_error_message: 'dispatch failed',
      created_at: 2001n,
      updated_at: 2001n
    }
  });

  const defaultView = await getGraphView(context, {});
  assert(defaultView.view === 'mesh', 'default graph projection should use mesh view');
  assert(defaultView.summary.returned_node_count >= 4, 'default graph projection should include agent/atmosphere/relay/container nodes');
  assert(defaultView.summary.counts_by_kind.agent >= 2, 'graph summary should count agents');
  assert(defaultView.summary.active_root_ids.includes('agent-001'), 'graph summary should include active root ids');

  const rootedView = await getGraphView(context, {
    root_id: 'agent-001',
    depth: 1,
    include_unresolved: true
  });
  assert(rootedView.summary.applied_filters.root_id === 'agent-001', 'graph summary should echo applied root_id');
  assert(rootedView.nodes.some(node => node.id === 'agent-001'), 'rooted projection should include root node');
  assert(rootedView.nodes.some(node => node.id === 'agent-002'), 'rooted projection should include relationship neighbor');
  assert(rootedView.nodes.some(node => node.id === 'atmo-001'), 'rooted projection should include owned atmosphere node');
  assert(rootedView.summary.applied_filters.include_unresolved === true, 'rooted projection should preserve include_unresolved=true in summary');
  assert(rootedView.summary.returned_node_count >= 3, 'rooted projection should return a non-empty contextual node set');

  const searchView = await getGraphView(context, {
    search: 'alpha atmosphere'
  });
  assert(searchView.nodes.length >= 1, 'search graph projection should return at least one node');
  assert(searchView.nodes.every(node => node.label.toLowerCase().includes('alpha') || JSON.stringify(node.metadata ?? {}).toLowerCase().includes('alpha')), 'search graph projection should constrain returned nodes');

  const noUnresolvedView = await getGraphView(context, {
    include_unresolved: false
  });
  assert(
    !noUnresolvedView.nodes.some(node => node.id === buildContainerNodeId('intent-graph-failed')),
    'include_unresolved=false should exclude failed container nodes'
  );
};

const main = async () => {
  const prisma = new PrismaClient();
  const context = buildTestContext(prisma);

  try {
    testGraphFilters();
    testGraphTraversal();
    await testGraphProjection(context);

    console.log('[relational_graph_core] PASS');
  } catch (error: unknown) {
    console.error('[relational_graph_core] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
