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
    assert(statusData.runtime_ready === true, 'audit workflow lineage test requires runtime_ready=true');

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

    const baseReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      { agent_id: 'agent-001', strategy: 'rule_based', idempotency_key: baseKey },
      data => data.result_source === 'stored_trace' && isRecord(data.job),
      'base workflow replay poll'
    );
    assert(isRecord(baseReplay.job), 'base replay job should be object');

    const replaySubmitRes = await requestJson(server.baseUrl, `/api/inference/jobs/${baseReplay.job.id as string}/replay`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'lineage verification replay',
        overrides: {
          strategy: 'mock',
          attributes: {
            mock_content: `lineage replay ${Date.now()}`
          }
        }
      })
    });
    assert(replaySubmitRes.status === 200, 'replay submit should return 200');
    const replaySubmitData = assertSuccessEnvelopeData(replaySubmitRes.body, 'replay submit response');
    assert(isRecord(replaySubmitData.job), 'replay submit response should include job');
    assert(isRecord(replaySubmitData.replay), 'replay submit response should include replay metadata');

    const replayJobId = replaySubmitData.job.id as string;
    const replayKey = replaySubmitData.job.idempotency_key as string;
    const settledReplay = await pollReplayJob(
      server.baseUrl,
      headers,
      { agent_id: 'agent-001', strategy: 'mock', idempotency_key: replayKey },
      data => data.result_source === 'stored_trace' && isRecord(data.workflow_snapshot),
      'child replay poll'
    );
    assert(isRecord(settledReplay.workflow_snapshot), 'child replay should include workflow snapshot');

    const workflowDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${replayJobId}`);
    assert(workflowDetailRes.status === 200, 'workflow detail read should return 200');
    const workflowDetail = assertSuccessEnvelopeData(workflowDetailRes.body, 'workflow detail response');
    assert(isRecord(workflowDetail.data), 'workflow detail data should be object');
    assert(isRecord(workflowDetail.data.lineage_detail), 'workflow detail should include lineage_detail');

    const lineageDetail = workflowDetail.data.lineage_detail as Record<string, unknown>;
    assert(isRecord(lineageDetail.parent_workflow), 'workflow detail parent_workflow should exist');
    assert(Array.isArray(lineageDetail.child_workflows), 'workflow detail child_workflows should be array');
    assert((lineageDetail.parent_workflow as Record<string, unknown>).id === baseReplay.job.id, 'parent workflow id should match base job');

    const parentDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${baseReplay.job.id as string}`);
    assert(parentDetailRes.status === 200, 'parent workflow detail read should return 200');
    const parentDetail = assertSuccessEnvelopeData(parentDetailRes.body, 'parent workflow detail response');
    assert(isRecord(parentDetail.data), 'parent workflow detail data should be object');
    assert(isRecord(parentDetail.data.lineage_detail), 'parent workflow detail should include lineage_detail');
    const parentLineage = parentDetail.data.lineage_detail as Record<string, unknown>;
    assert(Array.isArray(parentLineage.child_workflows), 'parent workflow child_workflows should be array');
    assert(
      parentLineage.child_workflows.some(item => isRecord(item) && item.id === replayJobId),
      'parent workflow child_workflows should include replay job'
    );

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
