import { describe, expect, it } from 'vitest';

import {
  assertErrorEnvelope as assertBaseErrorEnvelope,
  assertRecord,
  assertSuccessEnvelopeArrayData,
  assertSuccessEnvelopeData
} from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson, sleep } from '../helpers/server.js';

const assertErrorEnvelope = (body: unknown, expectedCode: string, label: string): Record<string, unknown> => {
  const error = assertBaseErrorEnvelope(body, expectedCode, label);
  expect(typeof error.request_id).toBe('string');
  expect(typeof error.timestamp).toBe('number');
  return error;
};

const assertWorldPackNotReadyEnvelope = (body: unknown, label: string) => {
  const error = assertErrorEnvelope(body, 'WORLD_PACK_NOT_READY', label);
  const details = assertRecord(error.details, `${label}.error.details`);
  expect(typeof details.startup_level).toBe('string');
  expect(Array.isArray(details.available_world_packs)).toBe(true);
};

const assertWorkflowSnapshot = (value: unknown, label: string): Record<string, unknown> => {
  const snapshot = assertRecord(value, label);
  const records = assertRecord(snapshot.records, `${label}.records`);
  const derived = assertRecord(snapshot.derived, `${label}.derived`);

  expect('trace' in records).toBe(true);
  expect('job' in records).toBe(true);
  expect('intent' in records).toBe(true);
  expect(typeof derived.decision_stage).toBe('string');
  expect(typeof derived.dispatch_stage).toBe('string');
  expect(typeof derived.workflow_state).toBe('string');
  expect(typeof derived.failure_stage).toBe('string');
  expect(isRecord(derived.outcome_summary)).toBe(true);

  return snapshot;
};

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const pollReplayJobResult = async (
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  label: string,
  predicate: (data: Record<string, unknown>) => boolean
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

  throw new Error(`${label} did not reach expected replay state: ${JSON.stringify(lastData)}`);
};

