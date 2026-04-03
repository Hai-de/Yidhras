import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';
import { assertSuccessEnvelopeData } from './status_helpers.js';

const prisma = new PrismaClient();

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

const assertErrorCode = (body: unknown, expectedCode: string, label: string): void => {
  assert(isRecord(body), `${label} should return an error envelope object`);
  assert(body.success === false, `${label} success should be false`);
  assert(isRecord(body.error), `${label} error should be object`);
  assert(body.error.code === expectedCode, `${label} error code should be ${expectedCode}`);
};

const ensureAgentFixture = async () => {
  const now = BigInt(Date.now());
  await prisma.agent.upsert({
    where: { id: 'agent-001' },
    update: {
      name: 'Agent-001',
      type: 'active',
      snr: 0.5,
      updated_at: now
    },
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
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    await ensureAgentFixture();

    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'agent overview test requires runtime_ready=true');

    const overviewRes = await requestJson(server.baseUrl, '/api/agent/agent-001/overview?limit=5');
    assert(overviewRes.status === 200, 'GET /api/agent/:id/overview should return 200');
    const overview = assertSuccessEnvelopeData(overviewRes.body, 'agent overview response');

    assert(isRecord(overview.profile), 'agent overview profile should be object');
    assert(overview.profile.id === 'agent-001', 'agent overview profile.id should match');
    assert(typeof overview.profile.name === 'string', 'agent overview profile.name should be string');

    assert(isRecord(overview.binding_summary), 'agent overview binding_summary should be object');
    assert(Array.isArray(overview.binding_summary.active), 'agent overview binding_summary.active should be array');
    assert(Array.isArray(overview.binding_summary.atmosphere), 'agent overview binding_summary.atmosphere should be array');
    assert(isRecord(overview.binding_summary.counts), 'agent overview binding_summary.counts should be object');

    assert(isRecord(overview.relationship_summary), 'agent overview relationship_summary should be object');
    assert(Array.isArray(overview.relationship_summary.incoming), 'agent overview relationship_summary.incoming should be array');
    assert(Array.isArray(overview.relationship_summary.outgoing), 'agent overview relationship_summary.outgoing should be array');
    assert(isRecord(overview.relationship_summary.counts), 'agent overview relationship_summary.counts should be object');

    assert(Array.isArray(overview.recent_activity), 'agent overview recent_activity should be array');
    assert(Array.isArray(overview.recent_posts), 'agent overview recent_posts should be array');
    assert(Array.isArray(overview.recent_workflows), 'agent overview recent_workflows should be array');
    assert(Array.isArray(overview.recent_events), 'agent overview recent_events should be array');
    assert(Array.isArray(overview.recent_inference_results), 'agent overview recent_inference_results should be array');

    assert(isRecord(overview.snr), 'agent overview snr should be object');
    assert(typeof overview.snr.current === 'number', 'agent overview snr.current should be number');
    assert(Array.isArray(overview.snr.recent_logs), 'agent overview snr.recent_logs should be array');

    assert(isRecord(overview.memory), 'agent overview memory should be object');
    assert(isRecord(overview.memory.summary), 'agent overview memory.summary should be object');
    assert(typeof overview.memory.summary.recent_trace_count === 'number', 'agent overview memory.summary.recent_trace_count should be number');

    const invalidOverviewLimitRes = await requestJson(server.baseUrl, '/api/agent/agent-001/overview?limit=abc');
    assert(invalidOverviewLimitRes.status === 400, 'GET /api/agent/:id/overview with invalid limit should return 400');
    assertErrorCode(invalidOverviewLimitRes.body, 'AGENT_QUERY_INVALID', 'invalid agent overview limit');

    const invalidSchedulerLimitRes = await requestJson(server.baseUrl, '/api/agent/agent-001/scheduler/projection?limit=abc');
    assert(invalidSchedulerLimitRes.status === 400, 'GET /api/agent/:id/scheduler/projection with invalid limit should return 400');
    assertErrorCode(invalidSchedulerLimitRes.body, 'AGENT_QUERY_INVALID', 'invalid agent scheduler projection limit');

    const invalidSnrLimitRes = await requestJson(server.baseUrl, '/api/agent/agent-001/snr/logs?limit=abc');
    assert(invalidSnrLimitRes.status === 400, 'GET /api/agent/:id/snr/logs with invalid limit should return 400');
    assertErrorCode(invalidSnrLimitRes.body, 'SNR_LOG_QUERY_INVALID', 'invalid agent snr logs limit');

    const notFoundRes = await requestJson(server.baseUrl, '/api/agent/missing-agent/overview');
    assert(notFoundRes.status === 404, 'GET /api/agent/:id/overview for missing agent should return 404');
    assert(isRecord(notFoundRes.body), 'missing agent overview should return error envelope');
    assert(notFoundRes.body.success === false, 'missing agent overview success should be false');

    console.log('[agent_overview] PASS');
  } catch (error: unknown) {
    console.error('[agent_overview] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling agent_overview failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
    await prisma.$disconnect();
  }
};

void main();
