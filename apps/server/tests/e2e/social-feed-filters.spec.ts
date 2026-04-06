import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  assertErrorEnvelope,
  assertSuccessEnvelopeArrayData,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, withTestServer } from '../helpers/server.js';

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const createTraceRecord = (id: string, agentId: string, tick: bigint) => ({
  id,
  kind: 'run',
  strategy: 'mock',
  provider: 'mock',
  actor_ref: {
    role: 'active',
    agent_id: agentId,
    identity_id: agentId
  },
  input: {},
  context_snapshot: {},
  prompt_bundle: {},
  trace_metadata: {
    tick: tick.toString()
  },
  decision: {
    action_type: 'post_message',
    payload: {
      content: `fixture-${id}`
    }
  },
  created_at: tick,
  updated_at: tick
});

const createIntentRecord = (id: string, traceId: string, agentId: string, tick: bigint) => ({
  id,
  source_inference_id: traceId,
  intent_type: 'post_message',
  actor_ref: {
    role: 'active',
    agent_id: agentId,
    identity_id: agentId
  },
  target_ref: Prisma.JsonNull,
  payload: {
    content: `fixture-${id}`
  },
  status: 'completed',
  transmission_policy: 'reliable',
  transmission_drop_chance: 0,
  created_at: tick,
  updated_at: tick
});

const assertFeedContents = (value: unknown, expectedContents: string[], label: string): Record<string, unknown>[] => {
  expect(Array.isArray(value)).toBe(true);
  const items = value as Record<string, unknown>[];
  expect(items.length).toBe(expectedContents.length);

  const contents = items.map(item => {
    expect(isRecord(item)).toBe(true);
    if (typeof item.content === 'string') {
      return item.content;
    }

    if (isRecord(item.content) && typeof item.content.public === 'string') {
      return item.content.public;
    }

    if (isRecord(item.content) && typeof item.content.preview === 'string') {
      return item.content.preview;
    }

    throw new Error(`${label} item.content should be string or readable content object`);
  });

  expect(contents).toEqual(expectedContents);
  return items;
};

