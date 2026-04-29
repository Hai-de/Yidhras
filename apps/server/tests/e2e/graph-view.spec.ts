import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, withTestServer } from '../helpers/server.js';

const ensureGraphFixtures = async (prisma: ReturnType<typeof createPrismaClientForEnvironment>) => {
  const now = BigInt(Date.now());
  const traceId = 'graph-view-trace-001';
  const intentId = 'graph-view-intent-001';

  await prisma.agent.upsert({
    where: { id: 'agent-001' },
    update: { name: 'Agent-001', type: 'active', snr: 0.5, updated_at: now },
    create: {
      id: 'agent-001',
      name: 'Agent-001',
      type: 'active',
      snr: 0.5,
      is_pinned: false,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.agent.upsert({
    where: { id: 'agent-002' },
    update: { name: 'Agent-002', type: 'active', snr: 0.4, updated_at: now },
    create: {
      id: 'agent-002',
      name: 'Agent-002',
      type: 'active',
      snr: 0.4,
      is_pinned: false,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.relationship.upsert({
    where: { from_id_to_id_type: { from_id: 'agent-001', to_id: 'agent-002', type: 'friend' } },
    update: {
      id: 'graph-view-rel-001',
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'friend',
      weight: 0.7,
      updated_at: now
    },
    create: {
      id: 'graph-view-rel-001',
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'friend',
      weight: 0.7,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.atmosphereNode.upsert({
    where: { id: 'graph-view-atm-001' },
    update: {
      owner_id: 'agent-001',
      name: 'Graph View Atmosphere',
      expires_at: null
    },
    create: {
      id: 'graph-view-atm-001',
      owner_id: 'agent-001',
      name: 'Graph View Atmosphere',
      expires_at: null,
      created_at: now
    }
  });

  await prisma.identity.upsert({
    where: { id: 'graph-view-identity-001' },
    update: {
      type: 'agent',
      name: 'Graph View Identity',
      provider: 'm2',
      status: 'active',
      updated_at: now
    },
    create: {
      id: 'graph-view-identity-001',
      type: 'agent',
      name: 'Graph View Identity',
      provider: 'm2',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  });

  await prisma.identityNodeBinding.upsert({
    where: { id: 'graph-view-binding-001' },
    update: {
      identity_id: 'graph-view-identity-001',
      agent_id: 'agent-001',
      atmosphere_node_id: null,
      role: 'active',
      status: 'active',
      updated_at: now
    },
    create: {
      id: 'graph-view-binding-001',
      identity_id: 'graph-view-identity-001',
      agent_id: 'agent-001',
      atmosphere_node_id: null,
      role: 'active',
      status: 'active',
      expires_at: null,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.inferenceTrace.upsert({
    where: { id: traceId },
    update: {
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-001', identity_id: 'graph-view-identity-001', role: 'active' },
      input: { agent_id: 'agent-001' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: now.toString() },
      decision: { action_type: 'post_message', payload: { content: 'graph fixture' } },
      updated_at: now
    },
    create: {
      id: traceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { agent_id: 'agent-001', identity_id: 'graph-view-identity-001', role: 'active' },
      input: { agent_id: 'agent-001' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: now.toString() },
      decision: { action_type: 'post_message', payload: { content: 'graph fixture' } },
      created_at: now,
      updated_at: now
    }
  });

  await prisma.actionIntent.upsert({
    where: { id: intentId },
    update: {
      source_inference_id: traceId,
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001', identity_id: 'graph-view-identity-001', role: 'active' },
      target_ref: Prisma.JsonNull,
      payload: { content: 'graph fixture' },
      status: 'failed',
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      dispatch_error_code: 'ACTION_DISPATCH_FAIL',
      dispatch_error_message: 'graph fixture failed dispatch',
      created_at: now,
      updated_at: now
    },
    create: {
      id: intentId,
      source_inference_id: traceId,
      intent_type: 'post_message',
      actor_ref: { agent_id: 'agent-001', identity_id: 'graph-view-identity-001', role: 'active' },
      target_ref: Prisma.JsonNull,
      payload: { content: 'graph fixture' },
      status: 'failed',
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      dispatch_error_code: 'ACTION_DISPATCH_FAIL',
      dispatch_error_message: 'graph fixture failed dispatch',
      created_at: now,
      updated_at: now
    }
  });
};

describe('graph view e2e', () => {
  it('returns graph projections with filters, search, root selection and validation errors', async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);
      await ensureGraphFixtures(prisma);

      await withTestServer(
        {
          defaultPort: 3106,
          envOverrides: environment.envOverrides,
          prepareRuntime: false
        },
        async server => {
          const statusResponse = await requestJson(server.baseUrl, '/api/status');
          expect(statusResponse.status).toBe(200);
          const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
          expect(statusData.runtime_ready).toBe(true);

          const graphViewResponse = await requestJson(server.baseUrl, '/api/graph/view');
          expect(graphViewResponse.status).toBe(200);
          const graphView = assertSuccessEnvelopeData(graphViewResponse.body, 'graph view response');
          expect(graphView.schema_version).toBe('graph');
          expect(graphView.view).toBe('mesh');
          expect(Array.isArray(graphView.nodes)).toBe(true);
          expect(Array.isArray(graphView.edges)).toBe(true);
          const graphSummary = assertRecord(graphView.summary, 'graph view summary');
          expect(typeof graphSummary.returned_node_count).toBe('number');
          expect(typeof graphSummary.returned_edge_count).toBe('number');
          expect(isRecord(graphSummary.applied_filters)).toBe(true);
          const responseMeta = assertRecord((graphViewResponse.body as Record<string, unknown>).meta, 'graph view meta');
          expect(responseMeta.schema_version).toBe('graph');

          const hasAgentNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'agent');
          const hasAtmosphereNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'atmosphere');
          const hasRelationshipEdge = graphView.edges.some(edge => isRecord(edge) && edge.kind === 'relationship');
          const hasOwnershipEdge = graphView.edges.some(edge => isRecord(edge) && edge.kind === 'ownership');
          const hasRelayNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'relay');
          const hasContainerNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'container');
          const hasTransmissionEdge = graphView.edges.some(edge => isRecord(edge) && edge.kind === 'transmission');

          expect(hasAgentNode).toBe(true);
          expect(hasAtmosphereNode).toBe(true);
          expect(hasRelationshipEdge).toBe(true);
          expect(hasOwnershipEdge).toBe(true);
          expect(hasRelayNode).toBe(true);
          expect(hasContainerNode).toBe(true);
          expect(hasTransmissionEdge).toBe(true);

          const sampleRelayNode = graphView.nodes.find(node => isRecord(node) && node.kind === 'relay');
          expect(isRecord(sampleRelayNode)).toBe(true);
          expect(isRecord(sampleRelayNode?.metadata)).toBe(true);
          expect('relay_type' in (sampleRelayNode?.metadata as Record<string, unknown>)).toBe(true);

          const sampleContainerNode = graphView.nodes.find(node => isRecord(node) && node.kind === 'container');
          expect(isRecord(sampleContainerNode)).toBe(true);
          expect(isRecord(sampleContainerNode?.metadata)).toBe(true);
          expect('container_type' in (sampleContainerNode?.metadata as Record<string, unknown>)).toBe(true);

          const kindsResponse = await requestJson(server.baseUrl, '/api/graph/view?kinds=relay&kinds=container');
          expect(kindsResponse.status).toBe(200);
          const kindsGraph = assertSuccessEnvelopeData(kindsResponse.body, 'graph view filtered kinds');
          expect(Array.isArray(kindsGraph.nodes)).toBe(true);
          expect(
            kindsGraph.nodes.every(node => isRecord(node) && (node.kind === 'relay' || node.kind === 'container'))
          ).toBe(true);

          const noUnresolvedResponse = await requestJson(server.baseUrl, '/api/graph/view?include_unresolved=false');
          expect(noUnresolvedResponse.status).toBe(200);
          const noUnresolvedGraph = assertSuccessEnvelopeData(
            noUnresolvedResponse.body,
            'graph view include_unresolved=false'
          );
          expect(
            Array.isArray(noUnresolvedGraph.nodes) &&
              noUnresolvedGraph.nodes.every(node => !isRecord(node) || node.kind !== 'container')
          ).toBe(true);

          const rootResponse = await requestJson(server.baseUrl, '/api/graph/view?root_id=agent-001&depth=1');
          expect(rootResponse.status).toBe(200);
          const rootGraph = assertSuccessEnvelopeData(rootResponse.body, 'graph view rooted response');
          expect(Array.isArray(rootGraph.nodes)).toBe(true);
          expect(rootGraph.nodes.some(node => isRecord(node) && node.id === 'agent-001')).toBe(true);

          const searchResponse = await requestJson(server.baseUrl, '/api/graph/view?search=relay');
          expect(searchResponse.status).toBe(200);
          const searchGraph = assertSuccessEnvelopeData(searchResponse.body, 'graph view search response');
          expect(
            Array.isArray(searchGraph.nodes) &&
              searchGraph.nodes.every(
                node => isRecord(node) && typeof node.label === 'string' && node.label.toLowerCase().includes('relay')
              )
          ).toBe(true);

          const qAliasResponse = await requestJson(server.baseUrl, '/api/graph/view?q=relay');
          expect(qAliasResponse.status).toBe(200);
          const qAliasGraph = assertSuccessEnvelopeData(qAliasResponse.body, 'graph view q alias response');
          expect(
            Array.isArray(qAliasGraph.nodes) &&
              qAliasGraph.nodes.every(
                node => isRecord(node) && typeof node.label === 'string' && node.label.toLowerCase().includes('relay')
              )
          ).toBe(true);

          const inactiveResponse = await requestJson(server.baseUrl, '/api/graph/view?include_inactive=true');
          expect(inactiveResponse.status).toBe(200);
          const inactiveGraph = assertSuccessEnvelopeData(inactiveResponse.body, 'graph view include_inactive response');
          const inactiveSummary = assertRecord(inactiveGraph.summary, 'graph view include_inactive summary');
          const inactiveFilters = assertRecord(
            inactiveSummary.applied_filters,
            'graph view include_inactive applied_filters'
          );
          expect(inactiveFilters.include_inactive).toBe(true);

          const treeResponse = await requestJson(server.baseUrl, '/api/graph/view?view=tree');
          expect(treeResponse.status).toBe(200);
          const treeGraph = assertSuccessEnvelopeData(treeResponse.body, 'graph view tree response');
          expect(treeGraph.view).toBe('tree');

          const invalidKindsResponse = await requestJson(server.baseUrl, '/api/graph/view?kinds=unknown_kind');
          expect(invalidKindsResponse.status).toBe(400);
          assertErrorEnvelope(invalidKindsResponse.body, 'GRAPH_VIEW_QUERY_INVALID', 'invalid graph view kinds');

          const invalidDepthResponse = await requestJson(server.baseUrl, '/api/graph/view?depth=abc');
          expect(invalidDepthResponse.status).toBe(400);
          assertErrorEnvelope(invalidDepthResponse.body, 'GRAPH_VIEW_QUERY_INVALID', 'invalid graph view depth');
        }
      );
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
