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
    assert(statusData.runtime_ready === true, 'workflow replay test requires runtime_ready=true');

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
    assert(submitRes.status === 200, 'base workflow submit should return 200');
    const submitData = assertSuccessEnvelopeData(submitRes.body, 'base workflow submit response');
    assert(isRecord(submitData.job), 'base workflow submit should include job');

    const baseReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      {
        agent_id: 'agent-001',
        identity_id: 'agent-001',
        strategy: 'rule_based',
        idempotency_key: baseKey
      },
      data => data.result_source === 'stored_trace' && isRecord(data.job),
      'base workflow replay poll'
    );
    assert(isRecord(baseReplay.job), 'base workflow replay should include job');
    assert(isRecord(baseReplay.result), 'base workflow replay should expose stored result');

    const replayReason = 'workflow replay verification';
    const replaySubmitRes = await requestJson(server.baseUrl, `/api/inference/jobs/${baseReplay.job.id as string}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: replayReason,
        overrides: {
          strategy: 'mock',
          attributes: {
            mock_content: `workflow replay mock ${Date.now()}`
          }
        }
      })
    });
    assert(replaySubmitRes.status === 200, 'workflow replay submit should return 200');
    const replaySubmitData = assertSuccessEnvelopeData(replaySubmitRes.body, 'workflow replay submit response');
    assert(isRecord(replaySubmitData.job), 'workflow replay submit should include job');
    assert(isRecord(replaySubmitData.replay), 'workflow replay submit should include replay metadata');
    assert(replaySubmitData.replay.reason === replayReason, 'workflow replay reason should match');
    assert(replaySubmitData.replay.override_applied === true, 'workflow replay override_applied should be true');

    const replayKey = replaySubmitData.job.idempotency_key as string;
    const replayJobId = replaySubmitData.job.id as string;
    const settledReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: replayKey },
      data => data.result_source === 'stored_trace' && isRecord(data.workflow_snapshot),
      'workflow replay poll'
    );
    assert(isRecord(settledReplay.result), 'workflow replay should expose stored result');
    assert(isRecord(settledReplay.workflow_snapshot), 'workflow replay should expose workflow snapshot');

    const replayWorkflowRes = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}/workflow`);
    assert(replayWorkflowRes.status === 200, 'workflow replay workflow read should return 200');
    const replayWorkflow = assertSuccessEnvelopeData(replayWorkflowRes.body, 'workflow replay workflow response');
    assert(isRecord(replayWorkflow.lineage), 'workflow replay workflow should include lineage');
    assert(replayWorkflow.lineage.replay_of_job_id === baseReplay.job.id, 'workflow replay lineage replay_of_job_id should match parent');
    assert(replayWorkflow.lineage.replay_reason === replayReason, 'workflow replay lineage reason should match');
    assert(replayWorkflow.lineage.override_applied === true, 'workflow replay lineage override_applied should be true');

    const replayedJobRes = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}`);
    assert(replayedJobRes.status === 200, 'workflow replay job read should return 200');
    const replayedJob = assertSuccessEnvelopeData(replayedJobRes.body, 'workflow replay job response');
    assert(replayedJob.id === replayJobId, 'workflow replay job response id should match');

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