const prepareSocialFeedFixtures = async (prisma: PrismaClient, runId: string, baseTick: bigint) => {
  const ensurePolicy = async (input: {
    effect: 'allow' | 'deny';
    subject_id?: string | null;
    subject_type?: string | null;
    resource: string;
    action: string;
    field: string;
    priority: number;
  }) => {
    const existing = await prisma.policy.findFirst({
      where: {
        effect: input.effect,
        subject_id: input.subject_id ?? null,
        subject_type: input.subject_type ?? null,
        resource: input.resource,
        action: input.action,
        field: input.field
      }
    });

    if (existing) {
      return;
    }

    await prisma.policy.create({
      data: {
        effect: input.effect,
        subject_id: input.subject_id ?? null,
        subject_type: input.subject_type ?? null,
        resource: input.resource,
        action: input.action,
        field: input.field,
        priority: input.priority,
        created_at: baseTick,
        updated_at: baseTick
      }
    });
  };

  const circleId = `social-feed-circle-${runId}`;
  const traceAId = `social-feed-trace-${runId}-a`;
  const traceBId = `social-feed-trace-${runId}-b`;
  const intentAId = `social-feed-intent-${runId}-a`;
  const intentBId = `social-feed-intent-${runId}-b`;

  const fixtures = {
    baseTick,
    minTick: baseTick,
    maxTick: baseTick + 50n,
    intentAId,
    circleId,
    intentBId,
    posts: {
      agent1Strong: {
        id: `social-feed-post-${runId}-1`,
        author_id: 'agent-001',
        source_action_intent_id: intentAId,
        content: `social-feed-${runId}-agent-001-strong`,
        noise_level: 0.05,
        created_at: baseTick + 10n
      },
      agent1Weak: {
        id: `social-feed-post-${runId}-2`,
        author_id: 'agent-001',
        source_action_intent_id: null,
        content: `social-feed-${runId}-agent-001-weak`,
        noise_level: 0.9,
        created_at: baseTick + 20n
      },
      agent2Strong: {
        id: `social-feed-post-${runId}-3`,
        author_id: 'agent-002',
        source_action_intent_id: intentBId,
        content: `social-feed-${runId}-agent-002-strong`,
        noise_level: 0.15,
        created_at: baseTick + 30n
      },
      agent2Mid: {
        id: `social-feed-post-${runId}-4`,
        author_id: 'agent-002',
        source_action_intent_id: null,
        content: `social-feed-${runId}-agent-002-mid`,
        noise_level: 0.4,
        created_at: baseTick + 40n
      }
    }
  };

  await ensurePolicy({
    effect: 'allow',
    subject_type: 'agent',
    resource: 'social_post',
    action: 'read',
    field: 'id',
    priority: 10
  });
  await ensurePolicy({
    effect: 'allow',
    subject_type: 'agent',
    resource: 'social_post',
    action: 'read',
    field: 'author_id',
    priority: 10
  });
  await ensurePolicy({
    effect: 'allow',
    subject_type: 'agent',
    resource: 'social_post',
    action: 'read',
    field: 'content',
    priority: 10
  });
  await ensurePolicy({
    effect: 'allow',
    subject_type: 'agent',
    resource: 'social_post',
    action: 'read',
    field: 'created_at',
    priority: 10
  });

  await prisma.circle.create({
    data: {
      id: circleId,
      name: `Social Feed Circle ${runId}`,
      level: 1,
      description: 'social feed filter fixture circle'
    }
  });

  await prisma.circleMember.create({
    data: {
      circle_id: circleId,
      agent_id: 'agent-002'
    }
  });

  await prisma.inferenceTrace.create({
    data: createTraceRecord(traceAId, 'agent-001', baseTick + 1n)
  });
  await prisma.inferenceTrace.create({
    data: createTraceRecord(traceBId, 'agent-002', baseTick + 2n)
  });

  await prisma.actionIntent.create({
    data: createIntentRecord(intentAId, traceAId, 'agent-001', baseTick + 3n)
  });
  await prisma.actionIntent.create({
    data: createIntentRecord(intentBId, traceBId, 'agent-002', baseTick + 4n)
  });

  await prisma.post.create({ data: fixtures.posts.agent1Strong });
  await prisma.post.create({ data: fixtures.posts.agent1Weak });
  await prisma.post.create({ data: fixtures.posts.agent2Strong });
  await prisma.post.create({ data: fixtures.posts.agent2Mid });

  return fixtures;
};

