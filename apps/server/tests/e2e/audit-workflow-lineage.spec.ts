import { describe, expect, it } from 'vitest';

import {
  assertArrayField,
  assertRecord,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, sleep, withTestServer } from '../helpers/server.js';

const DEATH_NOTE_PACK_REF = 'death_note';
const DEATH_NOTE_AGENT_ID = 'agent-001';

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

describe('audit workflow lineage e2e', () => {
  it('exposes parent/child workflow lineage through audit workflow detail endpoints', async () => {
    const environment = await createIsolatedRuntimeEnvironment({
      activePackRef: DEATH_NOTE_PACK_REF,
      seededPackRefs: [DEATH_NOTE_PACK_REF]
    });
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);

      await withTestServer({ defaultPort: 3114, envOverrides: environment.envOverrides, prepareRuntime: false }, async server => {
        const statusResponse = await requestJson(server.baseUrl, '/api/status');
        expect(statusResponse.status).toBe(200);
        const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
        expect(statusData.runtime_ready).toBe(true);

        const headers = {
          'Content-Type': 'application/json',
          'x-m2-identity': createIdentityHeader(DEATH_NOTE_AGENT_ID, 'agent')
        };

        await clearSchedulerPendingBaseline(prisma, DEATH_NOTE_AGENT_ID);

        const baseKey = `audit-workflow-lineage-base-${Date.now()}`;
        const submitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent_id: DEATH_NOTE_AGENT_ID,
            strategy: 'rule_based',
            idempotency_key: baseKey
          })
        });
        expect(submitResponse.status).toBe(200);
        const submitData = assertSuccessEnvelopeData(submitResponse.body, 'base workflow submit response');
        const submittedJob = assertRecord(submitData.job, 'base workflow submit job');

        const settledBaseJob = await pollJobUntil(
          server.baseUrl,
          submittedJob.id as string,
          data => data.status === 'completed',
          'base workflow completion poll'
        );
        expect(settledBaseJob.intent_class).toBe('direct_inference');

        const replaySubmitResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${submittedJob.id as string}/replay`, {
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
        expect(replaySubmitResponse.status).toBe(200);
        const replaySubmitData = assertSuccessEnvelopeData(replaySubmitResponse.body, 'replay submit response');
        const replayJob = assertRecord(replaySubmitData.job, 'replay submit job');
        expect(isRecord(replaySubmitData.replay)).toBe(true);

        const replayJobId = replayJob.id as string;
        expect(replayJob.intent_class).toBe('replay_recovery');

        const workflowDetailResponse = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${replayJobId}`);
        expect(workflowDetailResponse.status).toBe(200);
        const workflowDetail = assertSuccessEnvelopeData(workflowDetailResponse.body, 'workflow detail response');
        const workflowDetailData = assertRecord(workflowDetail.data, 'workflow detail data');
        const lineageDetail = assertRecord(workflowDetailData.lineage_detail, 'workflow detail lineage_detail');
        const parentWorkflow = assertRecord(lineageDetail.parent_workflow, 'workflow detail parent_workflow');
        const childWorkflows = assertArrayField(lineageDetail, 'child_workflows', 'workflow detail lineage_detail');
        expect(Array.isArray(childWorkflows)).toBe(true);
        expect(parentWorkflow.id).toBe(submittedJob.id);

        const parentDetailResponse = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${submittedJob.id as string}`);
        expect(parentDetailResponse.status).toBe(200);
        const parentDetail = assertSuccessEnvelopeData(parentDetailResponse.body, 'parent workflow detail response');
        const parentDetailData = assertRecord(parentDetail.data, 'parent workflow detail data');
        const parentLineage = assertRecord(parentDetailData.lineage_detail, 'parent workflow lineage_detail');
        const parentChildWorkflows = assertArrayField(parentLineage, 'child_workflows', 'parent workflow lineage_detail');
        expect(Array.isArray(parentChildWorkflows)).toBe(true);
        expect(parentChildWorkflows.some((item: unknown) => isRecord(item) && item.id === replayJobId)).toBe(true);
      });
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
