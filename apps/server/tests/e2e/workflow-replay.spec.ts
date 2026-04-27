import { describe, expect, it } from 'vitest';

import { getRootAuthHeadersWithIdentity } from '../helpers/auth.js';
import { assertRecord, assertStringArrayField, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { requestJson, sleep, withTestServer } from '../helpers/server.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const DEATH_NOTE_PACK_REF = 'death_note';
const DEATH_NOTE_AGENT_ID = 'agent-001';

const assertStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} should be a string array`);
  }

  return value;
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

describe('workflow replay e2e', () => {
  it('creates replay_recovery jobs with lineage metadata and readable replay snapshots', async () => {
    const environment = await createIsolatedRuntimeEnvironment({
      activePackRef: DEATH_NOTE_PACK_REF,
      seededPackRefs: [DEATH_NOTE_PACK_REF]
    });
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);

      await withTestServer({ defaultPort: 3113, envOverrides: environment.envOverrides, prepareRuntime: false }, async server => {
        const statusResponse = await requestJson(server.baseUrl, '/api/status');
        expect(statusResponse.status).toBe(200);
        const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
        expect(statusData.runtime_ready).toBe(true);

        const headers = {
          ...(await getRootAuthHeadersWithIdentity(server.baseUrl, DEATH_NOTE_AGENT_ID, 'agent'))
        };

        await clearSchedulerPendingBaseline(prisma, DEATH_NOTE_AGENT_ID);

        const baseKey = `workflow-replay-base-${Date.now()}`;
        const submitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent_id: DEATH_NOTE_AGENT_ID,
            identity_id: DEATH_NOTE_AGENT_ID,
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
        expect(settledBaseJob.id).toBe(submittedJob.id);

        const replayReason = 'workflow replay verification';
        const replaySubmitResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${submittedJob.id as string}/replay`, {
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
        expect(replaySubmitResponse.status).toBe(200);
        const replaySubmitData = assertSuccessEnvelopeData(replaySubmitResponse.body, 'workflow replay submit response');
        const replaySubmitJob = assertRecord(replaySubmitData.job, 'workflow replay submit job');
        const replayMetadata = assertRecord(replaySubmitData.replay, 'workflow replay submit metadata');
        expect(replaySubmitJob.intent_class).toBe('replay_recovery');
        expect(replayMetadata.reason).toBe(replayReason);
        expect(replayMetadata.override_applied).toBe(true);

        const replayJobId = replaySubmitJob.id as string;
        const replayWorkflowReadResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}/workflow`);
        expect(replayWorkflowReadResponse.status).toBe(200);
        const settledWorkflowSnapshot = assertRecord(
          assertSuccessEnvelopeData(replayWorkflowReadResponse.body, 'workflow replay workflow read'),
          'workflow replay settled snapshot'
        );
        const settledRecords = assertRecord(settledWorkflowSnapshot.records, 'workflow replay settled snapshot records');
        expect(settledRecords.trace === null || isRecord(settledRecords.trace)).toBe(true);
        expect(settledWorkflowSnapshot.prompt_bundle === undefined || settledWorkflowSnapshot.prompt_bundle === null || isRecord(settledWorkflowSnapshot.prompt_bundle)).toBe(true);
        expect(settledWorkflowSnapshot.context_snapshot === undefined || settledWorkflowSnapshot.context_snapshot === null || isRecord(settledWorkflowSnapshot.context_snapshot)).toBe(true);
        if (isRecord(settledWorkflowSnapshot.context_snapshot)) {
          const settledPromptWorkflow = assertRecord(settledWorkflowSnapshot.context_snapshot.prompt_workflow, 'workflow replay settled prompt workflow');
          expect(settledPromptWorkflow.task_type).toBe('agent_decision');
          expect(typeof settledPromptWorkflow.profile_id).toBe('string');
        }

        const replayWorkflow = assertSuccessEnvelopeData(replayWorkflowReadResponse.body, 'workflow replay workflow response');
        const replayLineage = assertRecord(replayWorkflow.lineage, 'workflow replay lineage');
        expect(replayLineage.replay_of_job_id).toBe(submittedJob.id);
        expect(replayLineage.replay_reason).toBe(replayReason);
        expect(replayLineage.override_applied).toBe(true);

        const replayedJobResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${replayJobId}`);
        expect(replayedJobResponse.status).toBe(200);
        const replayedJob = assertSuccessEnvelopeData(replayedJobResponse.body, 'workflow replay job response');
        expect(replayedJob.id).toBe(replayJobId);
        expect(replayedJob.intent_class).toBe('replay_recovery');
      });
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
