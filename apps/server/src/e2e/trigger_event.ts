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

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'trigger_event test requires runtime_ready=true');

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
          event_title: activeEventTitle,
          event_description: 'Trigger event active description',
          event_type: 'history'
        }
      })
    });
    assert(activeRes.status === 200, 'active trigger_event job should enqueue');

    const activeReplay = await pollReplayJob(
      server.baseUrl,
      activeHeaders,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: activeEventKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'active trigger_event replay poll'
    );
    assert(isRecord(activeReplay.job), 'active trigger_event replay should include job');

    const timelineRes = await requestJson(server.baseUrl, '/api/narrative/timeline');
    assert(timelineRes.status === 200, 'GET /api/narrative/timeline should return 200');
    const timeline = timelineRes.body;
    assert(isRecord(timeline), 'timeline should be envelope object');
    assert(timeline.success === true, 'timeline success should be true');
    assert(Array.isArray(timeline.data), 'timeline data should be array');
    assert(
      timeline.data.some(
        (entry: unknown) => isRecord(entry) && entry.title === activeEventTitle && entry.type === 'history'
      ),
      'timeline should contain active trigger_event entry'
    );

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
          event_title: systemEventTitle,
          event_description: 'Trigger event system description',
          event_type: 'system'
        }
      })
    });
    assert(systemRes.status === 200, 'system trigger_event job should enqueue');

    await pollReplayJob(
      server.baseUrl,
      systemHeaders,
      { identity_id: 'system', strategy: 'mock', idempotency_key: systemEventKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'system trigger_event replay poll'
    );

    const timelineAfterSystemRes = await requestJson(server.baseUrl, '/api/narrative/timeline');
    assert(timelineAfterSystemRes.status === 200, 'timeline after system event should return 200');
    const timelineAfterSystem = timelineAfterSystemRes.body;
    assert(isRecord(timelineAfterSystem), 'timeline after system event should be envelope object');
    assert(Array.isArray(timelineAfterSystem.data), 'timeline after system event data should be array');
    assert(
      timelineAfterSystem.data.some(
        (entry: unknown) => isRecord(entry) && entry.title === systemEventTitle && entry.type === 'system'
      ),
      'timeline should contain system trigger_event entry'
    );

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
          event_title: `Invalid Trigger Event ${Date.now()}`,
          event_description: 'Invalid trigger event description',
          event_type: 'unsupported_type'
        }
      })
    });
    assert(invalidTypeRes.status === 200, 'invalid trigger_event type should still enqueue');

    const invalidTypeReplay = await pollReplayJob(
      server.baseUrl,
      activeHeaders,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: invalidTypeKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
      'invalid trigger_event type replay poll'
    );
    assert(
      isRecord(invalidTypeReplay.workflow_snapshot) &&
        isRecord(invalidTypeReplay.workflow_snapshot.derived) &&
        invalidTypeReplay.workflow_snapshot.derived.failure_stage === 'dispatch',
      'invalid trigger_event type should surface as dispatch failure'
    );

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
