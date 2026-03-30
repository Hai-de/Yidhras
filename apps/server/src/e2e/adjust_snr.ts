import { PrismaClient } from '@prisma/client';

import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';
import { assertSuccessEnvelopeData } from './status_helpers.js';

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

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const pollReplayJob = async (
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const replayRes = await requestJson(baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    assert(replayRes.status === 200, `${label} should return 200 while polling`);
    const replayData = assertSuccessEnvelopeData(replayRes.body, label);
    lastData = replayData;
    if (predicate(replayData)) {
      return replayData;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const readAgentSnr = async (agentId: string): Promise<number | null> => {
  const prisma = new PrismaClient();

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { snr: true }
    });
    return agent?.snr ?? null;
  } finally {
    await prisma.$disconnect();
  }
};

const readLatestSnrLog = async (agentId: string): Promise<Record<string, unknown> | null> => {
  const prisma = new PrismaClient();

  try {
    const log = await prisma.sNRAdjustmentLog.findFirst({
      where: { agent_id: agentId },
      orderBy: { created_at: 'desc' }
    });
    return log
      ? ({
          ...log,
          created_at: log.created_at.toString()
        } as unknown as Record<string, unknown>)
      : null;
  } finally {
    await prisma.$disconnect();
  }
};

const prepareSnrFixtures = async (): Promise<void> => {
  const prisma = new PrismaClient();

  try {
    await prisma.sNRAdjustmentLog.deleteMany({
      where: {
        agent_id: {
          in: ['agent-001', 'agent-002']
        }
      }
    });

    await prisma.agent.update({
      where: { id: 'agent-001' },
      data: { snr: 0.5 }
    });

    await prisma.agent.update({
      where: { id: 'agent-002' },
      data: { snr: 0.5 }
    });
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  const port = parsePort();
  await prepareSnrFixtures();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'adjust_snr test requires runtime_ready=true');

    const activeHeaders = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const systemHeaders = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('system', 'system')
    };

    const baselineSnr = await readAgentSnr('agent-002');
    assert(baselineSnr === 0.5, 'initial SNR fixture should be 0.5');

    const setReason = `adjust_snr_set_${Date.now()}`;
    const setKey = `adjust-snr-set-${Date.now()}`;
    const setRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(setRes.status === 200, 'enqueue adjust_snr set should return 200');

    await pollReplayJob(
      server.baseUrl,
      activeHeaders,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: setKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'adjust_snr set replay poll'
    );

    const updatedSnr = await readAgentSnr('agent-002');
    assert(updatedSnr === 0.8, 'agent-002 snr should be updated to 0.8');

    const setLog = await readLatestSnrLog('agent-002');
    assert(isRecord(setLog), 'adjust_snr set log should exist');
    assert(setLog.requested_value === 0.8, 'adjust_snr set log requested_value should be 0.8');
    assert(setLog.baseline_value === 0.5, 'adjust_snr set log baseline_value should be 0.5');
    assert(setLog.resolved_value === 0.8, 'adjust_snr set log resolved_value should be 0.8');
    assert(setLog.reason === setReason, 'adjust_snr set log reason should match');

    const clampHighReason = `adjust_snr_high_${Date.now()}`;
    const clampHighKey = `adjust-snr-high-${Date.now()}`;
    const clampHighRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
          snr_reason: clampHighReason
        }
      })
    });
    assert(clampHighRes.status === 200, 'enqueue adjust_snr high clamp should return 200');

    await pollReplayJob(
      server.baseUrl,
      activeHeaders,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: clampHighKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'adjust_snr high clamp replay poll'
    );

    const clampedHighSnr = await readAgentSnr('agent-002');
    assert(clampedHighSnr === 1, 'agent-002 snr should clamp to 1');

    const clampHighLog = await readLatestSnrLog('agent-002');
    assert(isRecord(clampHighLog), 'adjust_snr high clamp log should exist');
    assert(clampHighLog.requested_value === 1, 'adjust_snr high clamp log requested_value should currently reflect clamped input');
    assert(clampHighLog.resolved_value === 1, 'adjust_snr high clamp log resolved_value should be 1');

    const clampLowReason = `adjust_snr_low_${Date.now()}`;
    const clampLowKey = `adjust-snr-low-${Date.now()}`;
    const clampLowRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
          snr_reason: clampLowReason
        }
      })
    });
    assert(clampLowRes.status === 200, 'enqueue adjust_snr low clamp should return 200');

    await pollReplayJob(
      server.baseUrl,
      activeHeaders,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: clampLowKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'adjust_snr low clamp replay poll'
    );

    const clampedLowSnr = await readAgentSnr('agent-002');
    assert(clampedLowSnr === 0, 'agent-002 snr should clamp to 0');

    const clampLowLog = await readLatestSnrLog('agent-002');
    assert(isRecord(clampLowLog), 'adjust_snr low clamp log should exist');
    assert(clampLowLog.requested_value === 0, 'adjust_snr low clamp log requested_value should currently reflect clamped input');
    assert(clampLowLog.resolved_value === 0, 'adjust_snr low clamp log resolved_value should be 0');

    const invalidOperationKey = `adjust-snr-invalid-op-${Date.now()}`;
    const invalidOperationRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(invalidOperationRes.status === 200, 'invalid adjust_snr operation should still enqueue');

    const invalidOperationReplay = await pollReplayJob(
      server.baseUrl,
      activeHeaders,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: invalidOperationKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
      'adjust_snr invalid operation replay poll'
    );
    assert(isRecord(invalidOperationReplay.workflow_snapshot), 'invalid adjust_snr operation workflow snapshot should be object');
    assert(
      isRecord(invalidOperationReplay.workflow_snapshot.derived) &&
        invalidOperationReplay.workflow_snapshot.derived.failure_stage === 'dispatch',
      'invalid adjust_snr operation should surface as dispatch failure'
    );

    const systemActorKey = `adjust-snr-system-${Date.now()}`;
    const systemActorRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(systemActorRes.status === 200, 'system adjust_snr should still enqueue');

    const systemActorReplay = await pollReplayJob(
      server.baseUrl,
      systemHeaders,
      { identity_id: 'system', strategy: 'mock', idempotency_key: systemActorKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
      'system adjust_snr replay poll'
    );
    assert(
      isRecord(systemActorReplay.workflow_snapshot) &&
        isRecord(systemActorReplay.workflow_snapshot.derived) &&
        systemActorReplay.workflow_snapshot.derived.failure_stage === 'dispatch',
      'system adjust_snr should be rejected at dispatch stage'
    );

    console.log('[adjust_snr] PASS');
  } catch (error: unknown) {
    console.error('[adjust_snr] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling adjust_snr failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
