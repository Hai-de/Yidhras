import { PrismaClient } from '@prisma/client';

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

const assertRecordField = (value: unknown, fieldName: string, label: string): Record<string, unknown> => {
  assert(isRecord(value), `${label} should be object`);
  const field = value[fieldName];
  assert(isRecord(field), `${label}.${fieldName} should be object`);
  return field as Record<string, unknown>;
};

const pollJobUntil = async (
  baseUrl: string,
  jobId: string,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
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

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });
  const prisma = new PrismaClient();

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'workflow retry semantics test requires runtime_ready=true');

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const retryJobKey = `workflow-retry-${Date.now()}`;
    const retrySubmitRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
    assert(retrySubmitRes.status === 200, 'retry seed workflow submit should return 200');
    const retrySubmitData = assertSuccessEnvelopeData(retrySubmitRes.body, 'retry seed workflow submit response');
    assert(isRecord(retrySubmitData.job), 'retry seed workflow submit should include job');

    const retrySourceJobId = retrySubmitData.job.id as string;
    const failedRetrySeed = await pollJobUntil(
      server.baseUrl,
      retrySourceJobId,
      data => data.status === 'failed',
      'retry seed failure poll'
    );

    const retryBeforeRequestInput = assertRecordField(failedRetrySeed, 'request_input', 'retry seed failure poll');
    const retryBeforeAttributes = assertRecordField(retryBeforeRequestInput, 'attributes', 'retry seed failure poll.request_input');
    assert(failedRetrySeed.intent_class === 'direct_inference', 'failed source job should keep direct_inference before retry');
    assert(retryBeforeAttributes.job_intent_class === 'direct_inference', 'failed source job should keep direct_inference metadata before retry');
    assert(retryBeforeAttributes.job_source === 'api_submit', 'failed source job should keep api_submit metadata before retry');

    await prisma.decisionJob.update({
      where: {
        id: retrySourceJobId
      },
      data: {
        request_input: {
          ...retryBeforeRequestInput,
          attributes: { ...retryBeforeAttributes, force_fail: false, mock_content: `workflow retry recovered ${Date.now()}` }
        }
      }
    });

    const retryRes = await requestJson(server.baseUrl, `/api/inference/jobs/${retrySourceJobId}/retry`, {
      method: 'POST',
      headers
    });
    assert(retryRes.status === 200, 'workflow retry should return 200');
    const retryData = assertSuccessEnvelopeData(retryRes.body, 'workflow retry response');
    assert(isRecord(retryData.job), 'workflow retry should include job');
    assert(isRecord(retryData.result), 'workflow retry should include fresh result');
    assert(retryData.result_source === 'fresh_run', 'workflow retry should expose fresh_run result_source');
    assert(retryData.job.id === retrySourceJobId, 'retry should reuse the same job id');
    assert(retryData.job.intent_class === 'retry_recovery', 'workflow retry response job should expose retry_recovery intent_class');

    const retryWorkflow = assertRecordField(retryData, 'workflow_snapshot', 'workflow retry response');
    const retryWorkflowRecords = assertRecordField(retryWorkflow, 'records', 'workflow retry response.workflow_snapshot');
    const retryWorkflowJob = assertRecordField(retryWorkflowRecords, 'job', 'workflow retry response.workflow_snapshot.records');
    const retryWorkflowRequestInput = assertRecordField(retryWorkflowJob, 'request_input', 'workflow retry response.workflow_snapshot.records.job');
    const retryWorkflowAttributes = assertRecordField(retryWorkflowRequestInput, 'attributes', 'workflow retry response.workflow_snapshot.records.job.request_input');
    assert(retryWorkflowJob.intent_class === 'retry_recovery', 'workflow retry snapshot job should expose retry_recovery intent_class');
    assert(retryWorkflowAttributes.job_intent_class === 'retry_recovery', 'workflow retry snapshot should expose retry_recovery job_intent_class');
    assert(retryWorkflowAttributes.job_source === 'retry', 'workflow retry snapshot should expose retry job_source');

    const retryJobReadRes = await requestJson(server.baseUrl, `/api/inference/jobs/${retrySourceJobId}`);
    assert(retryJobReadRes.status === 200, 'workflow retry job read should return 200');
    const retryJobRead = assertSuccessEnvelopeData(retryJobReadRes.body, 'workflow retry job read');
    const retryJobRequestInput = assertRecordField(retryJobRead, 'request_input', 'workflow retry job read');
    const retryJobAttributes = assertRecordField(retryJobRequestInput, 'attributes', 'workflow retry job read.request_input');
    assert(retryJobRead.intent_class === 'retry_recovery', 'workflow retry job read should expose retry_recovery intent_class');
    assert(retryJobAttributes.job_intent_class === 'retry_recovery', 'workflow retry job read should expose retry_recovery job_intent_class');
    assert(retryJobAttributes.job_source === 'retry', 'workflow retry job read should expose retry job_source');
    assert(retryJobRead.started_at !== null, 'workflow retry job read should expose restarted started_at');

    const retryWorkflowReadRes = await requestJson(server.baseUrl, `/api/inference/jobs/${retrySourceJobId}/workflow`);
    assert(retryWorkflowReadRes.status === 200, 'workflow retry workflow read should return 200');
    const retryWorkflowRead = assertSuccessEnvelopeData(retryWorkflowReadRes.body, 'workflow retry workflow read');
    const retryWorkflowReadRecords = assertRecordField(retryWorkflowRead, 'records', 'workflow retry workflow read');
    const retryWorkflowReadJob = assertRecordField(retryWorkflowReadRecords, 'job', 'workflow retry workflow read.records');
    const retryWorkflowReadRequestInput = assertRecordField(retryWorkflowReadJob, 'request_input', 'workflow retry workflow read.records.job');
    const retryWorkflowReadAttributes = assertRecordField(retryWorkflowReadRequestInput, 'attributes', 'workflow retry workflow read.records.job.request_input');
    assert(retryWorkflowReadJob.intent_class === 'retry_recovery', 'workflow retry workflow read should expose retry_recovery intent_class');
    assert(retryWorkflowReadAttributes.job_intent_class === 'retry_recovery', 'workflow retry workflow read should expose retry_recovery job_intent_class');
    assert(retryWorkflowReadAttributes.job_source === 'retry', 'workflow retry workflow read should expose retry job_source');

    const jobsListRes = await requestJson(server.baseUrl, `/api/inference/jobs?agent_id=agent-001&limit=20`);
    assert(jobsListRes.status === 200, 'workflow jobs list should return 200');
    const jobsListData = assertSuccessEnvelopeData(jobsListRes.body, 'workflow jobs list response');
    assert(Array.isArray(jobsListData.items), 'workflow jobs list should include items');
    const retriedListItem = jobsListData.items.find(item => isRecord(item) && item.id === retrySourceJobId);
    assert(isRecord(retriedListItem), 'workflow jobs list should include retried job');
    assert(retriedListItem.intent_class === 'retry_recovery', 'workflow jobs list item should expose retry_recovery intent_class');

    const persistedTrace = await prisma.inferenceTrace.findUnique({
      where: {
        id: retryData.inference_id as string
      }
    });
    assert(persistedTrace !== null, 'workflow retry should persist inference trace');
    assert(isRecord(persistedTrace.input), 'workflow retry persisted trace input should be object');
    const persistedTraceAttributes = assertRecordField(persistedTrace.input, 'attributes', 'workflow retry persisted trace input');
    assert(persistedTraceAttributes.job_intent_class === 'retry_recovery', 'workflow retry persisted trace input should expose retry_recovery job_intent_class');
    assert(persistedTraceAttributes.job_source === 'retry', 'workflow retry persisted trace input should expose retry job_source');

    console.log('[workflow_retry_semantics] PASS');
  } catch (error: unknown) {
    console.error('[workflow_retry_semantics] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling retry semantics failure');
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
