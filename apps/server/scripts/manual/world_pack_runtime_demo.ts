import {
  assert,
  requestJson,
  startServer,
  summarizeResponse
} from '../../tests/support/helpers.js';
import { assertSuccessEnvelopeData } from '../../tests/support/status_helpers.js';

const parsePort = (): number => {
  const value = process.env.SMOKE_PORT;
  if (!value) {
    return 3103;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }
  return port;
};

const ACTIVE_PACK_ROUTE_NAME = 'world-death-note';

const main = async () => {
  const port = parsePort();
  const server = await startServer({
    port,
    prepareRuntime: true,
    envOverrides: {
      DEV_RUNTIME_RESET_ON_START: '0'
    }
  });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    if (!statusData || typeof statusData !== 'object' || Array.isArray(statusData)) {
      throw new Error('status payload must be an object');
    }
    assert(statusData.runtime_ready === true, 'world_pack_runtime_demo requires runtime_ready=true');
    assert((statusData as { world_pack?: { id?: string } }).world_pack?.id === ACTIVE_PACK_ROUTE_NAME, 'active world pack should be world-death-note');

    const schedulerRes = await requestJson(
      server.baseUrl,
      '/api/agent/agent-001/scheduler/projection?limit=10'
    );
    assert(schedulerRes.status === 200, 'GET /api/agent/agent-001/scheduler/projection should return 200');
    const schedulerProjection = assertSuccessEnvelopeData(schedulerRes.body, 'agent-001 scheduler projection');
    assert(Array.isArray(schedulerProjection.timeline), 'agent-001 scheduler projection should include timeline');

    const timelineRes = await requestJson(server.baseUrl, `/api/packs/${ACTIVE_PACK_ROUTE_NAME}/projections/timeline`);
    assert(timelineRes.status === 200, `GET /api/packs/${ACTIVE_PACK_ROUTE_NAME}/projections/timeline should return 200`);
    const timelineProjection = assertSuccessEnvelopeData(timelineRes.body, 'pack timeline projection');
    assert(Array.isArray(timelineProjection.timeline), 'pack timeline projection should include timeline');

    console.log('[world_pack_runtime_demo] PASS');
  } catch (error: unknown) {
    console.error('[world_pack_runtime_demo] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling world_pack_runtime_demo failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
