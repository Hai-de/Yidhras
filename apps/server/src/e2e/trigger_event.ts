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
    return 3104;
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

const readLatestEvent = async (type: string, title: string): Promise<Record<string, unknown> | null> => {
  const prisma = new PrismaClient();

  try {
    const event = await prisma.event.findFirst({
      where: { type, title },
      orderBy: { tick: 'desc' }
    });

    return event
      ? ({
          ...event,
          tick: event.tick.toString(),
          created_at: event.created_at.toString()
        } as unknown as Record<string, unknown>)
      : null;
  } finally {
    await prisma.$disconnect();
  }
};

const countEvents = async (type: string, title: string): Promise<number> => {
  const prisma = new PrismaClient();

  try {
    return prisma.event.count({
      where: { type, title }
    });
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    assert(isRecord(statusRes.body), '/api/status should return object');
    assert(statusRes.body.runtime_ready === true, 'trigger_event test requires runtime_ready=true');

    const activeHeaders = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const systemHeaders = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('system', 'system')
    };

    const activeEventTitle = `Trigger Event Active ${Date.now()}`;
    const activeEventKey = `trigger-event-active-${Date.now()}`;
    const activeRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: activeEventKey,
        attributes: {
          mock_action_type: 'trigger_event',
          event_type: 'interaction',
          event_title: activeEventTitle,
          event_description: 'Agent-001 triggered an interaction event.',
          event_impact_data: {
            source_agent_id: 'agent-001',
            target_agent_id: 'agent-002',
            reason: 'mock_interaction'
          }
        }
      })
    });
    assert(activeRes.status === 200, 'active trigger_event submit should return 200');
    const activeData = assertSuccessEnvelope(activeRes.body);
    assert(isRecord(activeData.job), 'active trigger_event job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      activeData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const activeEvent = await readLatestEvent('interaction', activeEventTitle);
    assert(isRecord(activeEvent), 'active trigger_event should create an Event row');
    assert(activeEvent.title === activeEventTitle, 'active trigger_event should preserve title');
    assert(activeEvent.description === 'Agent-001 triggered an interaction event.', 'active trigger_event should preserve description');
    assert(activeEvent.type === 'interaction', 'active trigger_event should preserve type');
    assert(activeEvent.source_action_intent_id, 'active trigger_event should record source_action_intent_id');
    assert(typeof activeEvent.tick === 'string', 'active trigger_event tick should be serialized as string in helper read');

    const systemEventTitle = `Trigger Event System ${Date.now()}`;
    const systemEventKey = `trigger-event-system-${Date.now()}`;
    const systemRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: systemHeaders,
      body: JSON.stringify({
        identity_id: 'system',
        strategy: 'mock',
        idempotency_key: systemEventKey,
        attributes: {
          mock_action_type: 'trigger_event',
          event_type: 'system',
          event_title: systemEventTitle,
          event_description: 'System emitted a timeline event.'
        }
      })
    });
    assert(systemRes.status === 200, 'system trigger_event submit should return 200');
    const systemData = assertSuccessEnvelope(systemRes.body);
    assert(isRecord(systemData.job), 'system trigger_event job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      systemData.job.id as string,
      workflow => isRecord(workflow.derived) && (workflow.derived.workflow_state === 'workflow_completed' || workflow.derived.workflow_state === 'workflow_failed')
    );

    const systemEvent = await readLatestEvent('system', systemEventTitle);
    assert(isRecord(systemEvent), 'system trigger_event should create an Event row');
    assert(systemEvent.source_action_intent_id, 'system trigger_event should record source_action_intent_id');

    const invalidTypeKey = `trigger-event-invalid-type-${Date.now()}`;
    const invalidTypeRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: invalidTypeKey,
        attributes: {
          mock_action_type: 'trigger_event',
          event_type: 'narrative_custom',
          event_title: 'invalid-type',
          event_description: 'invalid-type'
        }
      })
    });
    assert(invalidTypeRes.status === 200, 'invalid type should still enqueue and fail in dispatcher path');
    const invalidTypeData = assertSuccessEnvelope(invalidTypeRes.body);
    assert(isRecord(invalidTypeData.job), 'invalid type job payload should be object');

    const invalidTypeWorkflow = await pollWorkflowState(
      server.baseUrl,
      invalidTypeData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_failed'
    );
    assert(isRecord(invalidTypeWorkflow.derived), 'invalid type workflow derived should be object');
    assert(invalidTypeWorkflow.derived.failure_stage === 'dispatch', 'invalid type should fail at dispatch stage');
    assert(invalidTypeWorkflow.derived.failure_code === 'EVENT_TYPE_UNSUPPORTED', 'invalid type should expose event type failure code');

    const invalidTickKey = `trigger-event-invalid-tick-${Date.now()}`;
    const invalidTickRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: invalidTickKey,
        attributes: {
          mock_action_type: 'trigger_event',
          event_type: 'history',
          event_title: 'invalid-tick',
          event_description: 'invalid-tick',
          event_impact_data: {
            tick: '999999'
          }
        }
      })
    });
    assert(invalidTickRes.status === 200, 'invalid tick event should still enqueue and fail in dispatcher path');
    const invalidTickData = assertSuccessEnvelope(invalidTickRes.body);
    assert(isRecord(invalidTickData.job), 'invalid tick job payload should be object');

    const invalidTickWorkflow = await pollWorkflowState(
      server.baseUrl,
      invalidTickData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_failed'
    );
    assert(isRecord(invalidTickWorkflow.derived), 'invalid tick workflow derived should be object');
    assert(invalidTickWorkflow.derived.failure_stage === 'dispatch', 'invalid tick should fail at dispatch stage');
    assert(invalidTickWorkflow.derived.failure_code === 'ACTION_EVENT_INVALID', 'invalid tick should expose event payload failure code');

    const beforeReplayCount = await countEvents('system', systemEventTitle);
    const replayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${systemData.job.id as string}/replay`, {
      method: 'POST',
      headers: systemHeaders,
      body: JSON.stringify({
        reason: 'trigger_event_replay',
        idempotency_key: `trigger-event-replay-${Date.now()}`
      })
    });
    assert(replayRes.status === 200, 'trigger_event replay should return 200');
    const replayData = assertSuccessEnvelope(replayRes.body);
    assert(isRecord(replayData.job), 'trigger_event replay job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      replayData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const afterReplayCount = await countEvents('system', systemEventTitle);
    assert(afterReplayCount === beforeReplayCount + 1, 'trigger_event replay should append a new event record');

    console.log('[trigger_event] PASS');
  } catch (error: unknown) {
    console.error('[trigger_event] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling trigger_event failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