describe('smoke endpoints e2e', () => {
  it('covers key runtime, social, relational and inference endpoints in an isolated runtime', async () => {
    await withIsolatedTestServer({ defaultPort: 3103 }, async server => {
      const healthResponse = await requestJson(server.baseUrl, '/api/health');
      expect([200, 503]).toContain(healthResponse.status);
      const healthData = assertSuccessEnvelopeData(healthResponse.body, '/api/health');
      expect(typeof healthData.healthy).toBe('boolean');

      const notificationsResponse = await requestJson(server.baseUrl, '/api/system/notifications');
      expect(notificationsResponse.status).toBe(200);
      assertSuccessEnvelopeArrayData(notificationsResponse.body, '/api/system/notifications');

      const clearResponse = await requestJson(server.baseUrl, '/api/system/notifications/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      expect(clearResponse.status).toBe(200);
      const clearData = assertSuccessEnvelopeData(clearResponse.body, '/api/system/notifications/clear');
      expect(clearData.acknowledged).toBe(true);

      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(typeof statusData.runtime_ready).toBe('boolean');

      const runtimeReady = statusData.runtime_ready === true;

      const clockResponse = await requestJson(server.baseUrl, '/api/clock');
      if (runtimeReady) {
        expect(clockResponse.status).toBe(200);
        const clockData = assertSuccessEnvelopeData(clockResponse.body, '/api/clock');
        expect(typeof clockData.absolute_ticks).toBe('string');
        expect(Array.isArray(clockData.calendars)).toBe(true);
      } else {
        expect(clockResponse.status).toBe(503);
        assertWorldPackNotReadyEnvelope(clockResponse.body, '/api/clock');
      }

      const formattedClockResponse = await requestJson(server.baseUrl, '/api/clock/formatted');
      if (runtimeReady) {
        expect(formattedClockResponse.status).toBe(200);
        const formattedClockData = assertSuccessEnvelopeData(formattedClockResponse.body, '/api/clock/formatted');
        expect(typeof formattedClockData.absolute_ticks).toBe('string');
        expect(Array.isArray(formattedClockData.calendars)).toBe(true);
      } else {
        expect(formattedClockResponse.status).toBe(503);
        assertWorldPackNotReadyEnvelope(formattedClockResponse.body, '/api/clock/formatted');
      }

      const pauseResponse = await requestJson(server.baseUrl, '/api/clock/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' })
      });
      const resumeResponse = await requestJson(server.baseUrl, '/api/clock/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' })
      });

      if (runtimeReady) {
        expect(pauseResponse.status).toBe(200);
        const pauseData = assertSuccessEnvelopeData(pauseResponse.body, 'pause control');
        expect(pauseData.acknowledged).toBe(true);
        expect(pauseData.status).toBe('paused');

        expect(resumeResponse.status).toBe(200);
        const resumeData = assertSuccessEnvelopeData(resumeResponse.body, 'resume control');
        expect(resumeData.acknowledged).toBe(true);
        expect(resumeData.status).toBe('running');
      } else {
        expect(pauseResponse.status).toBe(503);
        expect(resumeResponse.status).toBe(503);
      }

      const feedResponse = await requestJson(server.baseUrl, '/api/social/feed?limit=5');
      const graphResponse = await requestJson(server.baseUrl, '/api/relational/graph');
      const timelineResponse = await requestJson(server.baseUrl, '/api/narrative/timeline');

      if (runtimeReady) {
        expect(feedResponse.status).toBe(200);
        assertSuccessEnvelopeArrayData(feedResponse.body, '/api/social/feed');

        expect(graphResponse.status).toBe(200);
        const graphData = assertSuccessEnvelopeData(graphResponse.body, '/api/relational/graph');
        expect(Array.isArray(graphData.nodes)).toBe(true);
        expect(Array.isArray(graphData.edges)).toBe(true);

        expect(timelineResponse.status).toBe(200);
        assertSuccessEnvelopeArrayData(timelineResponse.body, '/api/narrative/timeline');

        const overrideResponse = await requestJson(server.baseUrl, '/api/runtime/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'override', step_ticks: '2' })
        });
        expect(overrideResponse.status).toBe(200);
        const overrideData = assertSuccessEnvelopeData(overrideResponse.body, 'runtime speed override');
        const overrideRuntimeSpeed = assertRecord(overrideData.runtime_speed, 'runtime speed override payload');
        expect(typeof overrideRuntimeSpeed.override_since).toBe('number');

        const overrideClearResponse = await requestJson(server.baseUrl, '/api/runtime/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' })
        });
        expect(overrideClearResponse.status).toBe(200);
        const overrideClearData = assertSuccessEnvelopeData(overrideClearResponse.body, 'runtime speed clear');
        const clearedRuntimeSpeed = assertRecord(overrideClearData.runtime_speed, 'runtime speed clear payload');
        expect(clearedRuntimeSpeed.override_since).toBeNull();

        const activeIdentityHeaders = {
          'Content-Type': 'application/json',
          'x-m2-identity': createIdentityHeader('agent-001', 'agent')
        };

        const previewByAgentResponse = await requestJson(server.baseUrl, '/api/inference/preview', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock',
            attributes: {
              mock_content: 'Inference preview smoke content'
            }
          })
        });
        expect(previewByAgentResponse.status).toBe(200);
        const previewByAgentData = assertSuccessEnvelopeData(previewByAgentResponse.body, 'preview by agent');
        expect(typeof previewByAgentData.inference_id).toBe('string');
        expect(previewByAgentData.provider).toBe('mock');
        expect(typeof previewByAgentData.tick).toBe('string');
        const previewByAgentActor = assertRecord(previewByAgentData.actor_ref, 'preview by agent actor_ref');
        expect(previewByAgentActor.role).toBe('active');
        expect(previewByAgentActor.agent_id).toBe('agent-001');
        const previewByAgentPrompt = assertRecord(previewByAgentData.prompt, 'preview by agent prompt');
        expect(typeof previewByAgentPrompt.combined_prompt).toBe('string');
        expect(isRecord(previewByAgentData.metadata)).toBe(true);

        const previewByIdentityResponse = await requestJson(server.baseUrl, '/api/inference/preview', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            identity_id: 'agent-001',
            strategy: 'mock'
          })
        });
        expect(previewByIdentityResponse.status).toBe(200);
        const previewByIdentityData = assertSuccessEnvelopeData(previewByIdentityResponse.body, 'preview by identity');
        const previewByIdentityActor = assertRecord(previewByIdentityData.actor_ref, 'preview by identity actor_ref');
        expect(previewByIdentityActor.role).toBe('active');
        expect(previewByIdentityActor.identity_id).toBe('agent-001');
        expect(previewByIdentityActor.agent_id).toBe('agent-001');

        const atmosphereIdentityHeaders = {
          'Content-Type': 'application/json',
          'x-m2-identity': createIdentityHeader('user-001', 'user')
        };
        const previewAtmosphereResponse = await requestJson(server.baseUrl, '/api/inference/preview', {
          method: 'POST',
          headers: atmosphereIdentityHeaders,
          body: JSON.stringify({
            identity_id: 'user-001',
            strategy: 'mock'
          })
        });
        expect(previewAtmosphereResponse.status).toBe(200);
        const previewAtmosphereData = assertSuccessEnvelopeData(previewAtmosphereResponse.body, 'preview by atmosphere identity');
        const previewAtmosphereActor = assertRecord(previewAtmosphereData.actor_ref, 'preview atmosphere actor_ref');
        expect(previewAtmosphereActor.role).toBe('atmosphere');
        expect(previewAtmosphereActor.identity_id).toBe('user-001');
        expect(previewAtmosphereActor.atmosphere_node_id).toBe('atm-001');
        expect(previewAtmosphereActor.agent_id).toBe('agent-001');

        const runByMixedActorResponse = await requestJson(server.baseUrl, '/api/inference/run', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            identity_id: 'agent-001',
            strategy: 'rule_based'
          })
        });
        expect(runByMixedActorResponse.status).toBe(200);
        const runByMixedActorData = assertSuccessEnvelopeData(runByMixedActorResponse.body, 'run by mixed actor');
        expect(runByMixedActorData.provider).toBe('rule_based');
        expect(typeof runByMixedActorData.tick).toBe('string');
        const mixedActorRef = assertRecord(runByMixedActorData.actor_ref, 'run by mixed actor actor_ref');
        expect(mixedActorRef.role).toBe('active');
        expect(isRecord(runByMixedActorData.decision)).toBe(true);
        const mixedDecision = assertRecord(runByMixedActorData.decision, 'run by mixed actor decision');
        expect(typeof mixedDecision.action_type).toBe('string');
        const mixedTraceMetadata = assertRecord(runByMixedActorData.trace_metadata, 'run by mixed actor trace_metadata');
        expect(typeof mixedTraceMetadata.tick).toBe('string');

        const jobIdempotencyKey = `job-smoke-key-${Date.now()}`;
        const jobSubmitResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            identity_id: 'agent-001',
            strategy: 'rule_based',
            idempotency_key: jobIdempotencyKey
          })
        });
        expect(jobSubmitResponse.status).toBe(200);
        const jobSubmitData = assertSuccessEnvelopeData(jobSubmitResponse.body, 'job submit');
        expect(jobSubmitData.replayed).toBe(false);
        expect(typeof jobSubmitData.inference_id).toBe('string');
        const jobSubmitJob = assertRecord(jobSubmitData.job, 'job submit job');
        expect(jobSubmitJob.status).toBe('pending');
        expect(jobSubmitJob.idempotency_key).toBe(jobIdempotencyKey);
        expect(jobSubmitData.result).toBeNull();
        expect(jobSubmitData.result_source).toBe('not_available');
        const jobSubmitWorkflow = assertWorkflowSnapshot(jobSubmitData.workflow_snapshot, 'job submit workflow snapshot');
        const jobSubmitDerived = assertRecord(jobSubmitWorkflow.derived, 'job submit workflow derived');
        expect(jobSubmitDerived.workflow_state).toBe('decision_pending');

        const firstJobReadResponse = await requestJson(server.baseUrl, `/api/inference/jobs/${jobSubmitJob.id as string}`);
        expect(firstJobReadResponse.status).toBe(200);
        const firstJobReadData = assertSuccessEnvelopeData(firstJobReadResponse.body, 'job read after submit');
        expect(firstJobReadData.status === 'pending' || firstJobReadData.status === 'completed').toBe(true);

        const firstJobWorkflowResponse = await requestJson(
          server.baseUrl,
          `/api/inference/jobs/${jobSubmitJob.id as string}/workflow`
        );
        expect(firstJobWorkflowResponse.status).toBe(200);
        assertWorkflowSnapshot(
          assertSuccessEnvelopeData(firstJobWorkflowResponse.body, 'job workflow by id'),
          'job workflow by id'
        );

        const jobReplayResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            identity_id: 'agent-001',
            strategy: 'rule_based',
            idempotency_key: jobSubmitJob.idempotency_key
          })
        });
        expect(jobReplayResponse.status).toBe(200);
        const jobReplayData = assertSuccessEnvelopeData(jobReplayResponse.body, 'job replay');
        expect(jobReplayData.replayed).toBe(true);
        expect(jobReplayData.inference_id).toBe(jobSubmitData.inference_id);
        const jobReplayJob = assertRecord(jobReplayData.job, 'job replay job');
        expect(jobReplayJob.idempotency_key).toBe(jobSubmitJob.idempotency_key);
        expect(jobReplayData.result === null || isRecord(jobReplayData.result)).toBe(true);
        expect(
          jobReplayData.result_source === 'not_available' || jobReplayData.result_source === 'stored_trace'
        ).toBe(true);
        assertWorkflowSnapshot(jobReplayData.workflow_snapshot, 'job replay workflow snapshot');

        const failingJobKey = `job-fail-key-${Date.now()}`;
        const failingJobResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock',
            idempotency_key: failingJobKey,
            attributes: {
              force_fail: true
            }
          })
        });
        expect(failingJobResponse.status).toBe(200);
        const failingJobData = assertSuccessEnvelopeData(failingJobResponse.body, 'failing job submit');
        const failingJob = assertRecord(failingJobData.job, 'failing job');
        expect(failingJob.status).toBe('pending');

        const failedReplayProbeResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({ agent_id: 'agent-001', strategy: 'mock', idempotency_key: failingJobKey })
        });
        expect(failedReplayProbeResponse.status).toBe(200);
        const failedReplayData = await pollReplayJobResult(
          server.baseUrl,
          activeIdentityHeaders,
          {
            agent_id: 'agent-001',
            strategy: 'mock',
            idempotency_key: failingJobKey
          },
          'failed job replay poll',
          data => isRecord(data.job) && data.job.status === 'failed'
        );
        expect(failedReplayData.replayed).toBe(true);
        expect(failedReplayData.result).toBeNull();
        expect(failedReplayData.result_source).toBe('not_available');
        const failedWorkflow = assertWorkflowSnapshot(failedReplayData.workflow_snapshot, 'failed replay workflow snapshot');
        const failedRecords = assertRecord(failedWorkflow.records, 'failed replay records');
        const failedDerived = assertRecord(failedWorkflow.derived, 'failed replay derived');
        expect(failedRecords.trace).toBeNull();
        expect(failedDerived.workflow_state).toBe('decision_failed');
        expect(failedDerived.failure_stage).toBe('provider');
        expect(failedDerived.failure_code).toBe('INFERENCE_PROVIDER_FAIL');

        const invalidNormalizationKey = `job-normalization-key-${Date.now()}`;
        const droppedJobKey = `job-drop-key-${Date.now()}`;
        const droppedJobResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock',
            idempotency_key: droppedJobKey,
            attributes: {
              mock_content: 'Dropped by L4 policy',
              transmission_drop_chance: 1
            }
          })
        });
        expect(droppedJobResponse.status).toBe(200);
        const droppedJobData = assertSuccessEnvelopeData(droppedJobResponse.body, 'dropped job submit');
        assertRecord(droppedJobData.job, 'dropped job');

        const normalizationJobResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock',
            idempotency_key: invalidNormalizationKey,
            attributes: {
              force_invalid_payload: true
            }
          })
        });
        expect(normalizationJobResponse.status).toBe(200);
        const normalizationReplayData = await pollReplayJobResult(
          server.baseUrl,
          activeIdentityHeaders,
          { agent_id: 'agent-001', strategy: 'mock', idempotency_key: invalidNormalizationKey },
          'normalization replay poll',
          data =>
            isRecord(data.workflow_snapshot) &&
            isRecord(data.workflow_snapshot.derived) &&
            data.workflow_snapshot.derived.failure_stage === 'dispatch'
        );
        const normalizationWorkflow = assertWorkflowSnapshot(
          normalizationReplayData.workflow_snapshot,
          'normalization workflow snapshot'
        );
        const normalizationDerived = assertRecord(normalizationWorkflow.derived, 'normalization workflow derived');
        expect(normalizationDerived.failure_stage).toBe('dispatch');
        expect(normalizationDerived.failure_code).toBe('ACTION_DISPATCH_FAIL');

        const droppedReplayResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({ agent_id: 'agent-001', strategy: 'mock', idempotency_key: droppedJobKey })
        });
        expect(droppedReplayResponse.status).toBe(200);

        const retrySubmitResponse = await requestJson(
          server.baseUrl,
          `/api/inference/jobs/${jobSubmitJob.id as string}/retry`,
          {
            method: 'POST',
            headers: activeIdentityHeaders
          }
        );
        expect(retrySubmitResponse.status).toBe(409);
        assertErrorEnvelope(retrySubmitResponse.body, 'DECISION_JOB_RETRY_INVALID', 'retry completed job');

        const missingIdempotencyResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock'
          })
        });
        expect(missingIdempotencyResponse.status).toBe(400);
        assertErrorEnvelope(missingIdempotencyResponse.body, 'INFERENCE_INPUT_INVALID', 'missing idempotency key');

        const persistedTraceResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runByMixedActorData.inference_id as string}`
        );
        expect(persistedTraceResponse.status).toBe(200);
        const persistedTraceData = assertSuccessEnvelopeData(persistedTraceResponse.body, 'persisted trace');
        expect(persistedTraceData.id).toBe(runByMixedActorData.inference_id);
        expect(persistedTraceData.kind).toBe('run');
        expect(persistedTraceData.provider).toBe('rule_based');
        expect(isRecord(persistedTraceData.prompt_bundle)).toBe(true);
        expect(isRecord(persistedTraceData.context_snapshot)).toBe(true);
        expect(isRecord(persistedTraceData.decision)).toBe(true);
        const contextSnapshot = assertRecord(persistedTraceData.context_snapshot, 'persisted trace context snapshot');
        expect(isRecord(contextSnapshot.memory_context)).toBe(true);
        expect(isRecord(contextSnapshot.memory_selection)).toBe(true);
        const memorySelection = assertRecord(contextSnapshot.memory_selection, 'persisted trace memory selection');
        expect(Array.isArray(memorySelection.selected_entry_ids)).toBe(true);
        expect(isRecord(contextSnapshot.prompt_processing_trace)).toBe(true);
        const promptProcessingTrace = assertRecord(
          contextSnapshot.prompt_processing_trace,
          'persisted trace prompt processing trace'
        );
        expect(Array.isArray(promptProcessingTrace.processor_names)).toBe(true);
        const promptBundle = assertRecord(persistedTraceData.prompt_bundle, 'persisted trace prompt bundle');
        const promptBundleMetadata = assertRecord(promptBundle.metadata, 'persisted trace prompt bundle metadata');
        const processingTrace = assertRecord(promptBundleMetadata.processing_trace, 'persisted trace bundle processing trace');
        expect(Array.isArray(processingTrace.processor_names)).toBe(true);
        expect(processingTrace.processor_names.includes('policy-filter')).toBe(true);
        expect(processingTrace.processor_names.includes('memory-summary')).toBe(true);
        expect(processingTrace.processor_names.includes('token-budget-trimmer')).toBe(true);
        const tokenBudgetTrimming = assertRecord(
          promptProcessingTrace.token_budget_trimming,
          'persisted trace token budget trimming'
        );
        expect(typeof tokenBudgetTrimming.budget).toBe('number');
        expect(Array.isArray(promptProcessingTrace.steps)).toBe(true);
        expect(
          promptProcessingTrace.steps.some(step => isRecord(step) && step.processor_name === 'policy-filter')
        ).toBe(true);
        expect(
          promptProcessingTrace.steps.some(step => isRecord(step) && step.processor_name === 'token-budget-trimmer')
        ).toBe(true);

        const persistedIntentResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runByMixedActorData.inference_id as string}/intent`
        );
        expect(persistedIntentResponse.status).toBe(200);
        const persistedIntentData = assertSuccessEnvelopeData(persistedIntentResponse.body, 'persisted intent');
        expect(persistedIntentData.source_inference_id).toBe(runByMixedActorData.inference_id);
        expect(typeof persistedIntentData.intent_type).toBe('string');
        expect(
          persistedIntentData.status === 'pending' || persistedIntentData.status === 'completed'
        ).toBe(true);

        const persistedJobResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runByMixedActorData.inference_id as string}/job`
        );
        expect(persistedJobResponse.status).toBe(200);
        const persistedJobData = assertSuccessEnvelopeData(persistedJobResponse.body, 'persisted job');
        expect(persistedJobData.source_inference_id).toBe(runByMixedActorData.inference_id);
        expect(persistedJobData.status).toBe('completed');
        expect(persistedJobData.attempt_count).toBe(1);

        const persistedTraceWorkflowResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runByMixedActorData.inference_id as string}/workflow`
        );
        expect(persistedTraceWorkflowResponse.status).toBe(200);
        const persistedTraceWorkflowData = assertWorkflowSnapshot(
          assertSuccessEnvelopeData(persistedTraceWorkflowResponse.body, 'trace workflow response'),
          'trace workflow snapshot'
        );
        expect(isRecord(persistedTraceWorkflowData.records)).toBe(true);
        expect(isRecord(persistedTraceWorkflowData.derived)).toBe(true);

        let hasDispatchedRuleBasedPost = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const dispatchedFeedResponse = await requestJson(server.baseUrl, '/api/social/feed?limit=20');
          expect(dispatchedFeedResponse.status).toBe(200);
          const dispatchedFeed = assertSuccessEnvelopeArrayData(
            dispatchedFeedResponse.body,
            'social feed after dispatch'
          );
          hasDispatchedRuleBasedPost = dispatchedFeed.some(item => {
            return typeof item.content === 'string' && item.content.includes('reports that the current situation');
          });

          if (hasDispatchedRuleBasedPost) {
            break;
          }

          await sleep(250);
        }

        expect(hasDispatchedRuleBasedPost).toBe(true);

        const settledTraceWorkflowResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runByMixedActorData.inference_id as string}/workflow`
        );
        expect(settledTraceWorkflowResponse.status).toBe(200);
        const settledTraceWorkflowData = assertWorkflowSnapshot(
          assertSuccessEnvelopeData(settledTraceWorkflowResponse.body, 'settled trace workflow response'),
          'settled trace workflow snapshot'
        );
        const settledDerived = assertRecord(settledTraceWorkflowData.derived, 'settled trace workflow derived');
        expect(
          settledDerived.workflow_state === 'workflow_completed' ||
            settledDerived.workflow_state === 'dispatch_pending' ||
            settledDerived.workflow_state === 'dispatching'
        ).toBe(true);

        const droppedReplayData = assertSuccessEnvelopeData(droppedReplayResponse.body, 'dropped job replay');
        const droppedReplayJob = assertRecord(droppedReplayData.job, 'dropped replay job');
        const droppedFeedResponse = await requestJson(server.baseUrl, '/api/social/feed?limit=20');
        expect(droppedFeedResponse.status).toBe(200);
        const droppedFeed = assertSuccessEnvelopeArrayData(droppedFeedResponse.body, 'social feed after dropped dispatch');
        const hasDroppedContent = droppedFeed.some(item => item.content === 'Dropped by L4 policy');
        expect(
          droppedReplayJob.status === 'completed' ||
            droppedReplayJob.status === 'dispatching' ||
            droppedReplayJob.status === 'pending'
        ).toBe(true);
        expect(hasDroppedContent).toBe(false);

        const completedReplayData = await pollReplayJobResult(
          server.baseUrl,
          activeIdentityHeaders,
          {
            agent_id: 'agent-001',
            identity_id: 'agent-001',
            strategy: 'rule_based',
            idempotency_key: jobIdempotencyKey
          },
          'completed job replay poll',
          data => data.result_source === 'stored_trace' && isRecord(data.workflow_snapshot)
        );
        const completedReplayWorkflow = assertWorkflowSnapshot(
          completedReplayData.workflow_snapshot,
          'completed replay workflow snapshot'
        );
        expect(isRecord(completedReplayData.result)).toBe(true);
        const completedReplayDerived = assertRecord(completedReplayWorkflow.derived, 'completed replay derived');
        expect(
          completedReplayDerived.workflow_state === 'workflow_completed' ||
            completedReplayDerived.workflow_state === 'dispatch_pending' ||
            completedReplayDerived.workflow_state === 'dispatching'
        ).toBe(true);

        const droppedSettledReplayData = await pollReplayJobResult(
          server.baseUrl,
          activeIdentityHeaders,
          { agent_id: 'agent-001', strategy: 'mock', idempotency_key: droppedJobKey },
          'dropped job replay poll',
          data =>
            data.result_source === 'stored_trace' &&
            isRecord(data.workflow_snapshot) &&
            isRecord(data.workflow_snapshot.derived) &&
            data.workflow_snapshot.derived.workflow_state === 'workflow_dropped'
        );
        const droppedSettledWorkflow = assertWorkflowSnapshot(
          droppedSettledReplayData.workflow_snapshot,
          'dropped settled workflow snapshot'
        );
        expect(isRecord(droppedSettledReplayData.result)).toBe(true);
        const droppedSettledDerived = assertRecord(droppedSettledWorkflow.derived, 'dropped settled derived');
        expect(droppedSettledDerived.dispatch_stage).toBe('dropped');
        expect(droppedSettledDerived.failure_stage).toBe('none');

        const droppedTraceWorkflowResponse = await requestJson(
          server.baseUrl,
          `/api/inference/jobs/${droppedReplayJob.id as string}/workflow`
        );
        expect(droppedTraceWorkflowResponse.status).toBe(200);
        const droppedJobWorkflow = assertWorkflowSnapshot(
          assertSuccessEnvelopeData(droppedTraceWorkflowResponse.body, 'dropped job workflow response'),
          'dropped job workflow snapshot'
        );
        const droppedJobDerived = assertRecord(droppedJobWorkflow.derived, 'dropped job workflow derived');
        expect(droppedJobDerived.failure_stage).toBe('none');

        const missingActorResponse = await requestJson(server.baseUrl, '/api/inference/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            strategy: 'mock'
          })
        });
        expect(missingActorResponse.status).toBe(400);
        assertErrorEnvelope(missingActorResponse.body, 'INFERENCE_INPUT_INVALID', 'missing actor inference run');

        const conflictingActorResponse = await requestJson(server.baseUrl, '/api/inference/run', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-002',
            identity_id: 'agent-001',
            strategy: 'rule_based'
          })
        });
        expect(conflictingActorResponse.status).toBe(400);
        assertErrorEnvelope(conflictingActorResponse.body, 'INFERENCE_INPUT_INVALID', 'conflicting actor inference run');

        const unsupportedStrategyResponse = await requestJson(server.baseUrl, '/api/inference/preview', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'future_llm'
          })
        });
        expect(unsupportedStrategyResponse.status).toBe(400);
        assertErrorEnvelope(
          unsupportedStrategyResponse.body,
          'INFERENCE_INPUT_INVALID',
          'unsupported inference strategy'
        );

        const invalidAttributesResponse = await requestJson(server.baseUrl, '/api/inference/preview', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock',
            attributes: 'invalid'
          })
        });
        expect(invalidAttributesResponse.status).toBe(400);
        assertErrorEnvelope(
          invalidAttributesResponse.body,
          'INFERENCE_INPUT_INVALID',
          'invalid preview attributes'
        );

        const missingBindingResponse = await requestJson(server.baseUrl, '/api/inference/run', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'missing-agent',
            strategy: 'mock'
          })
        });
        expect(missingBindingResponse.status).toBe(400);
        assertErrorEnvelope(
          missingBindingResponse.body,
          'INFERENCE_INPUT_INVALID',
          'missing identity binding inference run'
        );
      } else {
        expect(feedResponse.status).toBe(503);
        expect(graphResponse.status).toBe(503);
        expect(timelineResponse.status).toBe(503);

        const previewResponse = await requestJson(server.baseUrl, '/api/inference/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: 'agent-001',
            strategy: 'mock'
          })
        });
        expect(previewResponse.status).toBe(503);
        assertWorldPackNotReadyEnvelope(previewResponse.body, 'preview while runtime not ready');

        const runResponse = await requestJson(server.baseUrl, '/api/inference/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity_id: 'agent-001',
            strategy: 'rule_based'
          })
        });
        expect(runResponse.status).toBe(503);
        assertWorldPackNotReadyEnvelope(runResponse.body, 'run while runtime not ready');
      }
    });
  });
});
