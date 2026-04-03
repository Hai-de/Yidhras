import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';

interface HealthChecks {
  db: boolean;
  world_pack_dir: boolean;
  world_pack_available: boolean;
}

interface HealthPayload {
  success: true;
  data: {
    healthy: boolean;
    level: 'ok' | 'degraded' | 'fail';
    runtime_ready: boolean;
    checks: HealthChecks;
    available_world_packs: string[];
    errors: string[];
  };
}

interface StatusWorldPack {
  id: string;
  name: string;
  version: string;
}

interface StatusPayload {
  success: true;
  data: {
    status: 'running' | 'paused';
    runtime_ready: boolean;
    runtime_speed: {
      mode: 'fixed';
      source: 'default' | 'world_pack' | 'override';
      configured_step_ticks: string | null;
      override_step_ticks: string | null;
      override_since: number | null;
      effective_step_ticks: string;
    };
    scheduler: {
      worker_id: string;
      partition_count: number;
      owned_partition_ids: string[];
    };
    health_level: 'ok' | 'degraded' | 'fail';
    world_pack: StatusWorldPack | null;
    has_error: boolean;
    startup_errors: string[];
  };
}

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

const asHealthPayload = (value: unknown): HealthPayload => {
  assert(isRecord(value), 'health response must be object');
  assert(value.success === true, 'health response success must be true');
  assert(isRecord(value.data), 'health response data must be object');
  const data = value.data as Record<string, unknown>;

  const checksValue = data.checks;
  assert(isRecord(checksValue), 'health.checks must be object');

  const checks: HealthChecks = {
    db: checksValue.db === true,
    world_pack_dir: checksValue.world_pack_dir === true,
    world_pack_available: checksValue.world_pack_available === true
  };

  assert(
    typeof data.level === 'string' && ['ok', 'degraded', 'fail'].includes(data.level),
    'health.level must be ok|degraded|fail'
  );
  assert(typeof data.healthy === 'boolean', 'health.healthy must be boolean');
  assert(Array.isArray(data.available_world_packs), 'health.available_world_packs must be array');
  assert(Array.isArray(data.errors), 'health.errors must be array');

  return {
    success: true,
    data: {
      healthy: data.healthy === true,
      level: data.level as HealthPayload['data']['level'],
      runtime_ready: data.runtime_ready === true,
      checks,
      available_world_packs: data.available_world_packs.filter(item => typeof item === 'string'),
      errors: data.errors.filter(item => typeof item === 'string')
    }
  };
};

const asStatusPayload = (value: unknown): StatusPayload => {
  assert(isRecord(value), 'status response must be object');
  assert(value.success === true, 'status response success must be true');
  assert(isRecord(value.data), 'status response data must be object');
  const data = value.data as Record<string, unknown>;
  assert(
    typeof data.status === 'string' && ['running', 'paused'].includes(data.status),
    'status.status must be running|paused'
  );
  assert(
    typeof data.health_level === 'string' && ['ok', 'degraded', 'fail'].includes(data.health_level),
    'status.health_level must be ok|degraded|fail'
  );
  assert(Array.isArray(data.startup_errors), 'status.startup_errors must be array');
  assert(isRecord(data.runtime_speed), 'status.runtime_speed must be object');
  assert(data.runtime_speed.mode === 'fixed', 'runtime_speed.mode must be fixed');
  assert(
    typeof data.runtime_speed.source === 'string' && ['default', 'world_pack', 'override'].includes(data.runtime_speed.source),
    'runtime_speed.source must be default|world_pack|override'
  );
  assert(typeof data.runtime_speed.effective_step_ticks === 'string', 'runtime_speed.effective_step_ticks must be string');
  assert(
    data.runtime_speed.override_since === null || typeof data.runtime_speed.override_since === 'number',
    'runtime_speed.override_since must be number|null'
  );
  assert(isRecord(data.scheduler), 'status.scheduler must be object');
  assert(typeof data.scheduler.worker_id === 'string', 'status.scheduler.worker_id must be string');
  assert(typeof data.scheduler.partition_count === 'number', 'status.scheduler.partition_count must be number');
  assert(Array.isArray(data.scheduler.owned_partition_ids), 'status.scheduler.owned_partition_ids must be array');

  const rawWorldPack = data.world_pack;
  let worldPack: StatusWorldPack | null = null;
  if (rawWorldPack !== null) {
    assert(isRecord(rawWorldPack), 'status.world_pack must be object|null');
    assert(typeof rawWorldPack.id === 'string', 'status.world_pack.id must be string');
    assert(typeof rawWorldPack.name === 'string', 'status.world_pack.name must be string');
    assert(typeof rawWorldPack.version === 'string', 'status.world_pack.version must be string');
    worldPack = {
      id: rawWorldPack.id,
      name: rawWorldPack.name,
      version: rawWorldPack.version
    };
  }

  return {
    success: true,
    data: {
      status: data.status as StatusPayload['data']['status'],
      runtime_ready: data.runtime_ready === true,
      runtime_speed: {
        mode: 'fixed',
        source: data.runtime_speed.source as StatusPayload['data']['runtime_speed']['source'],
        configured_step_ticks:
          typeof data.runtime_speed.configured_step_ticks === 'string' ? data.runtime_speed.configured_step_ticks : null,
        override_step_ticks:
          typeof data.runtime_speed.override_step_ticks === 'string' ? data.runtime_speed.override_step_ticks : null,
        override_since:
          typeof data.runtime_speed.override_since === 'number' ? data.runtime_speed.override_since : null,
        effective_step_ticks: data.runtime_speed.effective_step_ticks
      },
      scheduler: {
        worker_id: data.scheduler.worker_id,
        partition_count: data.scheduler.partition_count,
        owned_partition_ids: data.scheduler.owned_partition_ids.filter((item: unknown) => typeof item === 'string')
      },
      health_level: data.health_level as StatusPayload['data']['health_level'],
      world_pack: worldPack,
      has_error: data.has_error === true,
      startup_errors: data.startup_errors.filter(item => typeof item === 'string')
    }
  };
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
    const health = asHealthPayload(healthRes.body);

    if (health.data.level === 'fail') {
      assert(healthRes.status === 503, 'health.level=fail should return 503');
    } else {
      assert(healthRes.status === 200, 'health.level ok/degraded should return 200');
    }

    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, `unexpected /api/status status: ${statusRes.status}`);
    const status = asStatusPayload(statusRes.body);

    assert(
      status.data.health_level === health.data.level,
      `status.health_level(${status.data.health_level}) should match health.level(${health.data.level})`
    );
    assert(status.data.scheduler.partition_count > 0, 'scheduler.partition_count should be positive');
    assert(Array.isArray(status.data.scheduler.owned_partition_ids), 'scheduler.owned_partition_ids should be array');

    if (health.data.level === 'ok') {
      assert(status.data.runtime_ready === true, 'runtime should be ready when level=ok');
      assert(status.data.world_pack !== null, 'world pack should be present when level=ok');
      assert(status.data.runtime_speed.source === 'world_pack', 'runtime speed source should be world_pack when level=ok');
      assert(status.data.runtime_speed.effective_step_ticks !== '0', 'runtime speed effective ticks should not be 0');
    }

    console.log('[smoke_startup] PASS');
    console.log(`[smoke_startup] level=${health.data.level} runtime_ready=${status.data.runtime_ready}`);
  } catch (error: unknown) {
    console.error('[smoke_startup] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const healthRes = await requestJson(server.baseUrl, '/api/health');
      console.error(summarizeResponse('/api/health', healthRes));
    } catch {
      console.error('failed to re-fetch /api/health while handling failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
