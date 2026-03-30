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
  assert(isRecord(body.data), 'success response data should be object');
  return body.data as Record<string, unknown>;
};

const assertErrorEnvelope = (body: unknown, expectedCode: string) => {
  assert(isRecord(body), 'error response should be object');
  assert(body.success === false, 'error response success should be false');
  assert(isRecord(body.error), 'error response.error should be object');
  assert(body.error.code === expectedCode, `error code should be ${expectedCode}`);
};

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const pollJobStatus = async (
  baseUrl: string,
  jobId: string,
  predicate: (data: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const jobRes = await requestJson(baseUrl, `/api/inference/jobs/${jobId}`);
    assert(jobRes.status === 200, 'GET /api/inference/jobs/:id should return 200 while polling');
    const data = assertSuccessEnvelope(jobRes.body);
    lastData = data;
    if (predicate(data)) {
      return data;
    }
    await sleep(500);
  }

  throw new Error(`job ${jobId} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    assert(isRecord(statusRes.body), '/api/status should return object');
    assert(statusRes.body.runtime_ready === true, 'workflow replay test requires runtime_ready=true');

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const baseKey = `workflow-replay-base-${Date.now()}`;
    const submitRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        identity_id: 'agent-001',
        strategy: 'rule_based',
        idempotency_key: baseKey
      })
    });
    assert(submitRes.status === 200, 'initial replay source job submit should return 200');
    const submitData = assertSuccessEnvelope(submitRes.body);
    assert(isRecord(submitData.job), 'submitData.job should be object');

    const sourceJobId = submitData.job.id as string;
    const completedSourceJob = await pollJobStatus(server.baseUrl, sourceJobId, data => data.status === 'completed');
    assert(completedSourceJob.status === 'completed', 'source job should complete before replay');

    const replayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'operator_manual_replay'
      })
    });
    assert(replayRes.status === 200, 'POST /api/inference/jobs/:id/replay should return 200');
    const replayData = assertSuccessEnvelope(replayRes.body);
    assert(replayData.replayed === false, 'replay API should create a new workflow instead of returning stored replay=true');
    assert(isRecord(replayData.job), 'replay job payload should be object');
    assert(isRecord(replayData.replay), 'replay metadata should be object');
    assert(replayData.replay.source_job_id === sourceJobId, 'replay source_job_id should match original job');
    assert(replayData.replay.reason === 'operator_manual_replay', 'replay reason should match request');
    assert(replayData.job.id !== sourceJobId, 'replay job id should differ from source job id');

    const replayJobId = replayData.job.id as string;
    const replayWorkflowRes = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}/workflow`);
    assert(replayWorkflowRes.status === 200, 'GET replay job workflow should return 200');
    const replayWorkflow = assertSuccessEnvelope(replayWorkflowRes.body);
    assert(isRecord(replayWorkflow.lineage), 'workflow snapshot lineage should be object');
    assert(replayWorkflow.lineage.replay_of_job_id === sourceJobId, 'workflow lineage replay_of_job_id should match source job');
    assert(replayWorkflow.lineage.replay_reason === 'operator_manual_replay', 'workflow lineage replay_reason should match');
    assert(isRecord(replayWorkflow.lineage.parent_job), 'workflow lineage should expose parent_job summary');

    const settledReplayJob = await pollJobStatus(server.baseUrl, replayJobId, data => data.status === 'completed');
    assert(settledReplayJob.status === 'completed', 'replay job should eventually complete');

    const overrideReplayKey = `workflow-replay-override-${Date.now()}`;
    const overrideReplayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'override_replay',
        idempotency_key: overrideReplayKey,
        overrides: {
          strategy: 'mock',
          attributes: {
            mock_content: 'Replay override content'
          }
        }
      })
    });
    assert(overrideReplayRes.status === 200, 'replay with overrides should return 200');
    const overrideReplayData = assertSuccessEnvelope(overrideReplayRes.body);
    assert(isRecord(overrideReplayData.replay), 'override replay metadata should be object');
    assert(overrideReplayData.replay.override_applied === true, 'override replay should mark override_applied=true');
    assert(isRecord(overrideReplayData.replay.override_snapshot), 'override replay should expose override_snapshot');
    assert(overrideReplayData.replay.override_snapshot.strategy === 'mock', 'override replay strategy should be preserved');
    assert(isRecord(overrideReplayData.replay.override_snapshot.attributes), 'override replay attributes snapshot should be object');
    assert(
      overrideReplayData.replay.override_snapshot.attributes.mock_content === 'Replay override content',
      'override replay attributes should preserve mock_content override'
    );

    assert(isRecord(overrideReplayData.job), 'override replay job payload should be object');
    const overrideReplayJobId = overrideReplayData.job.id as string;
    const overrideReplayWorkflowRes = await requestJson(server.baseUrl, `/api/inference/jobs/${overrideReplayJobId}/workflow`);
    assert(overrideReplayWorkflowRes.status === 200, 'GET override replay workflow should return 200');
    const overrideReplayWorkflow = assertSuccessEnvelope(overrideReplayWorkflowRes.body);
    assert(isRecord(overrideReplayWorkflow.lineage), 'override workflow lineage should be object');
    assert(overrideReplayWorkflow.lineage.override_applied === true, 'workflow lineage should expose override_applied=true');
    assert(isRecord(overrideReplayWorkflow.lineage.override_snapshot), 'workflow lineage should expose override_snapshot');
    assert(overrideReplayWorkflow.lineage.override_snapshot.strategy === 'mock', 'workflow lineage should preserve override strategy');

    const sourceWorkflowAfterOverrideRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/workflow`);
    assert(sourceWorkflowAfterOverrideRes.status === 200, 'GET source workflow after override replay should return 200');
    const sourceWorkflowAfterOverride = assertSuccessEnvelope(sourceWorkflowAfterOverrideRes.body);
    assert(isRecord(sourceWorkflowAfterOverride.lineage), 'source workflow lineage should be object');
    assert(Array.isArray(sourceWorkflowAfterOverride.lineage.child_jobs), 'source workflow lineage should expose child_jobs list');
    assert(
      sourceWorkflowAfterOverride.lineage.child_jobs.some((job: unknown) => isRecord(job) && job.id === overrideReplayJobId),
      'source workflow lineage child_jobs should include override replay job'
    );


    const completedOverrideReplayJob = await pollJobStatus(server.baseUrl, overrideReplayJobId, data => data.status === 'completed');
    assert(completedOverrideReplayJob.status === 'completed', 'override replay job should complete');

    const replayKey = `workflow-replay-custom-${Date.now()}`;
    const explicitReplayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'audit_replay',
        idempotency_key: replayKey
      })
    });
    assert(explicitReplayRes.status === 200, 'replay with explicit idempotency_key should return 200');
    const explicitReplayData = assertSuccessEnvelope(explicitReplayRes.body);
    assert(isRecord(explicitReplayData.job), 'explicit replay job payload should be object');
    assert(explicitReplayData.job.idempotency_key === replayKey, 'explicit replay should preserve provided idempotency key');

    const duplicateReplayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'audit_replay',
        idempotency_key: replayKey
      })
    });
    assert(duplicateReplayRes.status === 409, 'duplicate replay idempotency_key should return 409');
    assertErrorEnvelope(duplicateReplayRes.body, 'INFERENCE_INPUT_INVALID');

    const failingKey = `workflow-replay-failing-${Date.now()}`;
    const failingSubmitRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: failingKey,
        attributes: {
          force_fail: true
        }
      })
    });
    assert(failingSubmitRes.status === 200, 'failing source job submit should return 200');
    const failingSubmitData = assertSuccessEnvelope(failingSubmitRes.body);
    assert(isRecord(failingSubmitData.job), 'failing submit job payload should be object');

    const failingJobId = failingSubmitData.job.id as string;
    const failedSourceJob = await pollJobStatus(server.baseUrl, failingJobId, data => data.status === 'failed');
    assert(failedSourceJob.status === 'failed', 'source failing job should reach failed state');

    const failingReplayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${failingJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'post_fix_validation'
      })
    });
    assert(failingReplayRes.status === 200, 'replay from failed job should still return 200');
    const failingReplayData = assertSuccessEnvelope(failingReplayRes.body);
    assert(isRecord(failingReplayData.replay), 'failed replay should include replay metadata');
    assert(failingReplayData.replay.source_job_id === failingJobId, 'failed replay should point to failed source job');

    const invalidActorOverrideRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'invalid_actor_override',
        idempotency_key: `workflow-replay-invalid-actor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        overrides: {
          agent_id: 'agent-002'
        }
      })
    });
    assert(invalidActorOverrideRes.status === 400, 'actor override should be rejected with 400');
    assertErrorEnvelope(invalidActorOverrideRes.body, 'INFERENCE_INPUT_INVALID');

    console.log('[workflow_replay] PASS');
  } catch (error: unknown) {
    console.error('[workflow_replay] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling replay failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
