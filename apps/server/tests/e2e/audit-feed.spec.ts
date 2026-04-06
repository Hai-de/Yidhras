import { describe, expect, it } from 'vitest';

import {
  assertArrayField,
  assertRecord,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
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

const prepareAuditFixtures = async (prisma: ReturnType<typeof createPrismaClientForEnvironment>): Promise<void> => {
  await prisma.relationshipAdjustmentLog.deleteMany();
  await prisma.sNRAdjustmentLog.deleteMany();
  await prisma.post.deleteMany();
  await prisma.event.deleteMany();
  await prisma.decisionJob.deleteMany();
  await prisma.actionIntent.deleteMany();
  await prisma.inferenceTrace.deleteMany();
};

describe('audit feed e2e', () => {
  it('returns workflow/post/event entries plus detail projections for audit pages', async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);
      await prepareAuditFixtures(prisma);

      await withTestServer(
        {
          defaultPort: 3111,
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
            'x-m2-identity': createIdentityHeader('agent-001', 'agent')
          };

          const messageContent = `Audit feed post ${Date.now()}`;
          const postResponse = await requestJson(server.baseUrl, '/api/social/post', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              content: messageContent
            })
          });
          expect(postResponse.status).toBe(200);
          const createdPost = assertSuccessEnvelopeData(postResponse.body, 'social post response');
          expect(typeof createdPost.id).toBe('string');

          const workflowPostContent = `Audit workflow post ${Date.now()}`;
          const workflowKey = `audit-feed-workflow-${Date.now()}`;
          const workflowResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
          expect(workflowResponse.status).toBe(200);
          const workflowSubmitData = assertSuccessEnvelopeData(workflowResponse.body, 'workflow submit response');
          expect(isRecord(workflowSubmitData.job)).toBe(true);

          const workflowReplay = await pollReplayJob(
            server.baseUrl,
            headers,
            { agent_id: 'agent-001', strategy: 'mock', idempotency_key: workflowKey },
            data =>
              isRecord(data.workflow_snapshot) &&
              isRecord(data.workflow_snapshot.derived) &&
              data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
            'audit workflow replay poll'
          );
          const workflowReplayJob = assertRecord(workflowReplay.job, 'workflow replay job');
          const workflowReplayJobId = String(workflowReplayJob.id);

          const eventTitle = `Audit Event ${Date.now()}`;
          const eventKey = `audit-feed-event-${Date.now()}`;
          const eventResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
          expect(eventResponse.status).toBe(200);

          await pollReplayJob(
            server.baseUrl,
            headers,
            { agent_id: 'agent-001', strategy: 'mock', idempotency_key: eventKey },
            data =>
              isRecord(data.workflow_snapshot) &&
              isRecord(data.workflow_snapshot.derived) &&
              data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
            'audit event replay poll'
          );

          const auditFeedResponse = await requestJson(server.baseUrl, '/api/audit/feed?limit=20');
          expect(auditFeedResponse.status).toBe(200);
          const auditFeedData = assertSuccessEnvelopeData(auditFeedResponse.body, 'audit feed response');
          expect(Array.isArray(auditFeedData.entries)).toBe(true);
          expect(isRecord(auditFeedData.summary)).toBe(true);
          expect(isRecord((auditFeedResponse.body as Record<string, unknown>).meta)).toBe(true);

          const workflowFeedResponse = await requestJson(
            server.baseUrl,
            `/api/audit/feed?job_id=${workflowReplayJobId}`
          );
          expect(workflowFeedResponse.status).toBe(200);
          const workflowFeedData = assertSuccessEnvelopeData(workflowFeedResponse.body, 'workflow-filtered audit feed');
          const workflowFeedEntries = assertArrayField(workflowFeedData, 'entries', 'workflow-filtered audit feed');
          expect(workflowFeedEntries.length).toBe(1);
          expect(isRecord(workflowFeedEntries[0])).toBe(true);
          expect((workflowFeedEntries[0] as Record<string, unknown>).id).toBe(workflowReplayJobId);

          const workflowDetailResponse = await requestJson(
            server.baseUrl,
            `/api/audit/entries/workflow/${workflowReplayJobId}`
          );
          expect(workflowDetailResponse.status).toBe(200);
          const workflowDetail = assertSuccessEnvelopeData(workflowDetailResponse.body, 'workflow detail response');
          expect(workflowDetail.kind).toBe('workflow');
          const workflowDetailData = assertRecord(workflowDetail.data, 'workflow detail data');
          expect(isRecord(workflowDetailData.related_counts)).toBe(true);
          expect(isRecord(workflowDetailData.related_records)).toBe(true);

          const postDetailResponse = await requestJson(server.baseUrl, `/api/audit/entries/post/${createdPost.id as string}`);
          expect(postDetailResponse.status).toBe(200);
          const postDetail = assertSuccessEnvelopeData(postDetailResponse.body, 'post detail response');
          expect(postDetail.kind).toBe('post');

          const persistedEvent = await prisma.event.findFirst({
            where: { title: eventTitle },
            orderBy: { created_at: 'desc' }
          });
          expect(persistedEvent).not.toBeNull();

          const eventDetailResponse = await requestJson(
            server.baseUrl,
            `/api/audit/entries/event/${persistedEvent?.id as string}`
          );
          expect(eventDetailResponse.status).toBe(200);
          const eventDetail = assertSuccessEnvelopeData(eventDetailResponse.body, 'event detail response');
          expect(eventDetail.kind).toBe('event');
        }
      );
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
