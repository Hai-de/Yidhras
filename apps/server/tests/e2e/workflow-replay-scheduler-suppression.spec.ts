import { describe, expect, it } from 'vitest';

import { assertArrayField, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
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

const pollJobUntil = async (
  baseUrl: string,
  jobId: string,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const jobResponse = await requestJson(baseUrl, `/api/inference/jobs/${jobId}`);
    expect(jobResponse.status).toBe(200);
    const jobData = assertSuccessEnvelopeData(jobResponse.body, label);
    lastData = jobData;
    if (predicate(jobData)) {
      return jobData;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const clearSchedulerPendingBaseline = async (
  prisma: ReturnType<typeof createPrismaClientForEnvironment>,
  agentId: string
): Promise<void> => {
  await prisma.actionIntent.deleteMany({
    where: {
      status: {
        in: ['pending', 'dispatching']
      },
      source_inference_id: {
        startsWith: 'sch:'
      }
    }
  });

  await prisma.decisionJob.deleteMany({
    where: {
      status: {
        in: ['pending', 'running']
      },
      idempotency_key: {
        startsWith: `sch:${agentId}:`
      }
    }
  });
};

const pollReplaySchedulerSuppression = async (
  baseUrl: string,
  input: {
    actorId: string;
    fromTick: string;
    skippedReason: 'replay_window_periodic_suppressed';
  }
): Promise<{
  decisionsData: Record<string, unknown>;
  items: Record<string, unknown>[];
  summaryData: Record<string, unknown> | null;
}> => {
  const query = new URLSearchParams({
    actor_id: input.actorId,
    skipped_reason: input.skippedReason,
    from_tick: input.fromTick,
    limit: '20'
  });

  let lastSummaryData: Record<string, unknown> | null = null;
  let lastDecisionsData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const decisionsResponse = await requestJson(baseUrl, `/api/runtime/scheduler/decisions?${query.toString()}`);
    expect(decisionsResponse.status).toBe(200);
    const decisionsData = assertSuccessEnvelopeData(decisionsResponse.body, 'scheduler decisions poll');
    const items = assertArrayField(decisionsData, 'items', 'scheduler decisions poll').filter(isRecord);
    lastDecisionsData = decisionsData;

    if (attempt % 3 === 0 || items.length > 0) {
      const summaryResponse = await requestJson(baseUrl, '/api/runtime/scheduler/summary?sample_runs=10');
      expect(summaryResponse.status).toBe(200);
      lastSummaryData = assertSuccessEnvelopeData(summaryResponse.body, 'scheduler summary poll');
    }

    if (items.length > 0) {
      return {
        decisionsData,
        items,
        summaryData: lastSummaryData
      };
    }

    await sleep(500);
  }

  throw new Error(
    `replay scheduler suppression evidence not observed: ${JSON.stringify({
      decisions: lastDecisionsData,
      summary: lastSummaryData
    })}`
  );
};

describe('workflow replay scheduler suppression e2e', () => {
  it('surfaces replay_window_periodic_suppressed decisions after a replay recovery job completes', async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);

      await withTestServer(
        {
          defaultPort: 3115,
          envOverrides: environment.envOverrides,
          prepareRuntime: false
        },
        async server => {
          const statusResponse = await requestJson(server.baseUrl, '/api/status');
          expect(statusResponse.status).toBe(200);
          const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
          expect(statusData.runtime_ready).toBe(true);

          const agentId = 'agent-001';
          const headers = {
            'Content-Type': 'application/json',
            'x-m2-identity': createIdentityHeader(agentId, 'agent')
          };

          await clearSchedulerPendingBaseline(prisma, agentId);

          const baseKey = `workflow-replay-scheduler-base-${Date.now()}`;
          const baseSubmitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              agent_id: agentId,
              identity_id: agentId,
              strategy: 'rule_based',
              idempotency_key: baseKey
            })
          });
          expect(baseSubmitResponse.status).toBe(200);
          const baseSubmitData = assertSuccessEnvelopeData(baseSubmitResponse.body, 'base workflow submit response');
          const baseJob = assertRecord(baseSubmitData.job, 'base workflow submit job');

          const settledBaseJob = await pollJobUntil(
            server.baseUrl,
            baseJob.id as string,
            data => data.status === 'completed',
            'base workflow completion poll'
          );
          expect(settledBaseJob.intent_class).toBe('direct_inference');

          const replayReason = 'workflow replay -> scheduler suppression verification';
          const replaySubmitResponse = await requestJson(
            server.baseUrl,
            `/api/inference/jobs/${baseJob.id as string}/replay`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                reason: replayReason,
                overrides: {
                  strategy: 'mock',
                  attributes: {
                    mock_content: `workflow replay scheduler suppression ${Date.now()}`
                  }
                }
              })
            }
          );
          expect(replaySubmitResponse.status).toBe(200);
          const replaySubmitData = assertSuccessEnvelopeData(replaySubmitResponse.body, 'workflow replay submit response');
          const replayJob = assertRecord(replaySubmitData.job, 'workflow replay submit job');
          const replayMetadata = assertRecord(replaySubmitData.replay, 'workflow replay submit metadata');
          expect(replayJob.intent_class).toBe('replay_recovery');
          expect(replayMetadata.reason).toBe(replayReason);

          const settledReplayJob = await pollJobUntil(
            server.baseUrl,
            replayJob.id as string,
            data => data.status === 'completed',
            'workflow replay completion poll'
          );
          expect(settledReplayJob.intent_class).toBe('replay_recovery');
          expect(typeof settledReplayJob.created_at).toBe('string');

          await clearSchedulerPendingBaseline(prisma, agentId);

          const suppressionEvidence = await pollReplaySchedulerSuppression(server.baseUrl, {
            actorId: agentId,
            fromTick: settledReplayJob.created_at as string,
            skippedReason: 'replay_window_periodic_suppressed'
          });
          const firstSuppressionDecision = suppressionEvidence.items[0];
          expect(firstSuppressionDecision).toBeDefined();
          expect(firstSuppressionDecision?.actor_id).toBe(agentId);
          expect(firstSuppressionDecision?.skipped_reason).toBe('replay_window_periodic_suppressed');
          expect(typeof firstSuppressionDecision?.scheduler_run_id).toBe('string');

          const runReadResponse = await requestJson(
            server.baseUrl,
            `/api/runtime/scheduler/runs/${encodeURIComponent(firstSuppressionDecision?.scheduler_run_id as string)}`
          );
          expect(runReadResponse.status).toBe(200);
          const runReadData = assertSuccessEnvelopeData(runReadResponse.body, 'scheduler run read');
          const candidates = assertArrayField(runReadData, 'candidates', 'scheduler run read').filter(isRecord);
          expect(
            candidates.some(
              candidate =>
                candidate.actor_id === agentId &&
                candidate.skipped_reason === 'replay_window_periodic_suppressed'
            )
          ).toBe(true);

          if (suppressionEvidence.summaryData) {
            const topSkippedReasons = assertArrayField(
              suppressionEvidence.summaryData,
              'top_skipped_reasons',
              'scheduler summary read'
            ).filter(isRecord);
            expect(
              topSkippedReasons.some(item => item.skipped_reason === 'replay_window_periodic_suppressed')
            ).toBe(true);
          }
        }
      );
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
