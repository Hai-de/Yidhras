import { describe, expect, it } from 'vitest';

import {
  assertArrayField,
  assertRecord,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson, sleep } from '../helpers/server.js';

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const pollReplayJob = async (
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const replayResponse = await requestJson(baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    expect(replayResponse.status).toBe(200);
    const replayData = assertSuccessEnvelopeData(replayResponse.body, label);
    lastData = replayData;
    if (predicate(replayData)) {
      return replayData;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected state: ${JSON.stringify(lastData)}`);
};

describe('audit workflow lineage e2e', () => {
  it('exposes parent/child workflow lineage through audit workflow detail endpoints', async () => {
    await withIsolatedTestServer({ defaultPort: 3114 }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const headers = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-001', 'agent')
      };

      const baseKey = `audit-workflow-lineage-base-${Date.now()}`;
      const submitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: baseKey
        })
      });
      expect(submitResponse.status).toBe(200);

      const baseReplay = await pollReplayJob(
        server.baseUrl,
        headers,
        { agent_id: 'agent-001', strategy: 'rule_based', idempotency_key: baseKey },
        data => data.result_source === 'stored_trace' && isRecord(data.job),
        'base workflow replay poll'
      );
      const baseReplayJob = assertRecord(baseReplay.job, 'base replay job');

      const replaySubmitResponse = await requestJson(
        server.baseUrl,
        `/api/inference/jobs/${baseReplayJob.id as string}/replay`,
        {
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
        }
      );
      expect(replaySubmitResponse.status).toBe(200);
      const replaySubmitData = assertSuccessEnvelopeData(replaySubmitResponse.body, 'replay submit response');
      const replayJob = assertRecord(replaySubmitData.job, 'replay submit job');
      expect(isRecord(replaySubmitData.replay)).toBe(true);

      const replayJobId = replayJob.id as string;
      const replayKey = replayJob.idempotency_key as string;
      const settledReplay = await pollReplayJob(
        server.baseUrl,
        headers,
        { agent_id: 'agent-001', strategy: 'mock', idempotency_key: replayKey },
        data => data.result_source === 'stored_trace' && isRecord(data.workflow_snapshot),
        'child replay poll'
      );
      expect(isRecord(settledReplay.workflow_snapshot)).toBe(true);

      const workflowDetailResponse = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${replayJobId}`);
      expect(workflowDetailResponse.status).toBe(200);
      const workflowDetail = assertSuccessEnvelopeData(workflowDetailResponse.body, 'workflow detail response');
      const workflowDetailData = assertRecord(workflowDetail.data, 'workflow detail data');
      const lineageDetail = assertRecord(workflowDetailData.lineage_detail, 'workflow detail lineage_detail');
      const parentWorkflow = assertRecord(lineageDetail.parent_workflow, 'workflow detail parent_workflow');
      const childWorkflows = assertArrayField(lineageDetail, 'child_workflows', 'workflow detail lineage_detail');
      expect(Array.isArray(childWorkflows)).toBe(true);
      expect(parentWorkflow.id).toBe(baseReplayJob.id);

      const parentDetailResponse = await requestJson(
        server.baseUrl,
        `/api/audit/entries/workflow/${baseReplayJob.id as string}`
      );
      expect(parentDetailResponse.status).toBe(200);
      const parentDetail = assertSuccessEnvelopeData(parentDetailResponse.body, 'parent workflow detail response');
      const parentDetailData = assertRecord(parentDetail.data, 'parent workflow detail data');
      const parentLineage = assertRecord(parentDetailData.lineage_detail, 'parent workflow lineage_detail');
      const parentChildWorkflows = assertArrayField(parentLineage, 'child_workflows', 'parent workflow lineage_detail');
      expect(Array.isArray(parentChildWorkflows)).toBe(true);
      expect(
        parentChildWorkflows.some((item: unknown) => isRecord(item) && item.id === replayJobId)
      ).toBe(true);
    });
  });
});
