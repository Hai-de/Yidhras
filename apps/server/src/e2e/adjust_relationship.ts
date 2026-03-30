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

const readRelationshipWeight = async (
  baseUrl: string,
  sourceId: string,
  targetId: string,
  type: string
): Promise<number | null> => {
  const graphRes = await requestJson(baseUrl, '/api/relational/graph');
  assert(graphRes.status === 200, 'GET /api/relational/graph should return 200');
  const graphData = assertSuccessEnvelopeData(graphRes.body, 'graph response');
  assert(Array.isArray(graphData.edges), 'graph edges should be array');

  for (const edge of graphData.edges) {
    if (!isRecord(edge) || !isRecord(edge.data)) {
      continue;
    }
    if (edge.data.source === sourceId && edge.data.target === targetId && edge.data.type === type) {
      return typeof edge.data.weight === 'number' ? edge.data.weight : null;
    }
  }

  return null;
};

const readLatestRelationshipLog = async (
  sourceId: string,
  targetId: string,
  type: string
): Promise<Record<string, unknown> | null> => {
  const prisma = new PrismaClient();

  try {
    const log = await prisma.relationshipAdjustmentLog.findFirst({
      where: { from_id: sourceId, to_id: targetId, type },
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

const prepareRelationshipFixtures = async (): Promise<void> => {
  const prisma = new PrismaClient();

  try {
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
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  const port = parsePort();
  await prepareRelationshipFixtures();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'adjust_relationship test requires runtime_ready=true');

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const initialFriendWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-002', 'friend');
    assert(initialFriendWeight === 0.2, 'initial relationship fixture weight should be 0.2');

    const updateExistingKey = `adjust-relationship-existing-${Date.now()}`;
    const updateExistingRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(updateExistingRes.status === 200, 'enqueue adjust_relationship existing edge should return 200');
    const updateExistingData = assertSuccessEnvelopeData(updateExistingRes.body, 'adjust relationship enqueue response');
    assert(isRecord(updateExistingData.job), 'adjust relationship enqueue job should be object');

    const completedExistingReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      {
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: updateExistingKey
      },
      data => {
        if (!isRecord(data.workflow_snapshot) || !isRecord(data.workflow_snapshot.derived)) {
          return false;
        }
        return data.workflow_snapshot.derived.workflow_state === 'workflow_completed';
      },
      'adjust relationship replay poll'
    );
    assert(completedExistingReplay.result_source === 'stored_trace', 'completed replay should expose stored trace result');

    const updatedFriendWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-002', 'friend');
    assert(updatedFriendWeight === 0.85, 'existing relationship weight should be updated to 0.85');

    const existingLog = await readLatestRelationshipLog('agent-001', 'agent-002', 'friend');
    assert(isRecord(existingLog), 'existing relationship adjustment log should exist');
    assert(existingLog.new_weight === 0.85, 'existing relationship adjustment log should record new_weight=0.85');

    const createMissingKey = `adjust-relationship-create-${Date.now()}`;
    const createMissingRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(createMissingRes.status === 200, 'enqueue adjust_relationship missing edge should return 200');

    await pollReplayJob(
      server.baseUrl,
      headers,
      {
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: createMissingKey
      },
      data => {
        if (!isRecord(data.workflow_snapshot) || !isRecord(data.workflow_snapshot.derived)) {
          return false;
        }
        return data.workflow_snapshot.derived.workflow_state === 'workflow_completed';
      },
      'create missing relationship replay poll'
    );

    const createdEnemyWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-003', 'enemy');
    assert(createdEnemyWeight === 0.4, 'missing relationship should be created with weight 0.4');

    const createdLog = await readLatestRelationshipLog('agent-001', 'agent-003', 'enemy');
    assert(isRecord(createdLog), 'created relationship adjustment log should exist');
    assert(createdLog.old_weight === null, 'created relationship adjustment log old_weight should be null');
    assert(createdLog.new_weight === 0.4, 'created relationship adjustment log new_weight should be 0.4');

    const invalidOperationKey = `adjust-relationship-invalid-op-${Date.now()}`;
    const invalidOperationRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(invalidOperationRes.status === 200, 'invalid operation job should still enqueue');

    const invalidOperationReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      {
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: invalidOperationKey
      },
      data => {
        if (!isRecord(data.workflow_snapshot) || !isRecord(data.workflow_snapshot.derived)) {
          return false;
        }
        return data.workflow_snapshot.derived.workflow_state === 'workflow_failed';
      },
      'invalid operation replay poll'
    );
    assert(isRecord(invalidOperationReplay.workflow_snapshot), 'invalid operation workflow snapshot should be object');
    assert(
      isRecord(invalidOperationReplay.workflow_snapshot.derived) &&
        invalidOperationReplay.workflow_snapshot.derived.failure_stage === 'dispatch',
      'invalid operation should surface as dispatch failure'
    );
    assert(
      isRecord(invalidOperationReplay.workflow_snapshot.derived) &&
        invalidOperationReplay.workflow_snapshot.derived.failure_code === 'ACTION_RELATIONSHIP_INVALID',
      'invalid operation should expose ACTION_RELATIONSHIP_INVALID'
    );

    const invalidTargetKey = `adjust-relationship-invalid-target-${Date.now()}`;
    const invalidTargetRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: invalidTargetKey,
        attributes: {
          mock_action_type: 'adjust_relationship',
          target_agent_id: 'agent-001',
          relationship_type: 'friend',
          relationship_operation: 'set',
          relationship_weight: 0.7
        }
      })
    });
    assert(invalidTargetRes.status === 200, 'invalid target job should still enqueue');

    const invalidTargetReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      {
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: invalidTargetKey
      },
      data => {
        if (!isRecord(data.workflow_snapshot) || !isRecord(data.workflow_snapshot.derived)) {
          return false;
        }
        return data.workflow_snapshot.derived.workflow_state === 'workflow_failed';
      },
      'invalid target replay poll'
    );
    assert(isRecord(invalidTargetReplay.workflow_snapshot), 'invalid target workflow snapshot should be object');
    assert(
      isRecord(invalidTargetReplay.workflow_snapshot.derived) &&
        invalidTargetReplay.workflow_snapshot.derived.failure_stage === 'dispatch',
      'invalid target should surface as dispatch failure'
    );
    assert(
      isRecord(invalidTargetReplay.workflow_snapshot.derived) &&
        invalidTargetReplay.workflow_snapshot.derived.failure_code === 'ACTION_RELATIONSHIP_INVALID',
      'invalid target should expose ACTION_RELATIONSHIP_INVALID'
    );

    console.log('[adjust_relationship] PASS');
  } catch (error: unknown) {
    console.error('[adjust_relationship] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling adjust_relationship failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
