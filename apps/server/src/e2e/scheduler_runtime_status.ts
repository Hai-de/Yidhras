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
    return 3103;
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
    assert(isRecord(statusRes.body), 'status response should be object');
    assert(statusRes.body.success === true, 'status response success should be true');
    assert(isRecord(statusRes.body.data), 'status response data should be object');
    const data = statusRes.body.data as Record<string, unknown>;

    assert(isRecord(data.scheduler), 'status.scheduler should be object');
    assert(typeof data.scheduler.worker_id === 'string', 'status.scheduler.worker_id should be string');
    assert(typeof data.scheduler.partition_count === 'number', 'status.scheduler.partition_count should be number');
    assert(Array.isArray(data.scheduler.owned_partition_ids), 'status.scheduler.owned_partition_ids should be array');
    assert(typeof data.scheduler.assignment_source === 'string', 'status.scheduler.assignment_source should be string');
    assert(typeof data.scheduler.migration_in_progress_count === 'number', 'status.scheduler.migration_in_progress_count should be number');
    assert(typeof data.scheduler.worker_runtime_status === 'string', 'status.scheduler.worker_runtime_status should be string');
    assert(data.scheduler.last_heartbeat_at === null || typeof data.scheduler.last_heartbeat_at === 'string', 'status.scheduler.last_heartbeat_at should be nullable string');
    assert(typeof data.scheduler.automatic_rebalance_enabled === 'boolean', 'status.scheduler.automatic_rebalance_enabled should be boolean');

    console.log('[scheduler_runtime_status] PASS', {
      worker_id: data.scheduler.worker_id,
      partition_count: data.scheduler.partition_count,
      owned_partition_ids: data.scheduler.owned_partition_ids,
      assignment_source: data.scheduler.assignment_source,
      migration_in_progress_count: data.scheduler.migration_in_progress_count,
      worker_runtime_status: data.scheduler.worker_runtime_status,
      last_heartbeat_at: data.scheduler.last_heartbeat_at,
      automatic_rebalance_enabled: data.scheduler.automatic_rebalance_enabled
    });
  } catch (error: unknown) {
    console.error('[scheduler_runtime_status] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling scheduler_runtime_status failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
