import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { getGraphView } from '../../src/app/services/relational.js';
import { parseGraphViewFilters } from '../../src/app/services/relational/graph_filters.js';
import {
  buildContainerNodeId,
  buildRelayNodeId,
  getNeighborhoodNodeIds
} from '../../src/app/services/relational/graph_traversal.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

describe('relational graph core integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('normalizes graph view filters and rejects unsupported kinds', () => {
    const defaults = parseGraphViewFilters({});
    expect(defaults.view).toBe('mesh');
    expect(defaults.depth).toBe(1);
    expect(defaults.kinds).toBeNull();
    expect(defaults.search).toBeNull();
    expect(defaults.includeInactive).toBe(false);
    expect(defaults.includeUnresolved).toBe(true);

    const normalized = parseGraphViewFilters({
      view: 'tree',
      depth: 99,
      kinds: ['agent', 'relay', 'agent'],
      root_id: '  agent-001  ',
      search: '  Alpha  ',
      include_inactive: true,
      include_unresolved: false
    });

    expect(normalized.view).toBe('tree');
    expect(normalized.depth).toBe(3);
    expect(normalized.kinds).toEqual(['agent', 'relay']);
    expect(normalized.rootId).toBe('agent-001');
    expect(normalized.search).toBe('alpha');
    expect(normalized.includeInactive).toBe(true);
    expect(normalized.includeUnresolved).toBe(false);

    expect(() => parseGraphViewFilters({ kinds: ['agent', 'unknown-kind'] })).toThrow();
  });

  it('builds traversal neighborhoods across agents, atmosphere nodes and relay/container nodes', () => {
    const rootId = 'agent-001';
    const neighborhood = getNeighborhoodNodeIds(
      rootId,
      1,
      [{ from_id: 'agent-001', to_id: 'agent-002' }],
      [{ id: 'atmo-001', owner_id: 'agent-001' }],
      [
        {
          id: 'intent-001',
          actor_ref: { agent_id: 'agent-001' },
          source_inference_id: 'trace-001',
          status: 'failed'
        }
      ]
    );

    expect(neighborhood.has('agent-001')).toBe(true);
    expect(neighborhood.has('agent-002')).toBe(true);
    expect(neighborhood.has('atmo-001')).toBe(true);
    expect(neighborhood.has(buildRelayNodeId('intent-001'))).toBe(true);
    expect(neighborhood.has(buildContainerNodeId('intent-001'))).toBe(true);
  });

  it('projects graph nodes and edges with root, search and unresolved filters', async () => {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const rootAgentId = `graph-agent-root-${runId}`;
    const peerAgentId = `graph-agent-peer-${runId}`;
    const relationshipId = `graph-rel-${runId}`;
    const atmosphereId = `graph-atmo-${runId}`;
    const bindingId = `graph-binding-${runId}`;
    const successTraceId = `graph-trace-success-${runId}`;
    const failedTraceId = `graph-trace-failed-${runId}`;
    const successIntentId = `graph-intent-success-${runId}`;
    const failedIntentId = `graph-intent-failed-${runId}`;

    await context.prisma.agent.createMany({
      data: [
        {
          id: rootAgentId,
          name: 'Alpha Agent',
          type: 'active',
          is_pinned: true,
          snr: 0.9,
          created_at: 2000n,
          updated_at: 2000n
        },
        {
          id: peerAgentId,
          name: 'Beta Agent',
          type: 'noise',
          is_pinned: false,
          snr: 0.3,
          created_at: 2000n,
          updated_at: 2000n
        }
      ]
    });

    await context.prisma.relationship.create({
      data: {
        id: relationshipId,
        from_id: rootAgentId,
        to_id: peerAgentId,
        type: 'ally',
        weight: 0.8,
        created_at: 2000n,
        updated_at: 2000n
      }
    });

    await context.prisma.atmosphereNode.create({
      data: {
        id: atmosphereId,
        owner_id: rootAgentId,
        name: 'Alpha Atmosphere',
        expires_at: null,
        created_at: 2000n
      }
    });

    await context.prisma.identity.create({
      data: {
        id: rootAgentId,
        type: 'agent',
        name: 'Alpha Agent Identity',
        provider: 'm2',
        status: 'active',
        created_at: 2000n,
        updated_at: 2000n
      }
    });

    await context.prisma.identityNodeBinding.create({
      data: {
        id: bindingId,
        identity_id: rootAgentId,
        agent_id: rootAgentId,
        atmosphere_node_id: null,
        role: 'active',
        status: 'active',
        created_at: 2000n,
        updated_at: 2000n,
        expires_at: null
      }
    });

    await context.prisma.inferenceTrace.createMany({
      data: [
        {
          id: successTraceId,
          kind: 'run',
          strategy: 'mock',
          provider: 'mock',
          actor_ref: { agent_id: rootAgentId } as Prisma.InputJsonValue,
          input: { agent_id: rootAgentId } as Prisma.InputJsonValue,
          context_snapshot: {} as Prisma.InputJsonValue,
          prompt_bundle: {} as Prisma.InputJsonValue,
          trace_metadata: { tick: '2000', strategy: 'mock', provider: 'mock' } as Prisma.InputJsonValue,
          decision: { action_type: 'post_message', payload: { content: 'hello' } } as Prisma.InputJsonValue,
          created_at: 2000n,
          updated_at: 2000n
        },
        {
          id: failedTraceId,
          kind: 'run',
          strategy: 'mock',
          provider: 'mock',
          actor_ref: { agent_id: rootAgentId } as Prisma.InputJsonValue,
          input: { agent_id: rootAgentId } as Prisma.InputJsonValue,
          context_snapshot: {} as Prisma.InputJsonValue,
          prompt_bundle: {} as Prisma.InputJsonValue,
          trace_metadata: { tick: '2001', strategy: 'mock', provider: 'mock' } as Prisma.InputJsonValue,
          decision: {
            action_type: 'adjust_relationship',
            payload: { relationship: 'ally' }
          } as Prisma.InputJsonValue,
          created_at: 2001n,
          updated_at: 2001n
        }
      ]
    });

    await context.prisma.actionIntent.createMany({
      data: [
        {
          id: successIntentId,
          source_inference_id: successTraceId,
          intent_type: 'post_message',
          actor_ref: { agent_id: rootAgentId } as Prisma.InputJsonValue,
          target_ref: Prisma.JsonNull,
          payload: { content: 'hello' } as Prisma.InputJsonValue,
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
          locked_by: null,
          locked_at: null,
          lock_expires_at: null,
          created_at: 2000n,
          updated_at: 2000n
        },
        {
          id: failedIntentId,
          source_inference_id: failedTraceId,
          intent_type: 'adjust_relationship',
          actor_ref: { agent_id: rootAgentId } as Prisma.InputJsonValue,
          target_ref: Prisma.JsonNull,
          payload: { relationship: 'ally' } as Prisma.InputJsonValue,
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
          locked_by: null,
          locked_at: null,
          lock_expires_at: null,
          created_at: 2001n,
          updated_at: 2001n
        }
      ]
    });

    const defaultView = await getGraphView(context, {});
    expect(defaultView.view).toBe('mesh');
    expect(defaultView.summary.returned_node_count).toBeGreaterThanOrEqual(4);
    expect(defaultView.summary.counts_by_kind.agent).toBeGreaterThanOrEqual(2);
    expect(defaultView.summary.active_root_ids).toContain(rootAgentId);
    expect(defaultView.nodes.some(node => node.id === buildRelayNodeId(successIntentId))).toBe(true);
    expect(defaultView.nodes.some(node => node.id === buildContainerNodeId(failedIntentId))).toBe(true);

    const rootedView = await getGraphView(context, {
      root_id: rootAgentId,
      depth: 1,
      include_unresolved: true
    });
    expect(rootedView.summary.applied_filters.root_id).toBe(rootAgentId);
    expect(rootedView.summary.applied_filters.include_unresolved).toBe(true);
    expect(rootedView.nodes.some(node => node.id === rootAgentId)).toBe(true);
    expect(rootedView.nodes.some(node => node.id === peerAgentId)).toBe(true);
    expect(rootedView.nodes.some(node => node.id === atmosphereId)).toBe(true);
    expect(rootedView.summary.returned_node_count).toBeGreaterThanOrEqual(3);

    const searchView = await getGraphView(context, {
      search: 'alpha atmosphere'
    });
    expect(searchView.nodes.length).toBeGreaterThanOrEqual(1);
    expect(
      searchView.nodes.every(
        node =>
          node.label.toLowerCase().includes('alpha') ||
          JSON.stringify(node.metadata ?? {}).toLowerCase().includes('alpha')
      )
    ).toBe(true);

    const noUnresolvedView = await getGraphView(context, {
      include_unresolved: false
    });
    expect(
      noUnresolvedView.nodes.some(node => node.id === buildContainerNodeId(failedIntentId))
    ).toBe(false);
  });
});
