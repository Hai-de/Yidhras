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

const prepareAuditFixtures = async (): Promise<void> => {
  const prisma = new PrismaClient();

  try {
    await prisma.relationshipAdjustmentLog.deleteMany();
    await prisma.sNRAdjustmentLog.deleteMany();
    await prisma.post.deleteMany();
    await prisma.event.deleteMany();
    await prisma.decisionJob.deleteMany();
    await prisma.actionIntent.deleteMany();
    await prisma.inferenceTrace.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  const port = parsePort();
  await prepareAuditFixtures();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'audit feed test requires runtime_ready=true');

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const messageContent = `Audit feed post ${Date.now()}`;
    const postRes = await requestJson(server.baseUrl, '/api/social/post', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: messageContent
      })
    });
    assert(postRes.status === 200, 'POST /api/social/post should return 200');
    const createdPost = assertSuccessEnvelopeData(postRes.body, 'social post response');
    assert(typeof createdPost.id === 'string', 'social post response should include post id');

    const workflowPostContent = `Audit workflow post ${Date.now()}`;
    const workflowKey = `audit-feed-workflow-${Date.now()}`;
    const workflowRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: workflowKey,
        attributes: {
          mock_action_type: 'post_message',
          mock_content: workflowPostContent
        }
      })
    });
    assert(workflowRes.status === 200, 'enqueue workflow job should return 200');
    const workflowSubmitData = assertSuccessEnvelopeData(workflowRes.body, 'workflow submit response');
    assert(isRecord(workflowSubmitData.job), 'workflow submit response should include job');

    const workflowReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: workflowKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'audit workflow replay poll'
    );
    assert(isRecord(workflowReplay.job), 'workflow replay response should include job');

    const eventTitle = `Audit Event ${Date.now()}`;
    const eventKey = `audit-feed-event-${Date.now()}`;
    const eventRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: eventKey,
        attributes: {
          mock_action_type: 'trigger_event',
          event_title: eventTitle,
          event_description: 'Audit event description',
          event_type: 'history'
        }
      })
    });
    assert(eventRes.status === 200, 'enqueue event job should return 200');

    await pollReplayJob(
      server.baseUrl,
      headers,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: eventKey },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'audit event replay poll'
    );

    const auditFeedRes = await requestJson(server.baseUrl, '/api/audit/feed?limit=20');
    assert(auditFeedRes.status === 200, 'GET /api/audit/feed should return 200');
    const auditFeedData = assertSuccessEnvelopeData(auditFeedRes.body, 'audit feed response');
    assert(Array.isArray(auditFeedData.entries), 'audit feed entries should be array');
    assert(isRecord(auditFeedData.summary), 'audit feed summary should be object');
    assert(isRecord((auditFeedRes.body as Record<string, unknown>).meta), 'audit feed envelope meta should be object');

    const entries = auditFeedData.entries;
    const workflowEntry = entries.find(
      entry =>
        isRecord(entry) && isRecord(workflowReplay.job) && entry.kind === 'workflow' && entry.id === workflowReplay.job.id
    );
    assert(isRecord(workflowEntry), 'audit feed should include workflow entry');

    const postEntry = entries.find(entry => isRecord(entry) && entry.kind === 'post' && isRecord(entry.data) && entry.data.content === messageContent);
    assert(isRecord(postEntry), 'audit feed should include direct post entry');

    const eventEntry = entries.find(entry => isRecord(entry) && entry.kind === 'event' && isRecord(entry.data) && entry.data.title === eventTitle);
    assert(isRecord(eventEntry), 'audit feed should include event entry');

    const workflowFeedRes = await requestJson(server.baseUrl, `/api/audit/feed?job_id=${workflowReplay.job.id as string}`);
    assert(workflowFeedRes.status === 200, 'GET /api/audit/feed?job_id should return 200');
    const workflowFeedData = assertSuccessEnvelopeData(workflowFeedRes.body, 'workflow-filtered audit feed');
    assert(Array.isArray(workflowFeedData.entries), 'workflow-filtered audit feed entries should be array');
    assert(workflowFeedData.entries.length === 1, 'workflow-filtered audit feed should return one entry');
    assert(isRecord(workflowFeedData.entries[0]), 'workflow-filtered audit feed entry should be object');
    assert(workflowFeedData.entries[0].id === workflowReplay.job.id, 'workflow-filtered audit feed should return matching job');

    const workflowDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${workflowReplay.job.id as string}`);
    assert(workflowDetailRes.status === 200, 'GET /api/audit/entries/workflow/:id should return 200');
    const workflowDetail = assertSuccessEnvelopeData(workflowDetailRes.body, 'workflow detail response');
    assert(workflowDetail.kind === 'workflow', 'workflow detail kind should be workflow');
    assert(isRecord(workflowDetail.data), 'workflow detail data should be object');
    assert(isRecord(workflowDetail.data.related_counts), 'workflow detail related_counts should be object');
    assert(isRecord(workflowDetail.data.related_records), 'workflow detail related_records should be object');

    const postDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/post/${createdPost.id as string}`);
    assert(postDetailRes.status === 200, 'GET /api/audit/entries/post/:id should return 200');
    const postDetail = assertSuccessEnvelopeData(postDetailRes.body, 'post detail response');
    assert(postDetail.kind === 'post', 'post detail kind should be post');

    console.log('[audit_feed] PASS');
  } catch (error: unknown) {
    console.error('[audit_feed] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling audit_feed failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
