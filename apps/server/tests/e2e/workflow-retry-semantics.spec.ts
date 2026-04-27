import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { getRootAuthHeadersWithIdentity } from '../helpers/auth.js';
import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  prepareIsolatedRuntime
} from '../helpers/runtime.js';
import { isRecord, requestJson, sleep, withTestServer } from '../helpers/server.js';



const assertRecordField = (value: unknown, fieldName: string, label: string): Record<string, unknown> => {
  const record = assertRecord(value, label);
  return assertRecord(record[fieldName], `${label}.${fieldName}`);
};

const pollJobUntil = async (
  baseUrl: string,
  jobId: string,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
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

describe('workflow retry semantics e2e', () => {
  it('retries a failed job in place and surfaces retry_recovery metadata across read models', async () => {
    const environment = await createIsolatedRuntimeEnvironment();
    const prisma = createPrismaClientForEnvironment(environment);

    try {
      await prepareIsolatedRuntime(environment);

      await withTestServer(
        {
          defaultPort: 3112,
          envOverrides: environment.envOverrides,
          prepareRuntime: false
        },
        async server => {
          const statusResponse = await requestJson(server.baseUrl, '/api/status');
          expect(statusResponse.status).toBe(200);
          const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
          expect(statusData.runtime_ready).toBe(true);

          const headers = {
            'Content-Type': 'application/json',
            ...(await getRootAuthHeadersWithIdentity(server.baseUrl, 'agent-001', 'agent'))
          };

          const retryJobKey = `workflow-retry-${Date.now()}`;
          const retrySubmitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              agent_id: 'agent-001',
              identity_id: 'agent-001',
              strategy: 'mock',
              idempotency_key: retryJobKey,
              attributes: {
                force_fail: true,
                mock_content: `workflow retry recovery ${Date.now()}`
              }
            })
          });
          expect(retrySubmitResponse.status).toBe(200);
          const retrySubmitData = assertSuccessEnvelopeData(
            retrySubmitResponse.body,
            'retry seed workflow submit response'
          );
          const retrySubmitJob = assertRecord(retrySubmitData.job, 'retry seed workflow submit job');

          const retrySourceJobId = retrySubmitJob.id as string;
          expect(typeof retrySourceJobId).toBe('string');

          const failedRetrySeed = await pollJobUntil(
            server.baseUrl,
            retrySourceJobId,
            data => data.status === 'failed',
            'retry seed failure poll'
          );

          const retryBeforeRequestInput = assertRecordField(
            failedRetrySeed,
            'request_input',
            'retry seed failure poll'
          );
          const retryBeforeAttributes = assertRecordField(
            retryBeforeRequestInput,
            'attributes',
            'retry seed failure poll.request_input'
          );
          expect(failedRetrySeed.intent_class).toBe('direct_inference');
          expect(retryBeforeAttributes.job_intent_class).toBe('direct_inference');
          expect(retryBeforeAttributes.job_source).toBe('api_submit');

          await prisma.decisionJob.update({
            where: {
              id: retrySourceJobId
            },
            data: {
              request_input: {
                ...retryBeforeRequestInput,
                attributes: {
                  ...retryBeforeAttributes,
                  force_fail: false,
                  mock_content: `workflow retry recovered ${Date.now()}`
                }
              } as Prisma.InputJsonValue
            }
          });

          const retryResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${retrySourceJobId}/retry`, {
            method: 'POST',
            headers
          });
          expect(retryResponse.status).toBe(200);
          const retryData = assertSuccessEnvelopeData(retryResponse.body, 'workflow retry response');
          const retryJob = assertRecord(retryData.job, 'workflow retry job');
          expect(isRecord(retryData.result)).toBe(true);
          expect(retryData.result_source).toBe('fresh_run');
          expect(retryJob.id).toBe(retrySourceJobId);
          expect(retryJob.intent_class).toBe('retry_recovery');

          const retryWorkflow = assertRecordField(retryData, 'workflow_snapshot', 'workflow retry response');
          const retryWorkflowRecords = assertRecordField(
            retryWorkflow,
            'records',
            'workflow retry response.workflow_snapshot'
          );
          const retryWorkflowJob = assertRecordField(
            retryWorkflowRecords,
            'job',
            'workflow retry response.workflow_snapshot.records'
          );
          const retryWorkflowRequestInput = assertRecordField(
            retryWorkflowJob,
            'request_input',
            'workflow retry response.workflow_snapshot.records.job'
          );
          const retryWorkflowAttributes = assertRecordField(
            retryWorkflowRequestInput,
            'attributes',
            'workflow retry response.workflow_snapshot.records.job.request_input'
          );
          expect(retryWorkflowJob.intent_class).toBe('retry_recovery');
          expect(retryWorkflowAttributes.job_intent_class).toBe('retry_recovery');
          expect(retryWorkflowAttributes.job_source).toBe('retry');

          const retryJobReadResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${retrySourceJobId}`);
          expect(retryJobReadResponse.status).toBe(200);
          const retryJobRead = assertSuccessEnvelopeData(retryJobReadResponse.body, 'workflow retry job read');
          const retryJobRequestInput = assertRecordField(
            retryJobRead,
            'request_input',
            'workflow retry job read'
          );
          const retryJobAttributes = assertRecordField(
            retryJobRequestInput,
            'attributes',
            'workflow retry job read.request_input'
          );
          expect(retryJobRead.intent_class).toBe('retry_recovery');
          expect(retryJobAttributes.job_intent_class).toBe('retry_recovery');
          expect(retryJobAttributes.job_source).toBe('retry');
          expect(retryJobRead.started_at).not.toBeNull();

          const retryWorkflowReadResponse = await requestJson(
            server.baseUrl,
            `/api/inference/jobs/${retrySourceJobId}/workflow`
          );
          expect(retryWorkflowReadResponse.status).toBe(200);
          const retryWorkflowRead = assertSuccessEnvelopeData(
            retryWorkflowReadResponse.body,
            'workflow retry workflow read'
          );
          const retryWorkflowReadRecords = assertRecordField(
            retryWorkflowRead,
            'records',
            'workflow retry workflow read'
          );
          const retryWorkflowReadJob = assertRecordField(
            retryWorkflowReadRecords,
            'job',
            'workflow retry workflow read.records'
          );
          const retryWorkflowReadRequestInput = assertRecordField(
            retryWorkflowReadJob,
            'request_input',
            'workflow retry workflow read.records.job'
          );
          const retryWorkflowReadAttributes = assertRecordField(
            retryWorkflowReadRequestInput,
            'attributes',
            'workflow retry workflow read.records.job.request_input'
          );
          expect(retryWorkflowReadJob.intent_class).toBe('retry_recovery');
          expect(retryWorkflowReadAttributes.job_intent_class).toBe('retry_recovery');
          expect(retryWorkflowReadAttributes.job_source).toBe('retry');

          const jobsListResponse = await requestJson(server.baseUrl, '/api/inference/jobs?agent_id=agent-001&limit=20');
          expect(jobsListResponse.status).toBe(200);
          const jobsListData = assertSuccessEnvelopeData(jobsListResponse.body, 'workflow jobs list response');
          expect(Array.isArray(jobsListData.items)).toBe(true);
          const retriedListItem = (jobsListData.items as unknown[]).find(
            item => isRecord(item) && item.id === retrySourceJobId
          );
          expect(isRecord(retriedListItem)).toBe(true);
          expect((retriedListItem as Record<string, unknown>).intent_class).toBe('retry_recovery');

          expect(typeof retryData.inference_id).toBe('string');
          const persistedTrace = await prisma.inferenceTrace.findUnique({
            where: {
              id: retryData.inference_id as string
            }
          });
          expect(persistedTrace).not.toBeNull();
          const persistedTraceInput = assertRecord(persistedTrace?.input, 'workflow retry persisted trace input');
          const persistedTraceAttributes = assertRecordField(
            persistedTraceInput,
            'attributes',
            'workflow retry persisted trace input'
          );
          expect(persistedTraceAttributes.job_intent_class).toBe('retry_recovery');
          expect(persistedTraceAttributes.job_source).toBe('retry');
        }
      );
    } finally {
      await prisma.$disconnect();
      await environment.cleanup();
    }
  });
});
