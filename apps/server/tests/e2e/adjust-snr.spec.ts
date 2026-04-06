import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, sleep, withTestServer } from '../helpers/server.js';

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

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

const readAgentSnr = async (
  prisma: ReturnType<typeof createPrismaClientForEnvironment>,
  agentId: string
): Promise<number | null> => {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { snr: true }
  });
  return agent?.snr ?? null;
};

const readLatestSnrLog = async (prisma: ReturnType<typeof createPrismaClientForEnvironment>, agentId: string) => {
  return prisma.sNRAdjustmentLog.findFirst({
    where: { agent_id: agentId },
    orderBy: { created_at: 'desc' }
  });
};

const prepareSnrFixtures = async (prisma: ReturnType<typeof createPrismaClientForEnvironment>): Promise<void> => {
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

  await prisma.sNRAdjustmentLog.deleteMany({
    where: {
      agent_id: {
        in: ['agent-001', 'agent-002']
      }
    }
  });

  await prisma.agent.update({
    where: { id: 'agent-001' },
    data: { snr: 0.5, updated_at: now }
  });

  await prisma.agent.update({
    where: { id: 'agent-002' },
    data: { snr: 0.5, updated_at: now }
  });
};

describe('adjust snr e2e', () => {
  it('updates, clamps and rejects SNR mutations through workflow replay', async () => {
    const environment = await createIsolatedRuntimeEnvironment();

    try {
      await prepareIsolatedRuntime(environment);
      const prisma = createPrismaClientForEnvironment(environment);

      try {
        await prepareSnrFixtures(prisma);

        await withTestServer(
          {
            defaultPort: 3109,
            envOverrides: environment.envOverrides,
            prepareRuntime: false
          },
          async server => {
            const statusResponse = await requestJson(server.baseUrl, '/api/status');
            expect(statusResponse.status).toBe(200);
            const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
            expect(statusData.runtime_ready).toBe(true);

            const activeHeaders = {
              'Content-Type': 'application/json',
              'x-m2-identity': createIdentityHeader('agent-001', 'agent')
            };

            const systemHeaders = {
              'Content-Type': 'application/json',
              'x-m2-identity': createIdentityHeader('system', 'system')
            };

            const baselineSnr = await readAgentSnr(prisma, 'agent-002');
            expect(baselineSnr).toBe(0.5);

            const setReason = `adjust_snr_set_${Date.now()}`;
            const setKey = `adjust-snr-set-${Date.now()}`;
            const setResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers: activeHeaders,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: setKey,
                attributes: {
                  mock_action_type: 'adjust_snr',
                  target_agent_id: 'agent-002',
                  snr_operation: 'set',
                  target_snr: 0.8,
                  snr_reason: setReason
                }
              })
            });
            expect(setResponse.status).toBe(200);

            await pollReplayJob(
              server.baseUrl,
              activeHeaders,
              { agent_id: 'agent-001', strategy: 'mock', idempotency_key: setKey },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
              'adjust_snr set replay poll'
            );

            const updatedSnr = await readAgentSnr(prisma, 'agent-002');
            expect(updatedSnr).toBe(0.8);

            const setLog = await readLatestSnrLog(prisma, 'agent-002');
            expect(setLog).not.toBeNull();
            expect(setLog?.requested_value).toBe(0.8);
            expect(setLog?.baseline_value).toBe(0.5);
            expect(setLog?.resolved_value).toBe(0.8);
            expect(setLog?.reason).toBe(setReason);

            const clampHighKey = `adjust-snr-high-${Date.now()}`;
            const clampHighResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers: activeHeaders,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: clampHighKey,
                attributes: {
                  mock_action_type: 'adjust_snr',
                  target_agent_id: 'agent-002',
                  snr_operation: 'set',
                  target_snr: 2,
                  snr_reason: `adjust_snr_high_${Date.now()}`
                }
              })
            });
            expect(clampHighResponse.status).toBe(200);

            await pollReplayJob(
              server.baseUrl,
              activeHeaders,
              { agent_id: 'agent-001', strategy: 'mock', idempotency_key: clampHighKey },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
              'adjust_snr high clamp replay poll'
            );

            const clampedHighSnr = await readAgentSnr(prisma, 'agent-002');
            expect(clampedHighSnr).toBe(1);

            const clampHighLog = await readLatestSnrLog(prisma, 'agent-002');
            expect(clampHighLog).not.toBeNull();
            expect(clampHighLog?.requested_value).toBe(1);
            expect(clampHighLog?.resolved_value).toBe(1);

            const clampLowKey = `adjust-snr-low-${Date.now()}`;
            const clampLowResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers: activeHeaders,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: clampLowKey,
                attributes: {
                  mock_action_type: 'adjust_snr',
                  target_agent_id: 'agent-002',
                  snr_operation: 'set',
                  target_snr: -2,
                  snr_reason: `adjust_snr_low_${Date.now()}`
                }
              })
            });
            expect(clampLowResponse.status).toBe(200);

            await pollReplayJob(
              server.baseUrl,
              activeHeaders,
              { agent_id: 'agent-001', strategy: 'mock', idempotency_key: clampLowKey },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
              'adjust_snr low clamp replay poll'
            );

            const clampedLowSnr = await readAgentSnr(prisma, 'agent-002');
            expect(clampedLowSnr).toBe(0);

            const clampLowLog = await readLatestSnrLog(prisma, 'agent-002');
            expect(clampLowLog).not.toBeNull();
            expect(clampLowLog?.requested_value).toBe(0);
            expect(clampLowLog?.resolved_value).toBe(0);

            const invalidOperationKey = `adjust-snr-invalid-op-${Date.now()}`;
            const invalidOperationResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers: activeHeaders,
              body: JSON.stringify({
                agent_id: 'agent-001',
                strategy: 'mock',
                idempotency_key: invalidOperationKey,
                attributes: {
                  mock_action_type: 'adjust_snr',
                  target_agent_id: 'agent-002',
                  snr_operation: 'increment',
                  target_snr: 0.1
                }
              })
            });
            expect(invalidOperationResponse.status).toBe(200);

            const invalidOperationReplay = await pollReplayJob(
              server.baseUrl,
              activeHeaders,
              { agent_id: 'agent-001', strategy: 'mock', idempotency_key: invalidOperationKey },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
              'adjust_snr invalid operation replay poll'
            );
            const invalidOperationDerived = assertRecord(
              assertRecord(invalidOperationReplay.workflow_snapshot, 'invalid adjust_snr workflow snapshot').derived,
              'invalid adjust_snr workflow derived'
            );
            expect(invalidOperationDerived.failure_stage).toBe('dispatch');

            const systemActorKey = `adjust-snr-system-${Date.now()}`;
            const systemActorResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
              method: 'POST',
              headers: systemHeaders,
              body: JSON.stringify({
                identity_id: 'system',
                strategy: 'mock',
                idempotency_key: systemActorKey,
                attributes: {
                  mock_action_type: 'adjust_snr',
                  target_agent_id: 'agent-002',
                  snr_operation: 'set',
                  target_snr: 0.6
                }
              })
            });
            expect(systemActorResponse.status).toBe(200);

            const systemActorReplay = await pollReplayJob(
              server.baseUrl,
              systemHeaders,
              { identity_id: 'system', strategy: 'mock', idempotency_key: systemActorKey },
              data =>
                isRecord(data.workflow_snapshot) &&
                isRecord(data.workflow_snapshot.derived) &&
                data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
              'system adjust_snr replay poll'
            );
            const systemActorDerived = assertRecord(
              assertRecord(systemActorReplay.workflow_snapshot, 'system adjust_snr workflow snapshot').derived,
              'system adjust_snr workflow derived'
            );
            expect(systemActorDerived.failure_stage).toBe('dispatch');
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
