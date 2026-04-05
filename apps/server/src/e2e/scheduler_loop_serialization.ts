import { assert, isRecord, requestJson, startServer, summarizeResponse } from './helpers.js';

const parsePort = (): number => {
  const value = process.env.SMOKE_PORT;
  if (!value) {
    return 3112;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }

  return port;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const port = parsePort();
  const server = await startServer({
    port,
    envOverrides: {
      DEV_RUNTIME_RESET_ON_START: '1',
      SIM_LOOP_INTERVAL_MS: '50',
      SIM_LOOP_TEST_DELAY_MS: '250'
    }
  });

  try {
    await sleep(900);

    const response = await requestJson(server.baseUrl, '/api/status');
    assert(response.status === 200, summarizeResponse('/api/status', response));
    assert(isRecord(response.body), '/api/status body should be object');
    assert(response.body.success === true, '/api/status success should be true');
    assert(isRecord(response.body.data), '/api/status data should be object');

    const data = response.body.data as Record<string, unknown>;
    assert(isRecord(data.runtime_loop), 'runtime_loop should be object');

    const runtimeLoop = data.runtime_loop as Record<string, unknown>;
    assert(typeof runtimeLoop.iteration_count === 'number', 'runtime_loop.iteration_count should be number');
    assert(runtimeLoop.iteration_count >= 2, 'runtime loop should execute at least two delayed iterations');
    assert(runtimeLoop.overlap_skipped_count === 0, 'serial runtime loop should never record overlap skips');
    assert(typeof runtimeLoop.last_duration_ms === 'number', 'runtime loop should expose last_duration_ms');
    assert(runtimeLoop.last_duration_ms >= 250, 'last_duration_ms should reflect the injected artificial delay');
    assert(
      typeof runtimeLoop.status === 'string' && ['idle', 'scheduled', 'running'].includes(runtimeLoop.status),
      'runtime loop status should stay within serialized lifecycle states'
    );

    console.log('[scheduler_loop_serialization] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_loop_serialization] FAIL');
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
