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
    return 3107;
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
    assert(statusRes.body.runtime_ready === true, 'audit workflow lineage test requires runtime_ready=true');

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const baseKey = `audit-workflow-lineage-base-${Date.now()}`;
    const submitRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'rule_based',
        idempotency_key: baseKey
      })
    });
    assert(submitRes.status === 200, 'base workflow submit should return 200');
    const submitData = assertSuccessEnvelope(submitRes.body);
    assert(isRecord(submitData.job), 'base workflow job payload should be object');

    const sourceJobId = submitData.job.id as string;
    await pollJobStatus(server.baseUrl, sourceJobId, data => data.status === 'completed');

    const replayRes = await requestJson(server.baseUrl, `/api/inference/jobs/${sourceJobId}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'audit_lineage_replay',
        idempotency_key: `audit-workflow-lineage-replay-${Date.now()}`,
        overrides: {
          strategy: 'mock',
          attributes: {
            mock_content: 'Audit lineage replay content'
          }
        }
      })
    });
    assert(replayRes.status === 200, 'workflow replay submit should return 200');
    const replayData = assertSuccessEnvelope(replayRes.body);
    assert(isRecord(replayData.job), 'replay workflow job payload should be object');
    const replayJobId = replayData.job.id as string;

    await pollJobStatus(server.baseUrl, replayJobId, data => data.status === 'completed');

    const sourceDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${sourceJobId}`);
    assert(sourceDetailRes.status === 200, 'source workflow audit detail should return 200');
    assert(isRecord(sourceDetailRes.body), 'source workflow audit detail should be object');
    assert(isRecord(sourceDetailRes.body.data), 'source workflow audit detail data should be object');
    assert(isRecord(sourceDetailRes.body.data.lineage_detail), 'source workflow lineage_detail should be object');
    assert(sourceDetailRes.body.data.lineage_detail.parent_workflow === null, 'source workflow should not have parent_workflow');
    assert(Array.isArray(sourceDetailRes.body.data.lineage_detail.child_workflows), 'source workflow should expose child_workflows array');
    assert(
      sourceDetailRes.body.data.lineage_detail.child_workflows.some((workflow: unknown) => isRecord(workflow) && workflow.id === replayJobId),
      'source workflow detail should include replay child workflow summary'
    );
    assert(
      sourceDetailRes.body.data.lineage_detail.child_workflows.some((workflow: unknown) => isRecord(workflow) && workflow.intent_type === 'post_message'),
      'source workflow child summary should expose intent_type'
    );

    const replayDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${replayJobId}`);
    assert(replayDetailRes.status === 200, 'replay workflow audit detail should return 200');
    assert(isRecord(replayDetailRes.body), 'replay workflow audit detail should be object');
    assert(isRecord(replayDetailRes.body.data), 'replay workflow audit detail data should be object');
    assert(replayDetailRes.body.data.replay_of_job_id === sourceJobId, 'replay workflow detail should preserve replay_of_job_id');
    assert(replayDetailRes.body.data.replay_reason === 'audit_lineage_replay', 'replay workflow detail should preserve replay_reason');
    assert(replayDetailRes.body.data.override_applied === true, 'replay workflow detail should preserve override_applied');
    assert(isRecord(replayDetailRes.body.data.lineage_detail), 'replay workflow detail should expose lineage_detail');
    assert(isRecord(replayDetailRes.body.data.lineage_detail.parent_workflow), 'replay workflow detail should expose parent_workflow');
    assert(replayDetailRes.body.data.lineage_detail.parent_workflow.id === sourceJobId, 'replay workflow detail parent_workflow should point to source job');
    assert(replayDetailRes.body.data.lineage_detail.parent_workflow.workflow_state, 'replay workflow detail parent_workflow should expose workflow_state');
    assert(replayDetailRes.body.data.lineage_detail.parent_workflow.action_intent_id, 'replay workflow detail parent_workflow should expose action_intent_id');
    assert(replayDetailRes.body.data.lineage_detail.parent_workflow.inference_id, 'replay workflow detail parent_workflow should expose inference_id');
    assert(replayDetailRes.body.data.lineage_detail.parent_workflow.intent_type === 'post_message', 'replay workflow detail parent_workflow should expose intent_type');
    assert(replayDetailRes.body.data.lineage_detail.parent_workflow.summary, 'replay workflow detail parent_workflow should expose summary');
    assert(Array.isArray(replayDetailRes.body.data.lineage_detail.child_workflows), 'replay workflow detail should expose child_workflows');
    assert(replayDetailRes.body.data.lineage_detail.child_workflows.length === 0, 'replay workflow detail should have no child workflows initially');

    console.log('[audit_workflow_lineage] PASS');
  } catch (error: unknown) {
    console.error('[audit_workflow_lineage] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling audit_workflow_lineage failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
