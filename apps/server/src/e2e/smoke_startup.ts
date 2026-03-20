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
  success: boolean;
  level: 'ok' | 'degraded' | 'fail';
  runtime_ready: boolean;
  checks: HealthChecks;
  available_world_packs: string[];
  errors: string[];
}

interface StatusWorldPack {
  id: string;
  name: string;
  version: string;
}

interface StatusPayload {
  status: 'running' | 'paused';
  runtime_ready: boolean;
  health_level: 'ok' | 'degraded' | 'fail';
  world_pack: StatusWorldPack | null;
  has_error: boolean;
  startup_errors: string[];
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

  const checksValue = value.checks;
  assert(isRecord(checksValue), 'health.checks must be object');

  const checks: HealthChecks = {
    db: checksValue.db === true,
    world_pack_dir: checksValue.world_pack_dir === true,
    world_pack_available: checksValue.world_pack_available === true
  };

  assert(
    typeof value.level === 'string' && ['ok', 'degraded', 'fail'].includes(value.level),
    'health.level must be ok|degraded|fail'
  );
  assert(Array.isArray(value.available_world_packs), 'health.available_world_packs must be array');
  assert(Array.isArray(value.errors), 'health.errors must be array');

  return {
    success: value.success === true,
    level: value.level as HealthPayload['level'],
    runtime_ready: value.runtime_ready === true,
    checks,
    available_world_packs: value.available_world_packs.filter(item => typeof item === 'string'),
    errors: value.errors.filter(item => typeof item === 'string')
  };
};

const asStatusPayload = (value: unknown): StatusPayload => {
  assert(isRecord(value), 'status response must be object');
  assert(
    typeof value.status === 'string' && ['running', 'paused'].includes(value.status),
    'status.status must be running|paused'
  );
  assert(
    typeof value.health_level === 'string' && ['ok', 'degraded', 'fail'].includes(value.health_level),
    'status.health_level must be ok|degraded|fail'
  );
  assert(Array.isArray(value.startup_errors), 'status.startup_errors must be array');

  const rawWorldPack = value.world_pack;
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
    status: value.status as StatusPayload['status'],
    runtime_ready: value.runtime_ready === true,
    health_level: value.health_level as StatusPayload['health_level'],
    world_pack: worldPack,
    has_error: value.has_error === true,
    startup_errors: value.startup_errors.filter(item => typeof item === 'string')
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

    if (health.level === 'fail') {
      assert(healthRes.status === 503, 'health.level=fail should return 503');
    } else {
      assert(healthRes.status === 200, 'health.level ok/degraded should return 200');
    }

    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, `unexpected /api/status status: ${statusRes.status}`);
    const status = asStatusPayload(statusRes.body);

    assert(
      status.health_level === health.level,
      `status.health_level(${status.health_level}) should match health.level(${health.level})`
    );

    if (health.level === 'ok') {
      assert(status.runtime_ready === true, 'runtime should be ready when level=ok');
      assert(status.world_pack !== null, 'world pack should be present when level=ok');
    }

    console.log('[smoke_startup] PASS');
    console.log(`[smoke_startup] level=${health.level} runtime_ready=${status.runtime_ready}`);
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
