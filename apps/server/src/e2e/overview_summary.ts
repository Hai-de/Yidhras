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
    assert(statusData.runtime_ready === true, 'overview summary test requires runtime_ready=true');

    const overviewRes = await requestJson(server.baseUrl, '/api/overview/summary');
    assert(overviewRes.status === 200, 'GET /api/overview/summary should return 200');
    const overview = assertSuccessEnvelopeData(overviewRes.body, 'overview summary response');

    assert(isRecord(overview.runtime), 'overview summary runtime should be object');
    assert(typeof overview.runtime.status === 'string', 'overview summary runtime.status should be string');
    assert(typeof overview.runtime.runtime_ready === 'boolean', 'overview summary runtime.runtime_ready should be boolean');

    assert(isRecord(overview.world_time), 'overview summary world_time should be object');
    assert(typeof overview.world_time.tick === 'string', 'overview summary world_time.tick should be string');
    assert(Array.isArray(overview.world_time.calendars), 'overview summary world_time.calendars should be array');

    assert(typeof overview.active_agent_count === 'number', 'overview summary active_agent_count should be number');
    assert(Array.isArray(overview.recent_events), 'overview summary recent_events should be array');
    assert(Array.isArray(overview.latest_posts), 'overview summary latest_posts should be array');
    assert(Array.isArray(overview.latest_propagation), 'overview summary latest_propagation should be array');
    assert(Array.isArray(overview.failed_jobs), 'overview summary failed_jobs should be array');
    assert(Array.isArray(overview.dropped_intents), 'overview summary dropped_intents should be array');
    assert(Array.isArray(overview.notifications), 'overview summary notifications should be array');

    console.log('[overview_summary] PASS');
  } catch (error: unknown) {
    console.error('[overview_summary] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling overview_summary failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
