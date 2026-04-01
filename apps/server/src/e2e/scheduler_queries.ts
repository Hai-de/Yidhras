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
    return 3102;
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
  assert('data' in body, 'success response data should exist');
  assert(isRecord(body.data), 'success response data should be object');
  return body.data as Record<string, unknown>;
};

const assertErrorEnvelope = (body: unknown, expectedCode: string) => {
  assert(isRecord(body), 'error response should be object');
  assert(body.success === false, 'error response success should be false');
  assert(isRecord(body.error), 'error response.error should be object');
  assert(body.error.code === expectedCode, `error code should be ${expectedCode}`);
};

const assertPaginationMeta = (body: unknown) => {
  assert(isRecord(body), 'response body should be object');
  assert(isRecord(body.meta), 'response meta should be object');
  assert(isRecord(body.meta.pagination), 'response meta.pagination should be object');
  return body.meta.pagination as Record<string, unknown>;
};

const assertArrayField = (value: Record<string, unknown>, field: string): unknown[] => {
  const result = value[field];
  assert(Array.isArray(result), `${field} should be array`);
  return result;
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const latestRunRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/runs/latest');
    assert(latestRunRes.status === 200, 'GET /api/runtime/scheduler/runs/latest should return 200');
    const latestRunData = assertSuccessEnvelope(latestRunRes.body);
    assert(isRecord(latestRunData.run), 'latest run payload should include run');

    const summaryRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/summary?sample_runs=5');
    assert(summaryRes.status === 200, 'GET /api/runtime/scheduler/summary should return 200');
    const summaryData = assertSuccessEnvelope(summaryRes.body);
    assert(isRecord(summaryData.run_totals), 'scheduler summary should include run_totals');
    assert(Array.isArray(summaryData.top_reasons), 'scheduler summary should include top_reasons');
    assert(Array.isArray(summaryData.top_skipped_reasons), 'scheduler summary should include top_skipped_reasons');
    assert(Array.isArray(summaryData.top_actors), 'scheduler summary should include top_actors');
    assert(Array.isArray(summaryData.intent_class_breakdown), 'scheduler summary should include intent_class_breakdown');

    const trendsRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/trends?sample_runs=5');
    assert(trendsRes.status === 200, 'GET /api/runtime/scheduler/trends should return 200');
    const trendsData = assertSuccessEnvelope(trendsRes.body);
    const trendPoints = assertArrayField(trendsData, 'points');
    assert(trendPoints.every(point => isRecord(point) && typeof point.tick === 'string'), 'scheduler trends points should expose tick strings');

    const runsRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/runs?limit=1');
    assert(runsRes.status === 200, 'GET /api/runtime/scheduler/runs should return 200');
    const runsData = assertSuccessEnvelope(runsRes.body);
    const runsItems = assertArrayField(runsData, 'items');
    assert(isRecord(runsData.page_info), 'scheduler runs page_info should be object');
    assert(isRecord(runsData.summary), 'scheduler runs summary should be object');
    const runsPagination = assertPaginationMeta(runsRes.body);
    assert(typeof runsPagination.has_next_page === 'boolean', 'scheduler runs pagination.has_next_page should be boolean');
    assert(runsItems.length <= 1, 'scheduler runs limit=1 should cap returned items');

    if (runsItems.length > 0) {
      const firstRun = runsItems[0];
      assert(isRecord(firstRun), 'first scheduler run item should be object');
      assert(typeof firstRun.id === 'string', 'scheduler run item id should be string');
      assert(typeof firstRun.tick === 'string', 'scheduler run item tick should be string');

      const runByIdRes = await requestJson(server.baseUrl, `/api/runtime/scheduler/runs/${firstRun.id as string}`);
      assert(runByIdRes.status === 200, 'GET /api/runtime/scheduler/runs/:id should return 200');
      const runByIdData = assertSuccessEnvelope(runByIdRes.body);
      assert(isRecord(runByIdData.run), 'run by id payload should include run');
      assert(Array.isArray(runByIdData.candidates), 'run by id payload should include candidates array');

      const workerId = firstRun.worker_id as string;
      const filteredRunsRes = await requestJson(
        server.baseUrl,
        `/api/runtime/scheduler/runs?worker_id=${encodeURIComponent(workerId)}&limit=5`
      );
      assert(filteredRunsRes.status === 200, 'GET /api/runtime/scheduler/runs with worker_id should return 200');
      const filteredRunsData = assertSuccessEnvelope(filteredRunsRes.body);
      const filteredRunsItems = assertArrayField(filteredRunsData, 'items');
      assert(
        filteredRunsItems.every(item => isRecord(item) && item.worker_id === workerId),
        'filtered scheduler runs should match worker_id'
      );

      const tick = firstRun.tick as string;
      const boundedRunsRes = await requestJson(
        server.baseUrl,
        `/api/runtime/scheduler/runs?from_tick=${tick}&to_tick=${tick}&limit=5`
      );
      assert(boundedRunsRes.status === 200, 'GET /api/runtime/scheduler/runs with tick bounds should return 200');
      const boundedRunsData = assertSuccessEnvelope(boundedRunsRes.body);
      const boundedRunsItems = assertArrayField(boundedRunsData, 'items');
      assert(
        boundedRunsItems.every(item => isRecord(item) && item.tick === tick),
        'bounded scheduler runs should match tick range'
      );

      const nextCursor = (runsData.page_info as Record<string, unknown>).next_cursor;
      if (typeof nextCursor === 'string') {
        const nextRunsRes = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/runs?limit=1&cursor=${encodeURIComponent(nextCursor)}`
        );
        assert(nextRunsRes.status === 200, 'GET /api/runtime/scheduler/runs with cursor should return 200');
      }
    }

    const decisionsRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/decisions?limit=2');
    assert(decisionsRes.status === 200, 'GET /api/runtime/scheduler/decisions should return 200');
    const decisionsData = assertSuccessEnvelope(decisionsRes.body);
    const decisionItems = assertArrayField(decisionsData, 'items');
    assert(isRecord(decisionsData.page_info), 'scheduler decisions page_info should be object');
    assert(isRecord(decisionsData.summary), 'scheduler decisions summary should be object');
    const decisionsPagination = assertPaginationMeta(decisionsRes.body);
    assert(typeof decisionsPagination.has_next_page === 'boolean', 'scheduler decisions pagination.has_next_page should be boolean');
    assert(decisionItems.length <= 2, 'scheduler decisions limit=2 should cap returned items');

    if (decisionItems.length > 0) {
      const firstDecision = decisionItems[0];
      assert(isRecord(firstDecision), 'first scheduler decision item should be object');
      assert(typeof firstDecision.actor_id === 'string', 'scheduler decision actor_id should be string');
      assert(typeof firstDecision.kind === 'string', 'scheduler decision kind should be string');
      assert(typeof firstDecision.chosen_reason === 'string', 'scheduler decision chosen_reason should be string');
      assert(typeof firstDecision.scheduled_for_tick === 'string', 'scheduler decision scheduled_for_tick should be string');

      const actorId = firstDecision.actor_id as string;
      const actorDecisionsRes = await requestJson(
        server.baseUrl,
        `/api/runtime/scheduler/decisions?actor_id=${encodeURIComponent(actorId)}&limit=10`
      );
      assert(actorDecisionsRes.status === 200, 'GET /api/runtime/scheduler/decisions with actor_id should return 200');
      const actorDecisionsData = assertSuccessEnvelope(actorDecisionsRes.body);
      const actorDecisionItems = assertArrayField(actorDecisionsData, 'items');
      assert(
        actorDecisionItems.every(item => isRecord(item) && item.actor_id === actorId),
        'filtered scheduler decisions should match actor_id'
      );

      const kind = firstDecision.kind as string;
      const reason = firstDecision.chosen_reason as string;
      const filteredDecisionRes = await requestJson(
        server.baseUrl,
        `/api/runtime/scheduler/decisions?kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(reason)}&limit=10`
      );
      assert(filteredDecisionRes.status === 200, 'GET /api/runtime/scheduler/decisions with kind/reason should return 200');
      const filteredDecisionData = assertSuccessEnvelope(filteredDecisionRes.body);
      const filteredDecisionItems = assertArrayField(filteredDecisionData, 'items');
      assert(
        filteredDecisionItems.every(item => isRecord(item) && item.kind === kind && item.chosen_reason === reason),
        'filtered scheduler decisions should match kind and reason'
      );

      const scheduledForTick = firstDecision.scheduled_for_tick as string;
      const rangedDecisionRes = await requestJson(
        server.baseUrl,
        `/api/runtime/scheduler/decisions?from_tick=${scheduledForTick}&to_tick=${scheduledForTick}&limit=10`
      );
      assert(rangedDecisionRes.status === 200, 'GET /api/runtime/scheduler/decisions with tick bounds should return 200');
      const rangedDecisionData = assertSuccessEnvelope(rangedDecisionRes.body);
      const rangedDecisionItems = assertArrayField(rangedDecisionData, 'items');
      assert(
        rangedDecisionItems.every(item => isRecord(item) && item.scheduled_for_tick === scheduledForTick),
        'bounded scheduler decisions should match scheduled_for_tick'
      );

      const nextCursor = (decisionsData.page_info as Record<string, unknown>).next_cursor;
      if (typeof nextCursor === 'string') {
        const nextDecisionsRes = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/decisions?limit=2&cursor=${encodeURIComponent(nextCursor)}`
        );
        assert(nextDecisionsRes.status === 200, 'GET /api/runtime/scheduler/decisions with cursor should return 200');
      }
    }

    const invalidRunCursorRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/runs?cursor=invalid-cursor');
    assert(invalidRunCursorRes.status === 400, 'invalid scheduler runs cursor should return 400');
    assertErrorEnvelope(invalidRunCursorRes.body, 'SCHEDULER_QUERY_INVALID');

    const invalidDecisionRangeRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/decisions?from_tick=10&to_tick=1');
    assert(invalidDecisionRangeRes.status === 400, 'invalid scheduler decisions tick range should return 400');
    assertErrorEnvelope(invalidDecisionRangeRes.body, 'SCHEDULER_QUERY_INVALID');

    const invalidDecisionKindRes = await requestJson(server.baseUrl, '/api/runtime/scheduler/decisions?kind=unknown-kind');
    assert(invalidDecisionKindRes.status === 400, 'invalid scheduler decisions kind should return 400');
    assertErrorEnvelope(invalidDecisionKindRes.body, 'SCHEDULER_QUERY_INVALID');

    console.log('[scheduler_queries] PASS');
  } catch (error: unknown) {
    console.error('[scheduler_queries] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
