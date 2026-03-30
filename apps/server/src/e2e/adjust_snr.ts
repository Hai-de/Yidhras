import { PrismaClient } from '@prisma/client';

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
    return 3105;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }

  return port;
};

const assertSuccessEnvelope = (body: unknown): Record<string, unknown> => {
  assert(isRecord(body), 'success response should be object');
  assert(body.success === true, 'success response success should be true');
  assert(isRecord(body.data), 'success response data should be object');
  return body.data as Record<string, unknown>;
};

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const pollWorkflowState = async (
  baseUrl: string,
  jobId: string,
  predicate: (workflow: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const workflowRes = await requestJson(baseUrl, `/api/inference/jobs/${jobId}/workflow`);
    assert(workflowRes.status === 200, 'GET workflow should return 200 while polling');
    const data = assertSuccessEnvelope(workflowRes.body);
    lastData = data;
    if (predicate(data)) {
      return data;
    }
    await sleep(500);
  }

  throw new Error(`workflow ${jobId} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const readAgentSnr = async (agentId: string): Promise<number | null> => {
  const prisma = new PrismaClient();

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { snr: true }
    });

    return agent ? agent.snr : null;
  } finally {
    await prisma.$disconnect();
  }
};

const countSnrLogs = async (agentId: string, reason: string): Promise<number> => {
  const prisma = new PrismaClient();

  try {
    return prisma.sNRAdjustmentLog.count({
      where: {
        agent_id: agentId,
        reason
      }
    });
  } finally {
    await prisma.$disconnect();
  }
};

const readLatestSnrLog = async (agentId: string, reason: string): Promise<Record<string, unknown> | null> => {
  const prisma = new PrismaClient();

  try {
    const log = await prisma.sNRAdjustmentLog.findFirst({
      where: {
        agent_id: agentId,
        reason
      },
      orderBy: {
        created_at: 'desc'
      }
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
      data: {
        snr: 0.5,
        updated_at: 0n
      }
    });

    await prisma.agent.update({
      where: { id: 'agent-002' },
      data: {
        snr: 0.5,
        updated_at: 0n
      }
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
    assert(isRecord(statusRes.body), '/api/status should return object');
    assert(statusRes.body.runtime_ready === true, 'adjust_snr test requires runtime_ready=true');

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
    assert(setRes.status === 200, 'adjust_snr submit should return 200');
    const setData = assertSuccessEnvelope(setRes.body);
    assert(isRecord(setData.job), 'adjust_snr job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      setData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const updatedSnr = await readAgentSnr('agent-002');
    assert(updatedSnr === 0.8, 'adjust_snr should update target agent snr to 0.8');

    const setLog = await readLatestSnrLog('agent-002', setReason);
    assert(isRecord(setLog), 'adjust_snr should write an SNRAdjustmentLog row');
    assert(setLog.operation === 'set', 'SNRAdjustmentLog operation should be set');
    assert(setLog.requested_value === 0.8, 'SNRAdjustmentLog should preserve requested_value');
    assert(setLog.baseline_value === 0.5, 'SNRAdjustmentLog should preserve baseline_value');
    assert(setLog.resolved_value === 0.8, 'SNRAdjustmentLog should preserve resolved_value');
    assert(setLog.action_intent_id, 'SNRAdjustmentLog should include action_intent_id');

    const setLogReadRes = await requestJson(server.baseUrl, '/api/agent/agent-002/snr/logs?limit=5');
    assert(setLogReadRes.status === 200, 'agent SNR adjustment log read API should return 200');
    assert(Array.isArray(setLogReadRes.body), 'agent SNR adjustment log read API should return an array');
    assert(
      setLogReadRes.body.some(item => isRecord(item) && item.reason === setReason && item.resolved_value === 0.8),
      'agent SNR adjustment log read API should expose latest adjust_snr entry'
    );

    const clampHighReason = `adjust_snr_clamp_high_${Date.now()}`;
    const clampHighRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: `adjust-snr-clamp-high-${Date.now()}`,
        attributes: {
          mock_action_type: 'adjust_snr',
          target_agent_id: 'agent-002',
          snr_operation: 'set',
          target_snr: 99,
          snr_reason: clampHighReason
        }
      })
    });
    assert(clampHighRes.status === 200, 'adjust_snr high clamp submit should return 200');
    const clampHighData = assertSuccessEnvelope(clampHighRes.body);
    assert(isRecord(clampHighData.job), 'adjust_snr high clamp job should be object');

    await pollWorkflowState(
      server.baseUrl,
      clampHighData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const highSnr = await readAgentSnr('agent-002');
    assert(highSnr === 1, 'adjust_snr should clamp high values to 1');

    const clampHighLog = await readLatestSnrLog('agent-002', clampHighReason);
    assert(isRecord(clampHighLog), 'high clamp path should write an SNRAdjustmentLog row');
    assert(clampHighLog.requested_value === 1, 'high clamp log should record clamped requested_value');
    assert(clampHighLog.baseline_value === 0.8, 'high clamp log should preserve pre-update baseline');
    assert(clampHighLog.resolved_value === 1, 'high clamp log should record resolved_value=1');

    const clampLowReason = `adjust_snr_clamp_low_${Date.now()}`;
    const clampLowRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: `adjust-snr-clamp-low-${Date.now()}`,
        attributes: {
          mock_action_type: 'adjust_snr',
          target_agent_id: 'agent-002',
          snr_operation: 'set',
          target_snr: -5,
          snr_reason: clampLowReason
        }
      })
    });
    assert(clampLowRes.status === 200, 'adjust_snr low clamp submit should return 200');
    const clampLowData = assertSuccessEnvelope(clampLowRes.body);
    assert(isRecord(clampLowData.job), 'adjust_snr low clamp job should be object');

    await pollWorkflowState(
      server.baseUrl,
      clampLowData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const lowSnr = await readAgentSnr('agent-002');
    assert(lowSnr === 0, 'adjust_snr should clamp low values to 0');

    const clampLowLog = await readLatestSnrLog('agent-002', clampLowReason);
    assert(isRecord(clampLowLog), 'low clamp path should write an SNRAdjustmentLog row');
    assert(clampLowLog.requested_value === 0, 'low clamp log should record clamped requested_value');
    assert(clampLowLog.baseline_value === 1, 'low clamp log should preserve pre-update baseline');
    assert(clampLowLog.resolved_value === 0, 'low clamp log should record resolved_value=0');

    const invalidActorRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: systemHeaders,
      body: JSON.stringify({
        identity_id: 'system',
        strategy: 'mock',
        idempotency_key: `adjust-snr-system-${Date.now()}`,
        attributes: {
          mock_action_type: 'adjust_snr',
          target_agent_id: 'agent-002',
          snr_operation: 'set',
          target_snr: 0.6,
          snr_reason: 'system_adjust_snr_should_fail'
        }
      })
    });
    assert(invalidActorRes.status === 200, 'system adjust_snr submit should still enqueue job');
    const invalidActorData = assertSuccessEnvelope(invalidActorRes.body);
    assert(isRecord(invalidActorData.job), 'system adjust_snr job payload should be object');

    const invalidActorWorkflow = await pollWorkflowState(
      server.baseUrl,
      invalidActorData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_failed'
    );
    assert(isRecord(invalidActorWorkflow.derived), 'system adjust_snr workflow derived should be object');
    assert(invalidActorWorkflow.derived.failure_stage === 'dispatch', 'system adjust_snr should fail at dispatch stage');
    assert(invalidActorWorkflow.derived.failure_code === 'ACTION_SNR_INVALID', 'system adjust_snr should expose ACTION_SNR_INVALID');

    const invalidPayloadRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: `adjust-snr-invalid-payload-${Date.now()}`,
        attributes: {
          mock_action_type: 'adjust_snr',
          target_agent_id: 'agent-002',
          snr_operation: 'delta',
          target_snr: 0.6,
          snr_reason: 'invalid_operation'
        }
      })
    });
    assert(invalidPayloadRes.status === 200, 'invalid adjust_snr payload should still enqueue job');
    const invalidPayloadData = assertSuccessEnvelope(invalidPayloadRes.body);
    assert(isRecord(invalidPayloadData.job), 'invalid adjust_snr payload job should be object');

    const invalidPayloadWorkflow = await pollWorkflowState(
      server.baseUrl,
      invalidPayloadData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_failed'
    );
    assert(isRecord(invalidPayloadWorkflow.derived), 'invalid adjust_snr payload workflow derived should be object');
    assert(invalidPayloadWorkflow.derived.failure_stage === 'dispatch', 'invalid adjust_snr payload should fail at dispatch stage');
    assert(invalidPayloadWorkflow.derived.failure_code === 'ACTION_SNR_INVALID', 'invalid adjust_snr payload should expose ACTION_SNR_INVALID');

    const replayReason = `adjust_snr_replay_${Date.now()}`;
    const replaySetRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: `adjust-snr-replay-source-${Date.now()}`,
        attributes: {
          mock_action_type: 'adjust_snr',
          target_agent_id: 'agent-002',
          snr_operation: 'set',
          target_snr: 0.6,
          snr_reason: replayReason
        }
      })
    });
    assert(replaySetRes.status === 200, 'adjust_snr replay source submit should return 200');
    const replaySetData = assertSuccessEnvelope(replaySetRes.body);
    assert(isRecord(replaySetData.job), 'adjust_snr replay source job should be object');

    await pollWorkflowState(
      server.baseUrl,
      replaySetData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const beforeReplayCount = await countSnrLogs('agent-002', replayReason);
    assert(beforeReplayCount === 1, 'replay source should produce exactly one SNRAdjustmentLog row before replay');

    const replayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${replaySetData.job.id as string}/replay`, {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        reason: 'adjust_snr_replay',
        idempotency_key: `adjust-snr-replay-${Date.now()}`
      })
    });
    assert(replayRes.status === 200, 'adjust_snr replay should return 200');
    const replayData = assertSuccessEnvelope(replayRes.body);
    assert(isRecord(replayData.job), 'adjust_snr replay job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      replayData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const replayedSnr = await readAgentSnr('agent-002');
    assert(replayedSnr === 0.6, 'adjust_snr replay should not drift final SNR value');

    const afterReplayCount = await countSnrLogs('agent-002', replayReason);
    assert(afterReplayCount === beforeReplayCount + 1, 'adjust_snr replay should append a new SNRAdjustmentLog row');

    const replayLog = await readLatestSnrLog('agent-002', replayReason);
    assert(isRecord(replayLog), 'adjust_snr replay should preserve audit log writes');
    assert(replayLog.resolved_value === 0.6, 'adjust_snr replay log should preserve resolved_value');

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
