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
    return 3103;
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

const readRelationshipWeight = async (
  baseUrl: string,
  sourceId: string,
  targetId: string,
  type: string
): Promise<number | null> => {
  const graphRes = await requestJson(baseUrl, '/api/relational/graph');
  assert(graphRes.status === 200, 'GET /api/relational/graph should return 200');
  assert(isRecord(graphRes.body), 'graph response should be object');
  assert(Array.isArray(graphRes.body.edges), 'graph edges should be array');

  for (const edge of graphRes.body.edges) {
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
  baseUrl: string,
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
    assert(isRecord(statusRes.body), '/api/status should return object');
    assert(statusRes.body.runtime_ready === true, 'adjust_relationship test requires runtime_ready=true');

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
          relationship_target_weight: 0.65,
          create_if_missing: false
        }
      })
    });
    assert(updateExistingRes.status === 200, 'adjust_relationship submit should return 200');
    const updateExistingData = assertSuccessEnvelope(updateExistingRes.body);
    assert(isRecord(updateExistingData.job), 'adjust_relationship job payload should be object');
    const updateExistingWorkflow = await pollWorkflowState(
      server.baseUrl,
      updateExistingData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );
    assert(isRecord(updateExistingWorkflow.derived), 'adjust existing workflow derived should be object');

    const createdWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-002', 'friend');
    assert(createdWeight === 0.65, 'adjust_relationship should create/update single directed edge with target weight 0.65');

    const updateLog = await readLatestRelationshipLog(server.baseUrl, 'agent-001', 'agent-002', 'friend');
    assert(isRecord(updateLog), 'adjust_relationship update should write a relationship adjustment log');
    assert(updateLog.operation === 'set', 'relationship adjustment log operation should be set');
    assert(updateLog.old_weight === 0.2, 'relationship adjustment log should preserve old_weight');
    assert(updateLog.new_weight === 0.65, 'relationship adjustment log should preserve new_weight');
    assert(updateLog.action_intent_id, 'relationship adjustment log should include action_intent_id');
    assert(updateLog.relationship_id, 'relationship adjustment log should include relationship_id');

    const updateLogReadRes = await requestJson(server.baseUrl, '/api/relationships/agent-001/agent-002/friend/logs?limit=5');
    assert(updateLogReadRes.status === 200, 'relationship adjustment log read API should return 200');
    assert(Array.isArray(updateLogReadRes.body), 'relationship adjustment log read API should return an array');
    assert(
      updateLogReadRes.body.some(item => isRecord(item) && item.new_weight === 0.65),
      'relationship adjustment log read API should expose updated relationship entry'
    );

    const reverseWeight = await readRelationshipWeight(server.baseUrl, 'agent-002', 'agent-001', 'friend');
    assert(reverseWeight === null, 'adjust_relationship should not create reverse edge automatically');

    const clampKey = `adjust-relationship-clamp-${Date.now()}`;
    const clampRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: clampKey,
        attributes: {
          mock_action_type: 'adjust_relationship',
          target_agent_id: 'agent-002',
          relationship_type: 'friend',
          relationship_operation: 'set',
          relationship_target_weight: 99,
          create_if_missing: false
        }
      })
    });
    assert(clampRes.status === 200, 'adjust_relationship clamp submit should return 200');
    const clampData = assertSuccessEnvelope(clampRes.body);
    assert(isRecord(clampData.job), 'clamp job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      clampData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const clampedWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-002', 'friend');
    assert(clampedWeight === 1, 'weight should be clamped to 1');

    const missingKey = `adjust-relationship-missing-${Date.now()}`;
    const missingRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: missingKey,
        attributes: {
          mock_action_type: 'adjust_relationship',
          target_agent_id: 'agent-003',
          relationship_type: 'enemy',
          relationship_operation: 'set',
          relationship_target_weight: 0.4,
          create_if_missing: false
        }
      })
    });
    assert(missingRes.status === 200, 'missing relationship submit should still enqueue job');
    const missingData = assertSuccessEnvelope(missingRes.body);
    assert(isRecord(missingData.job), 'missing relationship job payload should be object');

    const missingWorkflow = await pollWorkflowState(
      server.baseUrl,
      missingData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_failed'
    );
    assert(isRecord(missingWorkflow.derived), 'missing workflow derived should be object');
    assert(missingWorkflow.derived.failure_stage === 'dispatch', 'missing relationship should fail during dispatch');
    assert(missingWorkflow.derived.failure_code === 'RELATIONSHIP_NOT_FOUND', 'missing relationship should surface relationship not found failure code');

    const createKey = `adjust-relationship-create-${Date.now()}`;
    const createRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: createKey,
        attributes: {
          mock_action_type: 'adjust_relationship',
          target_agent_id: 'agent-003',
          relationship_type: 'enemy',
          relationship_operation: 'set',
          relationship_target_weight: 0.4,
          create_if_missing: true
        }
      })
    });
    assert(createRes.status === 200, 'create_if_missing submit should return 200');
    const createData = assertSuccessEnvelope(createRes.body);
    assert(isRecord(createData.job), 'create_if_missing job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      createData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const createdEnemyWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-003', 'enemy');
    assert(createdEnemyWeight === 0.4, 'create_if_missing should create missing directed edge');

    const createLog = await readLatestRelationshipLog(server.baseUrl, 'agent-001', 'agent-003', 'enemy');
    assert(isRecord(createLog), 'create_if_missing path should write a relationship adjustment log');
    assert(createLog.old_weight === null, 'create_if_missing path should record old_weight as null');
    assert(createLog.new_weight === 0.4, 'create_if_missing path should record new_weight');
    assert(createLog.reason === 'mock_adjust_relationship', 'relationship adjustment log should preserve reason');

    const createLogReadRes = await requestJson(server.baseUrl, '/api/relationships/agent-001/agent-003/enemy/logs');
    assert(createLogReadRes.status === 200, 'relationship adjustment log read API for created edge should return 200');
    assert(Array.isArray(createLogReadRes.body), 'relationship adjustment log read API for created edge should return an array');
    assert(
      createLogReadRes.body.some(item => isRecord(item) && item.old_weight === null && item.new_weight === 0.4),
      'relationship adjustment log read API should expose create_if_missing entry'
    );

    const replayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${createData.job.id as string}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'adjust_relationship_replay',
        idempotency_key: `adjust-relationship-replay-${Date.now()}`
      })
    });
    assert(replayRes.status === 200, 'adjust_relationship replay should return 200');
    const replayData = assertSuccessEnvelope(replayRes.body);
    assert(isRecord(replayData.job), 'adjust_relationship replay job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      replayData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const replayedWeight = await readRelationshipWeight(server.baseUrl, 'agent-001', 'agent-003', 'enemy');
    assert(replayedWeight === 0.4, 'replay with set should not drift relationship weight');

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
