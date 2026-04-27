import { describe, expect, it } from 'vitest';

import { getRootAuthHeadersWithIdentity } from '../helpers/auth.js';
import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, sleep, withTestServer } from '../helpers/server.js';



const pollReplayJob = async (
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const replayResponse = await requestJson(baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    expect(replayResponse.status).toBe(200);
    const replayData = assertSuccessEnvelopeData(replayResponse.body, label);
    lastData = replayData;
    if (predicate(replayData)) {
      return replayData;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const readRelationshipWeight = async (
  prisma: ReturnType<typeof createPrismaClientForEnvironment>,
  sourceId: string,
  targetId: string,
  type: string
): Promise<number | null> => {
  const relationship = await prisma.relationship.findUnique({
    where: {
      from_id_to_id_type: {
        from_id: sourceId,
        to_id: targetId,
        type
      }
    },
    select: {
      weight: true
    }
  });

  return relationship?.weight ?? null;
};

const readLatestRelationshipLog = async (
  prisma: ReturnType<typeof createPrismaClientForEnvironment>,
  sourceId: string,
  targetId: string,
  type: string
) => {
  return prisma.relationshipAdjustmentLog.findFirst({
    where: {
      from_id: sourceId,
      to_id: targetId,
      type
    },
    orderBy: {
      created_at: 'desc'
    }
  });
};

const waitForRelationshipWeight = async (
  prisma: ReturnType<typeof createPrismaClientForEnvironment>,
  sourceId: string,
  targetId: string,
  type: string,
  expectedWeight: number,
  label: string
): Promise<void> => {
  let lastWeight: number | null = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    lastWeight = await readRelationshipWeight(prisma, sourceId, targetId, type);
    if (lastWeight === expectedWeight) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`${label} did not reach expected relationship weight ${String(expectedWeight)}; lastWeight=${String(lastWeight)}`);
};

const prepareRelationshipFixtures = async (prisma: ReturnType<typeof createPrismaClientForEnvironment>): Promise<void> => {
  const now = BigInt(Date.now());

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
  await prisma.agent.upsert({
    where: { id: 'agent-003' },
    update: { name: 'Agent-003', type: 'active', snr: 0.5, updated_at: now },
    create: {
      id: 'agent-003',
      name: 'Agent-003',
      type: 'active',
      snr: 0.5,
      is_pinned: false,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.relationshipAdjustmentLog.deleteMany({
    where: {
      OR: [
        { from_id: 'agent-001', to_id: 'agent-002', type: 'friend' },
        { from_id: 'agent-002', to_id: 'agent-001', type: 'friend' },
        { from_id: 'agent-001', to_id: 'agent-003', type: 'enemy' },
        { from_id: 'agent-003', to_id: 'agent-001', type: 'enemy' }
      ]
    }
  });

  await prisma.relationship.deleteMany({
    where: {
      OR: [
        { from_id: 'agent-001', to_id: 'agent-002', type: 'friend' },
        { from_id: 'agent-002', to_id: 'agent-001', type: 'friend' },
        { from_id: 'agent-001', to_id: 'agent-003', type: 'enemy' },
        { from_id: 'agent-003', to_id: 'agent-001', type: 'enemy' }
      ]
    }
  });

  await prisma.relationship.create({
    data: {
      from_id: 'agent-001',
      to_id: 'agent-002',
      type: 'friend',
      weight: 0.2,
      created_at: 0n,
      updated_at: 0n
    }
  });
};

describe('adjust relationship e2e', () => {
  it('updates, creates and rejects relationship mutations through workflow replay', async () => {
    const environment = await createIsolatedRuntimeEnvironment();

    try {
      await prepareIsolatedRuntime(environment);
      const prisma = createPrismaClientForEnvironment(environment);

      try {
        await prepareRelationshipFixtures(prisma);

        await withTestServer(
          {
            defaultPort: 3108,
            envOverrides: environment.envOverrides,
            prepareRuntime: false
          },
          async server => {
            const statusResponse = await requestJson(server.baseUrl, '/api/status');
            expect(statusResponse.status).toBe(200);
            const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
            expect(statusData.runtime_ready).toBe(true);

            const headers = {
              'Content-Type': 'application/json',
              ...(await getRootAuthHeadersWithIdentity(server.baseUrl, 'agent-001', 'agent'))
            };

            const initialFriendWeight = await readRelationshipWeight(prisma, 'agent-001', 'agent-002', 'friend');
            expect(initialFriendWeight).toBe(0.2);

            const updateExistingKey = `adjust-relationship-existing-${Date.now()}`;
            const updateExistingResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: updateExistingKey,
                attributes: {
                  mock_action_type: 'adjust_relationship',
                  target_agent_id: 'agent-002',
                  relationship_type: 'friend',
                  relationship_operation: 'set',
                  relationship_weight: 0.85,
                  relationship_reason: 'set existing relationship'
                }
              })
            });
            expect(updateExistingResponse.status).toBe(200);
            const updateExistingData = assertSuccessEnvelopeData(updateExistingResponse.body, 'adjust relationship enqueue');
            expect(assertRecord(updateExistingData.job, 'adjust relationship enqueue job')).toBeTruthy();

            const completedExistingReplay = await pollReplayJob(
              server.baseUrl,
              headers,
              {
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: updateExistingKey
              },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                (data.workflow_snapshot.derived.workflow_state === 'workflow_completed' ||
                  data.workflow_snapshot.derived.workflow_state === 'dispatching' ||
                  data.workflow_snapshot.derived.workflow_state === 'dispatch_pending'),
              'adjust relationship replay poll'
            );
            expect(completedExistingReplay.result_source).toBe('stored_trace');
            await waitForRelationshipWeight(prisma, 'agent-001', 'agent-002', 'friend', 0.85, 'adjust existing relationship');

            const updatedFriendWeight = await readRelationshipWeight(prisma, 'agent-001', 'agent-002', 'friend');
            expect(updatedFriendWeight).toBe(0.85);

            const existingLog = await readLatestRelationshipLog(prisma, 'agent-001', 'agent-002', 'friend');
            expect(existingLog).not.toBeNull();
            expect(existingLog?.new_weight).toBe(0.85);

            const createMissingKey = `adjust-relationship-create-${Date.now()}`;
            const createMissingResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: createMissingKey,
                attributes: {
                  mock_action_type: 'adjust_relationship',
                  target_agent_id: 'agent-003',
                  relationship_type: 'enemy',
                  relationship_operation: 'set',
                  relationship_weight: 0.4,
                  create_if_missing: true,
                  relationship_reason: 'create missing relationship'
                }
              })
            });
            expect(createMissingResponse.status).toBe(200);

            await pollReplayJob(
              server.baseUrl,
              headers,
              {
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: createMissingKey
              },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                (data.workflow_snapshot.derived.workflow_state === 'workflow_completed' ||
                  data.workflow_snapshot.derived.workflow_state === 'dispatching' ||
                  data.workflow_snapshot.derived.workflow_state === 'dispatch_pending'),
              'create missing relationship replay poll'
            );
            await waitForRelationshipWeight(prisma, 'agent-001', 'agent-003', 'enemy', 0.4, 'create missing relationship');

            const createdEnemyWeight = await readRelationshipWeight(prisma, 'agent-001', 'agent-003', 'enemy');
            expect(createdEnemyWeight).toBe(0.4);

            const createdLog = await readLatestRelationshipLog(prisma, 'agent-001', 'agent-003', 'enemy');
            expect(createdLog).not.toBeNull();
            expect(createdLog?.old_weight).toBeNull();
            expect(createdLog?.new_weight).toBe(0.4);

            const invalidOperationKey = `adjust-relationship-invalid-op-${Date.now()}`;
            const invalidOperationResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: invalidOperationKey,
                attributes: {
                  mock_action_type: 'adjust_relationship',
                  target_agent_id: 'agent-002',
                  relationship_type: 'friend',
                  relationship_operation: 'increment',
                  relationship_weight: 0.1
                }
              })
            });
            expect(invalidOperationResponse.status).toBe(200);

            const invalidOperationReplay = await pollReplayJob(
              server.baseUrl,
              headers,
              {
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: invalidOperationKey
              },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
              'invalid relationship operation replay poll'
            );
            const invalidOperationDerived = assertRecord(
              assertRecord(invalidOperationReplay.workflow_snapshot, 'invalid relationship workflow snapshot').derived,
              'invalid relationship workflow derived'
            );
            expect(invalidOperationDerived.failure_stage).toBe('dispatch');
          }
        );
      } finally {
        await prisma.$disconnect();
      }
    } finally {
      await environment.cleanup();
    }
  });
});
