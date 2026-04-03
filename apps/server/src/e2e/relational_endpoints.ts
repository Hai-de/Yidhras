import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';

const prisma = new PrismaClient();

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

const assertErrorCode = (body: unknown, expectedCode: string, label: string): void => {
  assert(isRecord(body), `${label} should return object`);
  assert(body.success === false, `${label} success should be false`);
  assert(isRecord(body.error), `${label} error should be object`);
  assert(body.error.code === expectedCode, `${label} error code should be ${expectedCode}`);
};

const ensureRelationalFixtures = async () => {
  const now = BigInt(Date.now());
  const relationshipId = 'rel-e2e-agent-001-agent-002-friend';
  const actionIntentId = 'intent-relational-e2e';

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
    update: { name: 'Agent-002', type: 'active', snr: 0.5, updated_at: now },
    create: {
      id: 'agent-002',
      name: 'Agent-002',
      type: 'active',
      snr: 0.5,
      is_pinned: false,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.atmosphereNode.upsert({
    where: { id: 'atm-e2e-agent-001' },
    update: {
      owner_id: 'agent-001',
      name: 'Agent-001 Atmosphere',
      expires_at: null
    },
    create: {
      id: 'atm-e2e-agent-001',
      owner_id: 'agent-001',
      name: 'Agent-001 Atmosphere',
      expires_at: null,
      created_at: now
    }
  });

  await prisma.relationship.upsert({
    where: { from_id_to_id_type: { from_id: 'agent-001', to_id: 'agent-002', type: 'friend' } },
    update: {
      id: relationshipId,
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'friend',
      weight: 0.7,
      updated_at: now
    },
    create: {
      id: relationshipId,
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'friend',
      weight: 0.7,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.inferenceTrace.upsert({
    where: { id: actionIntentId },
    update: {
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: {},
      input: {},
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: now.toString() },
      decision: {},
      updated_at: now
    },
    create: {
      id: actionIntentId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: {},
      input: {},
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { tick: now.toString() },
      decision: {},
      created_at: now,
      updated_at: now
    }
  });

  await prisma.actionIntent.upsert({
    where: { id: actionIntentId },
    update: {
      source_inference_id: actionIntentId,
      intent_type: 'adjust_relationship',
      actor_ref: {},
      target_ref: {},
      payload: {},
      status: 'completed',
      scheduled_after_ticks: 0,
      scheduled_for_tick: now,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      created_at: now,
      updated_at: now
    },
    create: {
      id: actionIntentId,
      source_inference_id: actionIntentId,
      intent_type: 'adjust_relationship',
      actor_ref: {},
      target_ref: {},
      payload: {},
      status: 'completed',
      scheduled_after_ticks: 0,
      scheduled_for_tick: now,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.relationshipAdjustmentLog.create({
    data: {
      id: `rel-log-${Date.now()}`,
      action_intent_id: actionIntentId,
      relationship_id: relationshipId,
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'friend',
      operation: 'set',
      old_weight: 0.6,
      new_weight: 0.7,
      reason: 'relational-endpoints-e2e',
      created_at: now
    }
  });
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    await ensureRelationalFixtures();

    const atmosphereRes = await requestJson(server.baseUrl, '/api/atmosphere/nodes?owner_id=agent-001');
    assert(atmosphereRes.status === 200, 'GET /api/atmosphere/nodes should return 200');
    assert(isRecord(atmosphereRes.body), 'atmosphere response should be object');
    assert(atmosphereRes.body.success === true, 'atmosphere response success should be true');
    assert(Array.isArray(atmosphereRes.body.data), 'atmosphere response data should be array');
    assert(
      atmosphereRes.body.data.every((item: unknown) => isRecord(item) && item.owner_id === 'agent-001'),
      'atmosphere nodes owner filter should only include requested owner'
    );

    const invalidAtmosphereIncludeExpiredRes = await requestJson(server.baseUrl, '/api/atmosphere/nodes?include_expired=maybe');
    assert(invalidAtmosphereIncludeExpiredRes.status === 400, 'invalid atmosphere include_expired should return 400');
    assertErrorCode(invalidAtmosphereIncludeExpiredRes.body, 'RELATIONAL_QUERY_INVALID', 'invalid atmosphere include_expired');

    const relationshipLogsRes = await requestJson(server.baseUrl, '/api/relationships/agent-001/agent-002/friend/logs?limit=5');
    assert(relationshipLogsRes.status === 200, 'GET /api/relationships/:from_id/:to_id/:type/logs should return 200');
    assert(isRecord(relationshipLogsRes.body), 'relationship logs response should be object');
    assert(relationshipLogsRes.body.success === true, 'relationship logs response success should be true');
    assert(Array.isArray(relationshipLogsRes.body.data), 'relationship logs response data should be array');

    const invalidRelationshipLimitRes = await requestJson(server.baseUrl, '/api/relationships/agent-001/agent-002/friend/logs?limit=abc');
    assert(invalidRelationshipLimitRes.status === 400, 'invalid relationship logs limit should return 400');
    assertErrorCode(invalidRelationshipLimitRes.body, 'RELATIONSHIP_LOG_QUERY_INVALID', 'invalid relationship logs limit');

    const blankRelationshipParamRes = await requestJson(server.baseUrl, '/api/relationships/%20%20/agent-002/friend/logs');
    assert(blankRelationshipParamRes.status === 400, 'blank relationship logs params should return 400');
    assertErrorCode(blankRelationshipParamRes.body, 'RELATIONSHIP_LOG_QUERY_INVALID', 'blank relationship logs params');

    console.log('[relational_endpoints] PASS');
  } catch (error: unknown) {
    console.error('[relational_endpoints] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling relational_endpoints failure');
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
