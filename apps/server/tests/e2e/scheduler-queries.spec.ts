import { describe, expect, it } from 'vitest';

import {
  assertArrayField,
  assertErrorEnvelope,
  assertPaginationMeta,
  assertRecord,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson, sleep, summarizeResponse } from '../helpers/server.js';

const waitForLatestSchedulerRun = async (baseUrl: string): Promise<Record<string, unknown>> => {
  let lastResponse: Awaited<ReturnType<typeof requestJson>> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const response = await requestJson(baseUrl, '/api/runtime/scheduler/runs/latest');
    lastResponse = response;

    if (response.status !== 200) {
      await sleep(250);
      continue;
    }

    const envelope = assertRecord(response.body, 'latest scheduler run envelope');
    if (envelope.success === true && isRecord(envelope.data)) {
      return envelope.data;
    }

    await sleep(250);
  }

  throw new Error(
    lastResponse
      ? summarizeResponse('/api/runtime/scheduler/runs/latest', lastResponse)
      : 'latest scheduler run never became available'
  );
};

describe('scheduler queries e2e', () => {
  it('serves scheduler observability endpoints and rejects invalid query shapes', async () => {
    await withIsolatedTestServer({
      defaultPort: 3102,
      activePackRef: 'example_pack',
      seededPackRefs: ['example_pack']
    }, async server => {
      const latestRunData = await waitForLatestSchedulerRun(server.baseUrl);
      const latestRun = assertRecord(latestRunData.run, 'latest run payload');
      expect(typeof latestRun.partition_id).toBe('string');
      expect(typeof latestRun.worker_id).toBe('string');

      const summaryResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/summary?sample_runs=5');
      expect(summaryResponse.status).toBe(200);
      const summaryData = assertSuccessEnvelopeData(summaryResponse.body, 'scheduler summary');
      expect(isRecord(summaryData.run_totals)).toBe(true);
      expect(Array.isArray(summaryData.top_reasons)).toBe(true);
      expect(Array.isArray(summaryData.top_skipped_reasons)).toBe(true);
      expect(Array.isArray(summaryData.top_actors)).toBe(true);
      expect(Array.isArray(summaryData.top_partitions)).toBe(true);
      expect(Array.isArray(summaryData.top_workers)).toBe(true);
      expect(Array.isArray(summaryData.intent_class_breakdown)).toBe(true);

      const trendsResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/trends?sample_runs=5');
      expect(trendsResponse.status).toBe(200);
      const trendsData = assertSuccessEnvelopeData(trendsResponse.body, 'scheduler trends');
      const trendPoints = assertArrayField(trendsData, 'points', 'scheduler trends');
      expect(
        trendPoints.every(
          point =>
            isRecord(point) &&
            typeof point.tick === 'string' &&
            typeof point.partition_id === 'string' &&
            typeof point.worker_id === 'string' &&
            isRecord(point.skipped_by_reason)
        )
      ).toBe(true);

      const operatorResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/operator?sample_runs=5&recent_limit=5');
      expect(operatorResponse.status).toBe(200);
      const operatorData = assertSuccessEnvelopeData(operatorResponse.body, 'scheduler operator');
      expect(isRecord(operatorData.summary)).toBe(true);
      expect(isRecord(operatorData.highlights)).toBe(true);

      const runsResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/runs?limit=1');
      expect(runsResponse.status).toBe(200);
      const runsData = assertSuccessEnvelopeData(runsResponse.body, 'scheduler runs');
      const runsItems = assertArrayField(runsData, 'items', 'scheduler runs');
      expect(isRecord(runsData.page_info)).toBe(true);
      expect(isRecord(runsData.summary)).toBe(true);
      const runsPagination = assertPaginationMeta(runsResponse.body, 'scheduler runs');
      expect(typeof runsPagination.has_next_page).toBe('boolean');
      expect(runsItems.length <= 1).toBe(true);

      if (runsItems.length > 0) {
        const firstRun = assertRecord(runsItems[0], 'first scheduler run');
        expect(typeof firstRun.id).toBe('string');
        expect(typeof firstRun.tick).toBe('string');
        expect(typeof firstRun.partition_id).toBe('string');

        const runByIdResponse = await requestJson(server.baseUrl, `/api/runtime/scheduler/runs/${firstRun.id as string}`);
        expect(runByIdResponse.status).toBe(200);
        const runByIdData = assertSuccessEnvelopeData(runByIdResponse.body, 'scheduler run by id');
        expect(isRecord(runByIdData.run)).toBe(true);
        expect(Array.isArray(runByIdData.candidates)).toBe(true);

        const workerId = firstRun.worker_id as string;
        const filteredRunsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/runs?worker_id=${encodeURIComponent(workerId)}&limit=5`
        );
        expect(filteredRunsResponse.status).toBe(200);
        const filteredRunsData = assertSuccessEnvelopeData(filteredRunsResponse.body, 'scheduler runs filtered by worker');
        const filteredRunsItems = assertArrayField(filteredRunsData, 'items', 'scheduler runs filtered by worker');
        expect(filteredRunsItems.every(item => isRecord(item) && item.worker_id === workerId)).toBe(true);

        const partitionId = firstRun.partition_id as string;
        const partitionRunsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/runs?partition_id=${encodeURIComponent(partitionId)}&limit=5`
        );
        expect(partitionRunsResponse.status).toBe(200);
        const partitionRunsData = assertSuccessEnvelopeData(partitionRunsResponse.body, 'scheduler runs filtered by partition');
        const partitionRunsItems = assertArrayField(partitionRunsData, 'items', 'scheduler runs filtered by partition');
        expect(partitionRunsItems.every(item => isRecord(item) && item.partition_id === partitionId)).toBe(true);

        const tick = firstRun.tick as string;
        const boundedRunsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/runs?from_tick=${tick}&to_tick=${tick}&limit=5`
        );
        expect(boundedRunsResponse.status).toBe(200);
        const boundedRunsData = assertSuccessEnvelopeData(boundedRunsResponse.body, 'scheduler runs bounded by tick');
        const boundedRunsItems = assertArrayField(boundedRunsData, 'items', 'scheduler runs bounded by tick');
        expect(boundedRunsItems.every(item => isRecord(item) && item.tick === tick)).toBe(true);

        const nextCursor = (runsData.page_info as Record<string, unknown>).next_cursor;
        if (typeof nextCursor === 'string') {
          const nextRunsResponse = await requestJson(
            server.baseUrl,
            `/api/runtime/scheduler/runs?limit=1&cursor=${encodeURIComponent(nextCursor)}`
          );
          expect(nextRunsResponse.status).toBe(200);
        }
      }

      const decisionsResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/decisions?limit=2');
      expect(decisionsResponse.status).toBe(200);
      const decisionsData = assertSuccessEnvelopeData(decisionsResponse.body, 'scheduler decisions');
      const decisionItems = assertArrayField(decisionsData, 'items', 'scheduler decisions');
      expect(isRecord(decisionsData.page_info)).toBe(true);
      expect(isRecord(decisionsData.summary)).toBe(true);
      const decisionsPagination = assertPaginationMeta(decisionsResponse.body, 'scheduler decisions');
      expect(typeof decisionsPagination.has_next_page).toBe('boolean');
      expect(decisionItems.length <= 2).toBe(true);

      if (decisionItems.length > 0) {
        const firstDecision = assertRecord(decisionItems[0], 'first scheduler decision');
        expect(typeof firstDecision.actor_id).toBe('string');
        expect(typeof firstDecision.kind).toBe('string');
        expect(typeof firstDecision.chosen_reason).toBe('string');
        expect(typeof firstDecision.scheduled_for_tick).toBe('string');
        expect(typeof firstDecision.partition_id).toBe('string');

        const actorId = firstDecision.actor_id as string;
        const actorDecisionsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/decisions?actor_id=${encodeURIComponent(actorId)}&limit=10`
        );
        expect(actorDecisionsResponse.status).toBe(200);
        const actorDecisionsData = assertSuccessEnvelopeData(actorDecisionsResponse.body, 'scheduler decisions filtered by actor');
        const actorDecisionItems = assertArrayField(actorDecisionsData, 'items', 'scheduler decisions filtered by actor');
        expect(actorDecisionItems.every(item => isRecord(item) && item.actor_id === actorId)).toBe(true);

        const kind = firstDecision.kind as string;
        const reason = firstDecision.chosen_reason as string;
        const filteredDecisionsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/decisions?kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(reason)}&limit=10`
        );
        expect(filteredDecisionsResponse.status).toBe(200);
        const filteredDecisionsData = assertSuccessEnvelopeData(
          filteredDecisionsResponse.body,
          'scheduler decisions filtered by kind and reason'
        );
        const filteredDecisionItems = assertArrayField(
          filteredDecisionsData,
          'items',
          'scheduler decisions filtered by kind and reason'
        );
        expect(
          filteredDecisionItems.every(item => isRecord(item) && item.kind === kind && item.chosen_reason === reason)
        ).toBe(true);

        const partitionId = firstDecision.partition_id as string;
        const partitionDecisionsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/decisions?partition_id=${encodeURIComponent(partitionId)}&limit=10`
        );
        expect(partitionDecisionsResponse.status).toBe(200);
        const partitionDecisionsData = assertSuccessEnvelopeData(
          partitionDecisionsResponse.body,
          'scheduler decisions filtered by partition'
        );
        const partitionDecisionItems = assertArrayField(
          partitionDecisionsData,
          'items',
          'scheduler decisions filtered by partition'
        );
        expect(partitionDecisionItems.every(item => isRecord(item) && item.partition_id === partitionId)).toBe(true);

        const scheduledForTick = firstDecision.scheduled_for_tick as string;
        const rangedDecisionsResponse = await requestJson(
          server.baseUrl,
          `/api/runtime/scheduler/decisions?from_tick=${scheduledForTick}&to_tick=${scheduledForTick}&limit=10`
        );
        expect(rangedDecisionsResponse.status).toBe(200);
        const rangedDecisionsData = assertSuccessEnvelopeData(
          rangedDecisionsResponse.body,
          'scheduler decisions bounded by tick'
        );
        const rangedDecisionItems = assertArrayField(
          rangedDecisionsData,
          'items',
          'scheduler decisions bounded by tick'
        );
        expect(rangedDecisionItems.every(item => isRecord(item) && item.scheduled_for_tick === scheduledForTick)).toBe(true);

        const nextCursor = (decisionsData.page_info as Record<string, unknown>).next_cursor;
        if (typeof nextCursor === 'string') {
          const nextDecisionsResponse = await requestJson(
            server.baseUrl,
            `/api/runtime/scheduler/decisions?limit=2&cursor=${encodeURIComponent(nextCursor)}`
          );
          expect(nextDecisionsResponse.status).toBe(200);
        }
      }

      const ownershipResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/ownership');
      expect(ownershipResponse.status).toBe(200);
      const ownershipData = assertSuccessEnvelopeData(ownershipResponse.body, 'scheduler ownership');
      const ownershipItems = assertArrayField(ownershipData, 'items', 'scheduler ownership');
      expect(isRecord(ownershipData.summary)).toBe(true);
      expect(
        ownershipItems.every(item => isRecord(item) && typeof item.partition_id === 'string' && 'latest_migration' in item)
      ).toBe(true);

      const migrationsResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/migrations?limit=5');
      expect(migrationsResponse.status).toBe(200);
      const migrationsData = assertSuccessEnvelopeData(migrationsResponse.body, 'scheduler migrations');
      const migrationItems = assertArrayField(migrationsData, 'items', 'scheduler migrations');
      expect(isRecord(migrationsData.summary)).toBe(true);
      expect(
        migrationItems.every(
          item =>
            isRecord(item) &&
            typeof item.partition_id === 'string' &&
            typeof item.to_worker_id === 'string' &&
            typeof item.status === 'string'
        )
      ).toBe(true);

      const workersResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/workers');
      expect(workersResponse.status).toBe(200);
      const workersData = assertSuccessEnvelopeData(workersResponse.body, 'scheduler workers');
      const workerItems = assertArrayField(workersData, 'items', 'scheduler workers');
      expect(isRecord(workersData.summary)).toBe(true);
      expect(
        workerItems.every(
          item =>
            isRecord(item) &&
            typeof item.worker_id === 'string' &&
            typeof item.status === 'string' &&
            typeof item.last_heartbeat_at === 'string'
        )
      ).toBe(true);

      const rebalanceResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/rebalance/recommendations?limit=5'
      );
      expect(rebalanceResponse.status).toBe(200);
      const rebalanceData = assertSuccessEnvelopeData(rebalanceResponse.body, 'scheduler rebalance recommendations');
      const rebalanceItems = assertArrayField(rebalanceData, 'items', 'scheduler rebalance recommendations');
      expect(isRecord(rebalanceData.summary)).toBe(true);
      expect(
        rebalanceItems.every(
          item =>
            isRecord(item) &&
            typeof item.partition_id === 'string' &&
            typeof item.status === 'string' &&
            typeof item.reason === 'string'
        )
      ).toBe(true);

      const invalidRunCursorResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/runs?cursor=invalid-cursor'
      );
      expect(invalidRunCursorResponse.status).toBe(400);
      assertErrorEnvelope(invalidRunCursorResponse.body, 'SCHEDULER_QUERY_INVALID', 'invalid scheduler run cursor');

      const invalidDecisionRangeResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/decisions?from_tick=10&to_tick=1'
      );
      expect(invalidDecisionRangeResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidDecisionRangeResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler decision range'
      );

      const invalidDecisionKindResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/decisions?kind=unknown-kind'
      );
      expect(invalidDecisionKindResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidDecisionKindResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler decision kind'
      );

      const invalidSummarySampleRunsResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/summary?sample_runs=abc'
      );
      expect(invalidSummarySampleRunsResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidSummarySampleRunsResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler summary sample_runs'
      );

      const invalidTrendsSampleRunsResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/trends?sample_runs=abc'
      );
      expect(invalidTrendsSampleRunsResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidTrendsSampleRunsResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler trends sample_runs'
      );

      const invalidOperatorSampleRunsResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/operator?sample_runs=abc'
      );
      expect(invalidOperatorSampleRunsResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidOperatorSampleRunsResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler operator sample_runs'
      );

      const invalidOperatorRecentLimitResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/operator?recent_limit=abc'
      );
      expect(invalidOperatorRecentLimitResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidOperatorRecentLimitResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler operator recent_limit'
      );

      const invalidOwnershipStatusResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/ownership?status=bad-status'
      );
      expect(invalidOwnershipStatusResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidOwnershipStatusResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler ownership status'
      );

      const invalidMigrationStatusResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/migrations?status=bad-status'
      );
      expect(invalidMigrationStatusResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidMigrationStatusResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler migration status'
      );

      const invalidWorkerStatusResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/workers?status=bad-status'
      );
      expect(invalidWorkerStatusResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidWorkerStatusResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler worker status'
      );

      const invalidRebalanceStatusResponse = await requestJson(
        server.baseUrl,
        '/api/runtime/scheduler/rebalance/recommendations?status=bad-status'
      );
      expect(invalidRebalanceStatusResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidRebalanceStatusResponse.body,
        'SCHEDULER_QUERY_INVALID',
        'invalid scheduler rebalance status'
      );

      const invalidRunIdResponse = await requestJson(server.baseUrl, '/api/runtime/scheduler/runs/%20%20');
      expect(invalidRunIdResponse.status).toBe(400);
      assertErrorEnvelope(invalidRunIdResponse.body, 'SCHEDULER_QUERY_INVALID', 'blank scheduler run id');
    });
  });
});
