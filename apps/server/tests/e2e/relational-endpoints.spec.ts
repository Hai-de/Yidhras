import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  assertErrorEnvelope,
  assertSuccessEnvelopeArrayData,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, withTestServer } from '../helpers/server.js';

const ensureRelationalFixtures = async (prisma: ReturnType<typeof createPrismaClientForEnvironment>) => {
  const now = BigInt(Date.now());
  const relationshipId = 'rel-e2e-agent-001-agent-002-friend';
  const traceId = 'relational-endpoints-trace-001';
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
    where: { id: traceId },
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
      id: traceId,
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
      source_inference_id: traceId,
      intent_type: 'adjust_relationship',
      actor_ref: {},
      target_ref: Prisma.JsonNull,
      payload: {},
      status: 'completed',
      scheduled_after_ticks: 0n,
      scheduled_for_tick: now,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      created_at: now,
      updated_at: now
    },
    create: {
      id: actionIntentId,
      source_inference_id: traceId,
      intent_type: 'adjust_relationship',
      actor_ref: {},
      target_ref: Prisma.JsonNull,
      payload: {},
      status: 'completed',
      scheduled_after_ticks: 0n,
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

describe('relational endpoints e2e', () => {
  it('serves atmosphere and relationship log queries with validation errors', async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);
      await ensureRelationalFixtures(prisma);

      await withTestServer(
        {
          defaultPort: 3107,
          envOverrides: environment.envOverrides,
          prepareRuntime: false
        },
        async server => {
          const atmosphereResponse = await requestJson(server.baseUrl, '/api/atmosphere/nodes?owner_id=agent-001');
          expect(atmosphereResponse.status).toBe(200);
          const atmosphereNodes = assertSuccessEnvelopeArrayData(atmosphereResponse.body, 'atmosphere nodes response');
          expect(atmosphereNodes.every(item => item.owner_id === 'agent-001')).toBe(true);

          const invalidAtmosphereResponse = await requestJson(
            server.baseUrl,
            '/api/atmosphere/nodes?include_expired=maybe'
          );
          expect(invalidAtmosphereResponse.status).toBe(400);
          assertErrorEnvelope(
            invalidAtmosphereResponse.body,
            'RELATIONAL_QUERY_INVALID',
            'invalid atmosphere include_expired'
          );

          const relationshipLogsResponse = await requestJson(
            server.baseUrl,
            '/api/relationships/agent-001/agent-002/friend/logs?limit=5'
          );
          expect(relationshipLogsResponse.status).toBe(200);
          const relationshipLogs = assertSuccessEnvelopeArrayData(
            relationshipLogsResponse.body,
            'relationship logs response'
          );
          expect(relationshipLogs.every(item => isRecord(item))).toBe(true);

          const invalidRelationshipLimitResponse = await requestJson(
            server.baseUrl,
            '/api/relationships/agent-001/agent-002/friend/logs?limit=abc'
          );
          expect(invalidRelationshipLimitResponse.status).toBe(400);
          assertErrorEnvelope(
            invalidRelationshipLimitResponse.body,
            'RELATIONSHIP_LOG_QUERY_INVALID',
            'invalid relationship log limit'
          );

          const blankRelationshipParamResponse = await requestJson(
            server.baseUrl,
            '/api/relationships/%20%20/agent-002/friend/logs'
          );
          expect(blankRelationshipParamResponse.status).toBe(400);
          assertErrorEnvelope(
            blankRelationshipParamResponse.body,
            'RELATIONSHIP_LOG_QUERY_INVALID',
            'blank relationship params'
          );

          const relationalGraphResponse = await requestJson(server.baseUrl, '/api/relational/graph');
          expect(relationalGraphResponse.status).toBe(200);
          const relationalGraph = assertSuccessEnvelopeData(
            relationalGraphResponse.body,
            'relational graph response'
          );
          expect(Array.isArray(relationalGraph.nodes)).toBe(true);
          expect(Array.isArray(relationalGraph.edges)).toBe(true);

          const relationalCirclesResponse = await requestJson(server.baseUrl, '/api/relational/circles');
          expect(relationalCirclesResponse.status).toBe(200);
          assertSuccessEnvelopeArrayData(relationalCirclesResponse.body, 'relational circles response');
        }
      );
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
