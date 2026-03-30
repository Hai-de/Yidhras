import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';
import { assertSuccessEnvelopeData } from './status_helpers.js';

const parsePort = (): number => {
  const value = process.env.SMOKE_PORT;
  if (!value) {
    return 3101;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }
  return port;
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'graph view test requires runtime_ready=true');

    const graphViewRes = await requestJson(server.baseUrl, '/api/graph/view');
    assert(graphViewRes.status === 200, 'GET /api/graph/view should return 200');
    const graphView = assertSuccessEnvelopeData(graphViewRes.body, 'graph view response');
    assert(graphView.schema_version === 'graph-v2', 'graph view schema_version should be graph-v2');
    assert(graphView.view === 'mesh', 'graph view default view should be mesh');
    assert(Array.isArray(graphView.nodes), 'graph view nodes should be array');
    assert(Array.isArray(graphView.edges), 'graph view edges should be array');
    assert(isRecord(graphView.summary), 'graph view summary should be object');
    assert(isRecord((graphViewRes.body as Record<string, unknown>).meta), 'graph view meta should be object');
    assert(typeof graphView.summary.returned_node_count === 'number', 'graph view summary.returned_node_count should be number');
    assert(typeof graphView.summary.returned_edge_count === 'number', 'graph view summary.returned_edge_count should be number');
    assert(isRecord(graphView.summary.applied_filters), 'graph view summary.applied_filters should be object');

    const hasAgentNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'agent');
    const hasAtmosphereNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'atmosphere');
    const hasRelationshipEdge = graphView.edges.some(edge => isRecord(edge) && edge.kind === 'relationship');
    const hasOwnershipEdge = graphView.edges.some(edge => isRecord(edge) && edge.kind === 'ownership');
    const hasRelayNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'relay');
    const hasContainerNode = graphView.nodes.some(node => isRecord(node) && node.kind === 'container');
    const hasTransmissionEdge = graphView.edges.some(edge => isRecord(edge) && edge.kind === 'transmission');

    assert(hasAgentNode, 'graph view should include agent node');
    assert(hasAtmosphereNode, 'graph view should include atmosphere node');
    assert(hasRelationshipEdge, 'graph view should include relationship edge');
    assert(hasOwnershipEdge, 'graph view should include ownership edge');
    assert(hasRelayNode, 'graph view should include relay node');
    assert(hasContainerNode, 'graph view should include container node');
    assert(hasTransmissionEdge, 'graph view should include transmission edge');

    const sampleRelayNode = graphView.nodes.find(node => isRecord(node) && node.kind === 'relay');
    assert(isRecord(sampleRelayNode), 'graph view should expose sample relay node');
    assert(isRecord(sampleRelayNode.metadata), 'graph view relay metadata should be object');
    assert('relay_type' in sampleRelayNode.metadata, 'graph view relay metadata should include relay_type');

    const sampleContainerNode = graphView.nodes.find(node => isRecord(node) && node.kind === 'container');
    assert(isRecord(sampleContainerNode), 'graph view should expose sample container node');
    assert(isRecord(sampleContainerNode.metadata), 'graph view container metadata should be object');
    assert('container_type' in sampleContainerNode.metadata, 'graph view container metadata should include container_type');

    const relayKindsRes = await requestJson(server.baseUrl, '/api/graph/view?kinds=relay,container');
    assert(relayKindsRes.status === 200, 'GET /api/graph/view?kinds=relay,container should return 200');
    const relayKindsGraph = assertSuccessEnvelopeData(relayKindsRes.body, 'graph view relay kinds response');
    assert(Array.isArray(relayKindsGraph.nodes), 'graph view relay kinds response nodes should be array');
    assert(
      relayKindsGraph.nodes.every((node: unknown) => isRecord(node) && (node.kind === 'relay' || node.kind === 'container')),
      'graph view kinds=relay,container should only include relay/container nodes'
    );

    const noUnresolvedRes = await requestJson(server.baseUrl, '/api/graph/view?include_unresolved=false');
    assert(noUnresolvedRes.status === 200, 'GET /api/graph/view?include_unresolved=false should return 200');
    const noUnresolvedGraph = assertSuccessEnvelopeData(noUnresolvedRes.body, 'graph view no unresolved response');
    assert(
      Array.isArray(noUnresolvedGraph.nodes) &&
        noUnresolvedGraph.nodes.every((node: unknown) => !isRecord(node) || node.kind !== 'container'),
      'graph view include_unresolved=false should exclude container nodes'
    );

    const rootRes = await requestJson(server.baseUrl, '/api/graph/view?root_id=agent-001&depth=1');
    assert(rootRes.status === 200, 'GET /api/graph/view with root_id should return 200');
    const rootGraph = assertSuccessEnvelopeData(rootRes.body, 'graph view root response');
    assert(Array.isArray(rootGraph.nodes), 'graph view root response nodes should be array');
    assert(
      rootGraph.nodes.some((node: unknown) => isRecord(node) && node.id === 'agent-001'),
      'graph view root response should include root node'
    );

    const searchRes = await requestJson(server.baseUrl, '/api/graph/view?search=relay');
    assert(searchRes.status === 200, 'GET /api/graph/view?search=relay should return 200');
    const searchGraph = assertSuccessEnvelopeData(searchRes.body, 'graph view search response');
    assert(
      Array.isArray(searchGraph.nodes) &&
        searchGraph.nodes.every((node: unknown) => isRecord(node) && String(node.label).toLowerCase().includes('relay')),
      'graph view search should filter nodes by search term'
    );

    const inactiveRes = await requestJson(server.baseUrl, '/api/graph/view?include_inactive=true');
    assert(inactiveRes.status === 200, 'GET /api/graph/view?include_inactive=true should return 200');
    const inactiveGraph = assertSuccessEnvelopeData(inactiveRes.body, 'graph view inactive response');
    assert(isRecord(inactiveGraph.summary), 'graph view inactive summary should be object');
    assert(isRecord(inactiveGraph.summary.applied_filters), 'graph view inactive summary.applied_filters should be object');
    assert(inactiveGraph.summary.applied_filters.include_inactive === true, 'graph view applied_filters.include_inactive should be true');

    const treeRes = await requestJson(server.baseUrl, '/api/graph/view?view=tree');
    assert(treeRes.status === 200, 'GET /api/graph/view?view=tree should return 200');
    const treeGraph = assertSuccessEnvelopeData(treeRes.body, 'graph view tree response');
    assert(treeGraph.view === 'tree', 'graph view tree response should preserve requested view');

    const invalidKindsRes = await requestJson(server.baseUrl, '/api/graph/view?kinds=unknown_kind');
    assert(invalidKindsRes.status === 400, 'GET /api/graph/view with unsupported kinds should return 400');
    assert(isRecord(invalidKindsRes.body), 'invalid graph view response should be object');
    assert(invalidKindsRes.body.success === false, 'invalid graph view response success should be false');

    console.log('[graph_view] PASS');
  } catch (error: unknown) {
    console.error('[graph_view] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling graph_view failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
