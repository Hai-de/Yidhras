import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';

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

const assertArray = (value: unknown, label: string): unknown[] => {
  assert(Array.isArray(value), `${label} should be array`);
  return value;
};

const assertErrorEnvelope = (body: unknown, expectedCode: string) => {
  assert(isRecord(body), 'error response should be object');
  assert(body.success === false, 'error response success should be false');
  assert(isRecord(body.error), 'error response.error should be object');
  assert(body.error.code === expectedCode, `error code should be ${expectedCode}`);
  assert(typeof body.error.request_id === 'string', 'error.request_id should be string');
  assert(typeof body.error.timestamp === 'number', 'error.timestamp should be number');
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const healthRes = await requestJson(server.baseUrl, '/api/health');
    assert(
      healthRes.status === 200 || healthRes.status === 503,
      `unexpected /api/health status: ${healthRes.status}`
    );
    assert(isRecord(healthRes.body), '/api/health should return object');

    const notificationsRes = await requestJson(server.baseUrl, '/api/system/notifications');
    assert(notificationsRes.status === 200, 'GET /api/system/notifications should return 200');
    assertArray(notificationsRes.body, '/api/system/notifications');

    const clearRes = await requestJson(server.baseUrl, '/api/system/notifications/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(clearRes.status === 200, 'POST /api/system/notifications/clear should return 200');
    assert(isRecord(clearRes.body), '/api/system/notifications/clear should return object');
    assert(clearRes.body.success === true, '/api/system/notifications/clear success should be true');

    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    assert(isRecord(statusRes.body), '/api/status should return object');

    const runtimeReady = statusRes.body.runtime_ready === true;

    const clockRes = await requestJson(server.baseUrl, '/api/clock');
    if (runtimeReady) {
      assert(clockRes.status === 200, 'GET /api/clock should return 200 when runtime ready');
      assert(isRecord(clockRes.body), '/api/clock should return object when runtime ready');
      assert(typeof clockRes.body.absolute_ticks === 'string', '/api/clock absolute_ticks should be string');
      assert(Array.isArray(clockRes.body.calendars), '/api/clock calendars should be array');
    } else {
      assert(clockRes.status === 503, 'GET /api/clock should return 503 when runtime not ready');
      assertErrorEnvelope(clockRes.body, 'WORLD_PACK_NOT_READY');
    }

    const formattedClockRes = await requestJson(server.baseUrl, '/api/clock/formatted');
    if (runtimeReady) {
      assert(
        formattedClockRes.status === 200,
        'GET /api/clock/formatted should return 200 when runtime ready'
      );
      assert(isRecord(formattedClockRes.body), '/api/clock/formatted should return object');
      assert(typeof formattedClockRes.body.absolute_ticks === 'string', 'formatted clock absolute_ticks should be string');
      assert(Array.isArray(formattedClockRes.body.calendars), 'formatted clock calendars should be array');
    } else {
      assert(
        formattedClockRes.status === 503,
        'GET /api/clock/formatted should return 503 when runtime not ready'
      );
      assertErrorEnvelope(formattedClockRes.body, 'WORLD_PACK_NOT_READY');
    }

    const pauseRes = await requestJson(server.baseUrl, '/api/clock/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' })
    });
    const resumeRes = await requestJson(server.baseUrl, '/api/clock/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' })
    });

    if (runtimeReady) {
      assert(pauseRes.status === 200, 'pause should return 200 when runtime ready');
      assert(resumeRes.status === 200, 'resume should return 200 when runtime ready');
    } else {
      assert(pauseRes.status === 503, 'pause should return 503 when runtime not ready');
      assert(resumeRes.status === 503, 'resume should return 503 when runtime not ready');
    }

    const feedRes = await requestJson(server.baseUrl, '/api/social/feed?limit=5');
    const graphRes = await requestJson(server.baseUrl, '/api/relational/graph');
    const timelineRes = await requestJson(server.baseUrl, '/api/narrative/timeline');

    if (runtimeReady) {
      assert(feedRes.status === 200, 'GET /api/social/feed should return 200 when runtime ready');
      assertArray(feedRes.body, '/api/social/feed');

      assert(graphRes.status === 200, 'GET /api/relational/graph should return 200 when runtime ready');
      assert(isRecord(graphRes.body), '/api/relational/graph should return object');
      assert(Array.isArray(graphRes.body.nodes), 'graph.nodes should be array');
      assert(Array.isArray(graphRes.body.edges), 'graph.edges should be array');

      assert(timelineRes.status === 200, 'GET /api/narrative/timeline should return 200 when runtime ready');
      assertArray(timelineRes.body, '/api/narrative/timeline');

      const overrideRes = await requestJson(server.baseUrl, '/api/runtime/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override', step_ticks: '2' })
      });
      assert(overrideRes.status === 200, 'POST /api/runtime/speed override should return 200');
      assert(isRecord(overrideRes.body), 'runtime speed override response should be object');
      assert(overrideRes.body.success === true, 'runtime speed override success should be true');
      assert(isRecord(overrideRes.body.runtime_speed), 'runtime speed override payload should include runtime_speed');
      assert(typeof overrideRes.body.runtime_speed.override_since === 'number', 'runtime speed override should include override_since');

      const overrideClearRes = await requestJson(server.baseUrl, '/api/runtime/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' })
      });
      assert(overrideClearRes.status === 200, 'POST /api/runtime/speed clear should return 200');
      assert(isRecord(overrideClearRes.body), 'runtime speed clear response should be object');
      assert(overrideClearRes.body.success === true, 'runtime speed clear success should be true');
      assert(isRecord(overrideClearRes.body.runtime_speed), 'runtime speed clear payload should include runtime_speed');
      assert(overrideClearRes.body.runtime_speed.override_since === null, 'runtime speed clear should reset override_since');
    } else {
      assert(feedRes.status === 503, 'GET /api/social/feed should return 503 when runtime not ready');
      assert(graphRes.status === 503, 'GET /api/relational/graph should return 503 when runtime not ready');
      assert(timelineRes.status === 503, 'GET /api/narrative/timeline should return 503 when runtime not ready');
    }

    console.log('[smoke_endpoints] PASS');
    console.log(`[smoke_endpoints] runtime_ready=${runtimeReady}`);
  } catch (error: unknown) {
    console.error('[smoke_endpoints] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
