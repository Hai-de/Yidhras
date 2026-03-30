import { Prisma, PrismaClient } from '@prisma/client';

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
  created_at: tick,
  updated_at: tick
});

const prepareSocialFeedFixtures = async (runId: string, baseTick: bigint) => {
  const prisma = new PrismaClient();

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

  try {
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

    await prisma.post.create({
      data: fixtures.posts.agent1Strong
    });
    await prisma.post.create({
      data: fixtures.posts.agent1Weak
    });
    await prisma.post.create({
      data: fixtures.posts.agent2Strong
    });
    await prisma.post.create({
      data: fixtures.posts.agent2Mid
    });
  } finally {
    await prisma.$disconnect();
  }

  return fixtures;
};

const assertSuccessEnvelopeArrayData = (body: unknown, label: string): Record<string, unknown>[] => {
  assert(isRecord(body), `${label} should return envelope object`);
  assert(body.success === true, `${label} success should be true`);
  assert(isRecord(body.meta), `${label}.meta should be object`);
  assert(isRecord(body.meta.pagination), `${label}.meta.pagination should be object`);
  assert(Array.isArray(body.data), `${label}.data should be array`);
  return body.data as Record<string, unknown>[];
};

const assertFeedContents = (value: unknown, expectedContents: string[], label: string): Record<string, unknown>[] => {
  assert(Array.isArray(value), `${label} should be array`);
  const items = value as Record<string, unknown>[];
  assert(items.length === expectedContents.length, `${label} length should be ${expectedContents.length}`);

  const contents = items.map(item => {
    assert(isRecord(item), `${label} item should be object`);
    assert(typeof item.content === 'string', `${label} item.content should be string`);
    return item.content;
  });

  assert(
    JSON.stringify(contents) === JSON.stringify(expectedContents),
    `${label} contents mismatch: expected ${JSON.stringify(expectedContents)}, got ${JSON.stringify(contents)}`
  );

  return items;
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'social feed filters test requires runtime_ready=true');

    const runId = `${Date.now()}`;
    const baseTick = 8000000000000000n + BigInt(runId);
    const fixtures = await prepareSocialFeedFixtures(runId, baseTick);
    const headers = {
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const latestRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=latest&limit=10`,
      { headers }
    );
    assert(latestRes.status === 200, 'GET /api/social/feed latest should return 200');
    const latestFeed = assertSuccessEnvelopeArrayData(latestRes.body, 'social feed latest response');
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

    const authorRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?author_id=agent-001&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
      { headers }
    );
    assert(authorRes.status === 200, 'GET /api/social/feed?author_id should return 200');
    const authorFeed = assertSuccessEnvelopeArrayData(authorRes.body, 'social feed author filter response');
    const authorItems = assertFeedContents(
      authorFeed,
      [fixtures.posts.agent1Weak.content, fixtures.posts.agent1Strong.content],
      'social feed author filter response'
    );
    assert(
      authorItems.every(item => item.author_id === 'agent-001'),
      'social feed author filter should only include agent-001 authored posts'
    );

    const agentRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?agent_id=agent-002&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
      { headers }
    );
    assert(agentRes.status === 200, 'GET /api/social/feed?agent_id should return 200');
    const agentFeed = assertSuccessEnvelopeArrayData(agentRes.body, 'social feed agent filter response');
    const agentItems = assertFeedContents(
      agentFeed,
      [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
      'social feed agent filter response'
    );
    assert(
      agentItems.every(item => item.author_id === 'agent-002'),
      'social feed agent filter should only include agent-002 authored posts'
    );

    const sourceIntentRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?source_action_intent_id=${fixtures.intentAId}&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
      { headers }
    );
    assert(sourceIntentRes.status === 200, 'GET /api/social/feed?source_action_intent_id should return 200');
    const sourceIntentFeed = assertSuccessEnvelopeArrayData(sourceIntentRes.body, 'social feed intent filter response');
    assertFeedContents(
      sourceIntentFeed,
      [fixtures.posts.agent1Strong.content],
      'social feed intent filter response'
    );

    const rangeRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${(fixtures.baseTick + 15n).toString()}&to_tick=${(fixtures.baseTick + 35n).toString()}&limit=10`,
      { headers }
    );
    assert(rangeRes.status === 200, 'GET /api/social/feed with tick range should return 200');
    const rangeFeed = assertSuccessEnvelopeArrayData(rangeRes.body, 'social feed range response');
    const rangeItems = assertFeedContents(
      rangeFeed,
      [fixtures.posts.agent2Strong.content, fixtures.posts.agent1Weak.content],
      'social feed range response'
    );
    assert(
      rangeItems.every(item => {
        assert(typeof item.created_at === 'string', 'social feed range item.created_at should be string');
        const tick = BigInt(item.created_at);
        return tick >= fixtures.baseTick + 15n && tick <= fixtures.baseTick + 35n;
      }),
      'social feed range response should respect from_tick/to_tick bounds'
    );

    const limitRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=2`,
      { headers }
    );
    assert(limitRes.status === 200, 'GET /api/social/feed?limit=2 should return 200');
    const limitFeed = assertSuccessEnvelopeArrayData(limitRes.body, 'social feed limit response');
    assertFeedContents(
      limitFeed,
      [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
      'social feed limit response'
    );

    const signalRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=signal&limit=10`,
      { headers }
    );
    assert(signalRes.status === 200, 'GET /api/social/feed?sort=signal should return 200');
    const signalFeed = assertSuccessEnvelopeArrayData(signalRes.body, 'social feed signal response');
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

    const keywordRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?keyword=${encodeURIComponent(`${runId}-agent-002`)}&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
      { headers }
    );
    assert(keywordRes.status === 200, 'GET /api/social/feed?keyword should return 200');
    const keywordFeed = assertSuccessEnvelopeArrayData(keywordRes.body, 'social feed keyword response');
    assertFeedContents(
      keywordFeed,
      [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
      'social feed keyword response'
    );

    const signalMinRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&signal_min=0.7&sort=signal&limit=10`,
      { headers }
    );
    assert(signalMinRes.status === 200, 'GET /api/social/feed?signal_min should return 200');
    const signalMinFeed = assertSuccessEnvelopeArrayData(signalMinRes.body, 'social feed signal_min response');
    assertFeedContents(
      signalMinFeed,
      [fixtures.posts.agent1Strong.content, fixtures.posts.agent2Strong.content],
      'social feed signal_min response'
    );

    const signalRangeRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&signal_min=0.5&signal_max=0.7&sort=signal&limit=10`,
      { headers }
    );
    assert(signalRangeRes.status === 200, 'GET /api/social/feed?signal_min&signal_max should return 200');
    const signalRangeFeed = assertSuccessEnvelopeArrayData(signalRangeRes.body, 'social feed signal range response');
    assertFeedContents(
      signalRangeFeed,
      [fixtures.posts.agent2Mid.content],
      'social feed signal range response'
    );

    const invalidSignalRangeRes = await requestJson(server.baseUrl, '/api/social/feed?signal_min=0.8&signal_max=0.2', { headers });
    assert(invalidSignalRangeRes.status === 400, 'GET /api/social/feed with invalid signal range should return 400');
    assert(isRecord(invalidSignalRangeRes.body), 'invalid social feed signal range response should be object');
    assert(invalidSignalRangeRes.body.success === false, 'invalid social feed signal range response success should be false');

    const circleRes = await requestJson(
      server.baseUrl,
      `/api/social/feed?circle_id=${fixtures.circleId}&from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&limit=10`,
      { headers }
    );
    assert(circleRes.status === 200, 'GET /api/social/feed?circle_id should return 200');
    const circleFeed = assertSuccessEnvelopeArrayData(circleRes.body, 'social feed circle response');
    assertFeedContents(
      circleFeed,
      [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content],
      'social feed circle response'
    );

    const cursorPage1Res = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=latest&limit=2`,
      { headers }
    );
    assert(cursorPage1Res.status === 200, 'GET /api/social/feed first cursor page should return 200');
    const cursorPage1Feed = assertSuccessEnvelopeArrayData(cursorPage1Res.body, 'social feed cursor page 1 response');
    assertFeedContents(cursorPage1Feed, [fixtures.posts.agent2Mid.content, fixtures.posts.agent2Strong.content], 'social feed cursor page 1 response');
    const cursorPage1Body = cursorPage1Res.body as Record<string, unknown>;
    const page1Meta = cursorPage1Body.meta as Record<string, unknown>;
    const page1Pagination = page1Meta.pagination as Record<string, unknown>;
    assert(page1Pagination.has_next_page === true, 'social feed cursor page 1 should report has_next_page=true');
    assert(typeof page1Pagination.next_cursor === 'string', 'social feed cursor page 1 next_cursor should be string');

    const page1Cursor = page1Pagination.next_cursor as string;

    const invalidSortRes = await requestJson(server.baseUrl, '/api/social/feed?sort=unknown', { headers });
    assert(invalidSortRes.status === 400, 'GET /api/social/feed with invalid sort should return 400');
    assert(isRecord(invalidSortRes.body), 'invalid social feed sort response should be object');
    assert(invalidSortRes.body.success === false, 'invalid social feed sort response success should be false');

    const cursorPage2Res = await requestJson(
      server.baseUrl,
      `/api/social/feed?from_tick=${fixtures.minTick.toString()}&to_tick=${fixtures.maxTick.toString()}&sort=latest&limit=2&cursor=${encodeURIComponent(page1Cursor)}`,
      { headers }
    );
    assert(cursorPage2Res.status === 200, 'GET /api/social/feed second cursor page should return 200');
    const cursorPage2Feed = assertSuccessEnvelopeArrayData(cursorPage2Res.body, 'social feed cursor page 2 response');
    assertFeedContents(cursorPage2Feed, [fixtures.posts.agent1Weak.content, fixtures.posts.agent1Strong.content], 'social feed cursor page 2 response');
    const cursorPage2Body = cursorPage2Res.body as Record<string, unknown>;
    const page2Meta = cursorPage2Body.meta as Record<string, unknown>;
    const page2Pagination = page2Meta.pagination as Record<string, unknown>;
    assert(page2Pagination.has_next_page === false, 'social feed cursor page 2 should report has_next_page=false');
    assert(page2Pagination.next_cursor === null, 'social feed cursor page 2 next_cursor should be null');

    const invalidCursorRes = await requestJson(server.baseUrl, '/api/social/feed?cursor=invalid-cursor', { headers });
    assert(invalidCursorRes.status === 400, 'GET /api/social/feed with invalid cursor should return 400');
    assert(isRecord(invalidCursorRes.body), 'invalid social feed cursor response should be object');
    assert(invalidCursorRes.body.success === false, 'invalid social feed cursor response success should be false');

    console.log('[social_feed_filters] PASS');
  } catch (error: unknown) {
    console.error('[social_feed_filters] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling social_feed_filters failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
