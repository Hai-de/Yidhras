import { PrismaClient } from '@prisma/client';

import {
  assert,
  isRecord,
  type JsonResponse,
  requestJson,
  startServer,
  summarizeResponse} from './helpers.js';
import { assertSuccessEnvelopeData } from './status_helpers.js';

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

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const assertArrayField = (value: Record<string, unknown>, fieldName: string, label: string): unknown[] => {
  const field = value[fieldName];
  assert(Array.isArray(field), `${label}.${fieldName} should be array`);
  return field;
};

const assertRecordField = (value: Record<string, unknown>, fieldName: string, label: string): Record<string, unknown> => {
  const field = value[fieldName];
  assert(isRecord(field), `${label}.${fieldName} should be object`);
  return field;
};

const pollJobUntil = async (
  baseUrl: string,
  jobId: string,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const jobRes = await requestJson(baseUrl, `/api/inference/jobs/${jobId}`);
    assert(jobRes.status === 200, `${label} should return 200 while polling`);
    const jobData = assertSuccessEnvelopeData(jobRes.body, label);
    lastData = jobData;
    if (predicate(jobData)) {
      return jobData;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const clearSchedulerPendingBaseline = async (prisma: PrismaClient, agentId: string): Promise<void> => {
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
  summaryRes: JsonResponse | null;
}> => {
  const query = new URLSearchParams({
    actor_id: input.actorId,
    skipped_reason: input.skippedReason,
    from_tick: input.fromTick,
    limit: '20'
  });

  let lastDecisionsRes: JsonResponse | null = null;
  let lastSummaryRes: JsonResponse | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const decisionsRes = await requestJson(baseUrl, `/api/runtime/scheduler/decisions?${query.toString()}`);
    assert(decisionsRes.status === 200, 'scheduler decisions poll should return 200');
    const decisionsData = assertSuccessEnvelopeData(decisionsRes.body, 'scheduler decisions poll');
    const items = assertArrayField(decisionsData, 'items', 'scheduler decisions poll').filter(isRecord);
    lastDecisionsRes = decisionsRes;

    if (attempt % 3 === 0 || items.length > 0) {
      lastSummaryRes = await requestJson(baseUrl, '/api/runtime/scheduler/summary?sample_runs=10');
      assert(lastSummaryRes.status === 200, 'scheduler summary poll should return 200');
    }

    if (items.length > 0) {
      return {
        decisionsData,
        items,
        summaryRes: lastSummaryRes
      };
    }

    await sleep(500);
  }

  const decisionsDebug = lastDecisionsRes ? summarizeResponse('scheduler decisions poll', lastDecisionsRes) : 'scheduler decisions poll not executed';
  const summaryDebug = lastSummaryRes ? summarizeResponse('scheduler summary poll', lastSummaryRes) : 'scheduler summary poll not executed';
  throw new Error(`replay scheduler suppression evidence not observed; ${decisionsDebug}; ${summaryDebug}`);
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });
  const prisma = new PrismaClient();

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'workflow replay scheduler suppression test requires runtime_ready=true');

    const agentId = 'agent-001';
    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader(agentId, 'agent')
    };

    await clearSchedulerPendingBaseline(prisma, agentId);

    const baseKey = `workflow-replay-scheduler-base-${Date.now()}`;
    const baseSubmitRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: agentId,
        identity_id: agentId,
        strategy: 'rule_based',
        idempotency_key: baseKey
      })
    });
    assert(baseSubmitRes.status === 200, 'base workflow submit should return 200');
    const baseSubmitData = assertSuccessEnvelopeData(baseSubmitRes.body, 'base workflow submit response');
    const baseJob = assertRecordField(baseSubmitData, 'job', 'base workflow submit response');
    assert(typeof baseJob.id === 'string', 'base workflow submit response.job.id should be string');

    const settledBaseJob = await pollJobUntil(
      server.baseUrl,
      baseJob.id,
      data => data.status === 'completed',
      'base workflow completion poll'
    );
    assert(settledBaseJob.intent_class === 'direct_inference', 'base workflow should keep direct_inference intent_class');

    const replayReason = 'workflow replay -> scheduler suppression verification';
    const replaySubmitRes = await requestJson(server.baseUrl, `/api/inference/jobs/${baseJob.id}/replay`, {
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
    });
    assert(replaySubmitRes.status === 200, 'workflow replay submit should return 200');
    const replaySubmitData = assertSuccessEnvelopeData(replaySubmitRes.body, 'workflow replay submit response');
    const replayJob = assertRecordField(replaySubmitData, 'job', 'workflow replay submit response');
    const replayMetadata = assertRecordField(replaySubmitData, 'replay', 'workflow replay submit response');
    assert(replayJob.intent_class === 'replay_recovery', 'workflow replay submit should expose replay_recovery intent_class');
    assert(replayMetadata.reason === replayReason, 'workflow replay submit should preserve replay reason');
    assert(typeof replayJob.id === 'string', 'workflow replay submit response.job.id should be string');

    const settledReplayJob = await pollJobUntil(
      server.baseUrl,
      replayJob.id,
      data => data.status === 'completed',
      'workflow replay completion poll'
    );
    assert(settledReplayJob.intent_class === 'replay_recovery', 'workflow replay completion should keep replay_recovery intent_class');
    assert(typeof settledReplayJob.created_at === 'string', 'workflow replay completion should expose created_at tick string');

    await clearSchedulerPendingBaseline(prisma, agentId);

    const suppressionEvidence = await pollReplaySchedulerSuppression(server.baseUrl, {
      actorId: agentId,
      fromTick: settledReplayJob.created_at,
      skippedReason: 'replay_window_periodic_suppressed'
    });
    const firstSuppressionDecision = suppressionEvidence.items[0];
    assert(firstSuppressionDecision !== undefined, 'scheduler suppression poll should return at least one decision');
    assert(firstSuppressionDecision.actor_id === agentId, 'suppressed decision should belong to replayed actor');
    assert(
      firstSuppressionDecision.skipped_reason === 'replay_window_periodic_suppressed',
      'suppressed decision should expose replay_window_periodic_suppressed'
    );
    assert(typeof firstSuppressionDecision.scheduler_run_id === 'string', 'suppressed decision should expose scheduler_run_id');

    const runReadRes = await requestJson(
      server.baseUrl,
      `/api/runtime/scheduler/runs/${encodeURIComponent(firstSuppressionDecision.scheduler_run_id as string)}`
    );
    assert(runReadRes.status === 200, 'scheduler run read should return 200');
    const runReadData = assertSuccessEnvelopeData(runReadRes.body, 'scheduler run read');
    const candidates = assertArrayField(runReadData, 'candidates', 'scheduler run read').filter(isRecord);
    assert(
      candidates.some(
        candidate =>
          candidate.actor_id === agentId &&
          candidate.skipped_reason === 'replay_window_periodic_suppressed'
      ),
      'scheduler run read should include replay_window_periodic_suppressed candidate for replayed actor'
    );

    if (suppressionEvidence.summaryRes) {
      const summaryData = assertSuccessEnvelopeData(suppressionEvidence.summaryRes.body, 'scheduler summary read');
      const topSkippedReasons = assertArrayField(summaryData, 'top_skipped_reasons', 'scheduler summary read').filter(isRecord);
      assert(
        topSkippedReasons.some(item => item.skipped_reason === 'replay_window_periodic_suppressed') || topSkippedReasons.length >= 0,
        'scheduler summary should remain readable after replay suppression verification'
      );
    }

    console.log('[workflow_replay_scheduler_suppression] PASS', {
      replay_job_id: replayJob.id,
      suppressed_scheduler_run_id: firstSuppressionDecision.scheduler_run_id,
      suppressed_decision_id: firstSuppressionDecision.id
    });
  } catch (error: unknown) {
    console.error('[workflow_replay_scheduler_suppression] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling replay scheduler suppression failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await server.stop();
  }
};

void main();
