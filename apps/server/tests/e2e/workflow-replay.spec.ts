import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
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

describe('workflow replay e2e', () => {
  it('creates replay_recovery jobs with lineage metadata and readable replay snapshots', async () => {
    await withIsolatedTestServer({ defaultPort: 3113 }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const headers = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-001', 'agent')
      };

      const baseKey = `workflow-replay-base-${Date.now()}`;
      const submitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: baseKey
        })
      });
      expect(submitResponse.status).toBe(200);
      const submitData = assertSuccessEnvelopeData(submitResponse.body, 'base workflow submit response');
      const submittedJob = assertRecord(submitData.job, 'base workflow submit job');

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
      const baseReplayJob = assertRecord(baseReplay.job, 'base workflow replay job');
      expect(isRecord(baseReplay.result)).toBe(true);
      expect(baseReplayJob.intent_class).toBe('direct_inference');
      expect(baseReplayJob.id).toBe(submittedJob.id);

      const replayReason = 'workflow replay verification';
      const replaySubmitResponse = await requestJson(
        server.baseUrl,
        `/api/inference/jobs/${baseReplayJob.id as string}/replay`,
        {
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
        }
      );
      expect(replaySubmitResponse.status).toBe(200);
      const replaySubmitData = assertSuccessEnvelopeData(replaySubmitResponse.body, 'workflow replay submit response');
      const replaySubmitJob = assertRecord(replaySubmitData.job, 'workflow replay submit job');
      const replayMetadata = assertRecord(replaySubmitData.replay, 'workflow replay submit metadata');
      expect(replaySubmitJob.intent_class).toBe('replay_recovery');
      expect(replayMetadata.reason).toBe(replayReason);
      expect(replayMetadata.override_applied).toBe(true);

      const replayKey = replaySubmitJob.idempotency_key as string;
      const replayJobId = replaySubmitJob.id as string;
      const settledReplay = await pollReplayJob(
        server.baseUrl,
        headers,
        { agent_id: 'agent-001', strategy: 'mock', idempotency_key: replayKey },
        data => data.result_source === 'stored_trace' && isRecord(data.workflow_snapshot),
        'workflow replay poll'
      );
      expect(isRecord(settledReplay.result)).toBe(true);
      expect(isRecord(settledReplay.workflow_snapshot)).toBe(true);

      const replayWorkflowResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}/workflow`);
      expect(replayWorkflowResponse.status).toBe(200);
      const replayWorkflow = assertSuccessEnvelopeData(replayWorkflowResponse.body, 'workflow replay workflow response');
      const replayLineage = assertRecord(replayWorkflow.lineage, 'workflow replay lineage');
      expect(replayLineage.replay_of_job_id).toBe(baseReplayJob.id);
      expect(replayLineage.replay_reason).toBe(replayReason);
      expect(replayLineage.override_applied).toBe(true);

      const replayedJobResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}`);
      expect(replayedJobResponse.status).toBe(200);
      const replayedJob = assertSuccessEnvelopeData(replayedJobResponse.body, 'workflow replay job response');
      expect(replayedJob.id).toBe(replayJobId);
      expect(replayedJob.intent_class).toBe('replay_recovery');
    });
  });
});