describe('social feed filters e2e', () => {
  it('supports feed filtering, sorting, range and cursor validation with isolated fixtures', async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);
      const runId = `${Date.now()}`;
      const baseTick = 8000000000000000n + BigInt(runId);
      const fixtures = await prepareSocialFeedFixtures(prisma, runId, baseTick);

      await withTestServer(
        {
          defaultPort: 3116,
          envOverrides: environment.envOverrides,
          prepareRuntime: false
        },
        async server => {
          const statusResponse = await requestJson(server.baseUrl, '/api/status');
          expect(statusResponse.status).toBe(200);
          const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
          expect(statusData.runtime_ready).toBe(true);

          const headers = {
            'x-m2-identity': createIdentityHeader('agent-001', 'agent')
          };

          const latestResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=latest&limit=10`,
            { headers }
          );
          expect(latestResponse.status).toBe(200);
          const latestFeed = assertSuccessEnvelopeArrayData(latestResponse.body, 'social feed latest response');
          assertFeedContents(
            latestFeed,
            [
              fixtures.posts.agent2Mid.content,
              fixtures.posts.agent2Strong.content,
              fixtures.posts.agent1Weak.content,
              fixtures.posts.agent1Strong.content
            ],
            'social feed latest response'
          );

          const authorResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?author_id=agent-001&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
            { headers }
          );
          expect(authorResponse.status).toBe(200);
          const authorFeed = assertSuccessEnvelopeArrayData(authorResponse.body, 'social feed author filter response');
          const authorItems = assertFeedContents(
            authorFeed,
            [fixtures.posts.agent1Weak.content, fixtures.posts.agent1Strong.content],
            'social feed author filter response'
          );
          expect(
            authorItems.every(item => {
              if (!isRecord(item.author_id)) {
                return item.author_id === 'agent-001';
              }

              return (
                item.author_id.id === 'agent-001' ||
                item.author_id.public === 'agent-001' ||
                item.author_id.preview === 'agent-001'
              );
            })
          ).toBe(true);

          const agentResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?agent_id=agent-002&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
            { headers }
          );
          expect(agentResponse.status).toBe(200);
          const agentFeed = assertSuccessEnvelopeArrayData(agentResponse.body, 'social feed agent filter response');
          const agentItems = assertFeedContents(
            agentFeed,
            [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
            'social feed agent filter response'
          );
          expect(
            agentItems.every(item => {
              if (!isRecord(item.author_id)) {
                return item.author_id === 'agent-002';
              }

              return (
                item.author_id.id === 'agent-002' ||
                item.author_id.public === 'agent-002' ||
                item.author_id.preview === 'agent-002'
              );
            })
          ).toBe(true);

          const sourceIntentResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?source_action_intent_id=${fixtures.intentAId}&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
            { headers }
          );
          expect(sourceIntentResponse.status).toBe(200);
          const sourceIntentFeed = assertSuccessEnvelopeArrayData(sourceIntentResponse.body, 'social feed intent filter response');
          assertFeedContents(
            sourceIntentFeed,
            [fixtures.posts.agent1Strong.content],
            'social feed intent filter response'
          );

          const rangeResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${(fixtures.baseTick + 15n).toString()}&to_tick=${(fixtures.baseTick + 35n).toString()}&limit=10`,
            { headers }
          );
          expect(rangeResponse.status).toBe(200);
          const rangeFeed = assertSuccessEnvelopeArrayData(rangeResponse.body, 'social feed range response');
          const rangeItems = assertFeedContents(
            rangeFeed,
            [fixtures.posts.agent2Strong.content, fixtures.posts.agent1Weak.content],
            'social feed range response'
          );
          expect(
            rangeItems.every(item => {
              expect(typeof item.created_at).toBe('string');
              const tick = BigInt(item.created_at as string);
              return tick >= fixtures.baseTick + 15n && tick <= fixtures.baseTick + 35n;
            })
          ).toBe(true);

          const limitResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=2`,
            { headers }
          );
          expect(limitResponse.status).toBe(200);
          const limitFeed = assertSuccessEnvelopeArrayData(limitResponse.body, 'social feed limit response');
          assertFeedContents(
            limitFeed,
            [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
            'social feed limit response'
          );

          const signalResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=signal&limit=10`,
            { headers }
          );
          expect(signalResponse.status).toBe(200);
          const signalFeed = assertSuccessEnvelopeArrayData(signalResponse.body, 'social feed signal response');
          assertFeedContents(
            signalFeed,
            [
              fixtures.posts.agent1Strong.content,
              fixtures.posts.agent2Strong.content,
              fixtures.posts.agent2Mid.content,
              fixtures.posts.agent1Weak.content
            ],
            'social feed signal response'
          );

          const keywordResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?keyword=${encodeURIComponent(`${runId}-agent-002`)}&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
            { headers }
          );
          expect(keywordResponse.status).toBe(200);
          const keywordFeed = assertSuccessEnvelopeArrayData(keywordResponse.body, 'social feed keyword response');
          assertFeedContents(
            keywordFeed,
            [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
            'social feed keyword response'
          );

          const signalMinResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&signal_min=0.7&sort=signal&limit=10`,
            { headers }
          );
          expect(signalMinResponse.status).toBe(200);
          const signalMinFeed = assertSuccessEnvelopeArrayData(signalMinResponse.body, 'social feed signal_min response');
          assertFeedContents(
            signalMinFeed,
            [fixtures.posts.agent1Strong.content, fixtures.posts.agent2Strong.content],
            'social feed signal_min response'
          );

          const signalRangeResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&signal_min=0.5&signal_max=0.7&sort=signal&limit=10`,
            { headers }
          );
          expect(signalRangeResponse.status).toBe(200);
          const signalRangeFeed = assertSuccessEnvelopeArrayData(
            signalRangeResponse.body,
            'social feed signal range response'
          );
          assertFeedContents(
            signalRangeFeed,
            [fixtures.posts.agent2Mid.content],
            'social feed signal range response'
          );

          const invalidSignalRangeResponse = await requestJson(
            server.baseUrl,
            '/api/social/feed?signal_min=0.8&signal_max=0.2',
            { headers }
          );
          expect(invalidSignalRangeResponse.status).toBe(400);
          assertErrorEnvelope(
            invalidSignalRangeResponse.body,
            'SOCIAL_FEED_QUERY_INVALID',
            'invalid social feed signal range'
          );

          const circleResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?circle_id=${fixtures.circleId}&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
            { headers }
          );
          expect(circleResponse.status).toBe(200);
          const circleFeed = assertSuccessEnvelopeArrayData(circleResponse.body, 'social feed circle response');
          assertFeedContents(
            circleFeed,
            [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
            'social feed circle response'
          );

          const cursorPage1Response = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=latest&limit=2`,
            { headers }
          );
          expect(cursorPage1Response.status).toBe(200);
          const cursorPage1Feed = assertSuccessEnvelopeArrayData(cursorPage1Response.body, 'social feed cursor page 1 response');
          assertFeedContents(
            cursorPage1Feed,
            [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
            'social feed cursor page 1 response'
          );
          const cursorPage1Body = cursorPage1Response.body as Record<string, unknown>;
          const page1Meta = cursorPage1Body.meta as Record<string, unknown>;
          const page1Pagination = page1Meta.pagination as Record<string, unknown>;
          expect(page1Pagination.has_next_page).toBe(true);
          expect(typeof page1Pagination.next_cursor).toBe('string');

          const page1Cursor = page1Pagination.next_cursor as string;

          const invalidSortResponse = await requestJson(server.baseUrl, '/api/social/feed?sort=unknown', { headers });
          expect(invalidSortResponse.status).toBe(400);
          assertErrorEnvelope(invalidSortResponse.body, 'SOCIAL_FEED_QUERY_INVALID', 'invalid social feed sort');

          const cursorSortMismatchResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=signal&limit=2&cursor=${encodeURIComponent(page1Cursor)}`,
            { headers }
          );
          expect(cursorSortMismatchResponse.status).toBe(400);
          assertErrorEnvelope(
            cursorSortMismatchResponse.body,
            'SOCIAL_FEED_QUERY_INVALID',
            'cursor sort mismatch'
          );

          const conflictingAuthorAgentResponse = await requestJson(
            server.baseUrl,
            `/api/social/feed?author_id=agent-001&agent_id=agent-002&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}`,
            { headers }
          );
          expect(conflictingAuthorAgentResponse.status).toBe(400);
          assertErrorEnvelope(
            conflictingAuthorAgentResponse.body,
            'SOCIAL_FEED_QUERY_INVALID',
            'conflicting author and agent'
          );

          const invalidLimitResponse = await requestJson(server.baseUrl, '/api/social/feed?limit=abc', { headers });
          expect(invalidLimitResponse.status).toBe(400);
          assertErrorEnvelope(invalidLimitResponse.body, 'SOCIAL_FEED_QUERY_INVALID', 'invalid social feed limit');

          const cursorPage2Response = await requestJson(
            server.baseUrl,
            `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=latest&limit=2&cursor=${encodeURIComponent(page1Cursor)}`,
            { headers }
          );
          expect(cursorPage2Response.status).toBe(200);
          const cursorPage2Feed = assertSuccessEnvelopeArrayData(cursorPage2Response.body, 'social feed cursor page 2 response');
          assertFeedContents(
            cursorPage2Feed,
            [fixtures.posts.agent1Weak.content, fixtures.posts.agent1Strong.content],
            'social feed cursor page 2 response'
          );
          const cursorPage2Body = cursorPage2Response.body as Record<string, unknown>;
          const page2Meta = cursorPage2Body.meta as Record<string, unknown>;
          const page2Pagination = page2Meta.pagination as Record<string, unknown>;
          expect(page2Pagination.has_next_page).toBe(false);
          expect(page2Pagination.next_cursor).toBeNull();

          const invalidCursorResponse = await requestJson(server.baseUrl, '/api/social/feed?cursor=invalid-cursor', { headers });
          expect(invalidCursorResponse.status).toBe(400);
          assertErrorEnvelope(invalidCursorResponse.body, 'SOCIAL_FEED_QUERY_INVALID', 'invalid social feed cursor');
        }
      );
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
