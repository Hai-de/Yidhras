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
    return 3101;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }
  return port;
};

const assertArray = (value: unknown, label: string): unknown[] => {
  assert(isRecord(value), `${label} should be envelope object`);
  assert(value.success === true, `${label} success should be true`);
  assert(Array.isArray(value.data), `${label}.data should be array`);
  return value.data as unknown[];
};

const assertErrorEnvelope = (body: unknown, expectedCode: string) => {
  assert(isRecord(body), 'error response should be object');
  assert(body.success === false, 'error response success should be false');
  assert(isRecord(body.error), 'error response.error should be object');
  assert(body.error.code === expectedCode, `error code should be ${expectedCode}`);
  assert(typeof body.error.request_id === 'string', 'error.request_id should be string');
  assert(typeof body.error.timestamp === 'number', 'error.timestamp should be number');
};

const assertWorldPackNotReadyEnvelope = (body: unknown) => {
  assertErrorEnvelope(body, 'WORLD_PACK_NOT_READY');
  assert(isRecord((body as Record<string, unknown>).error), 'WORLD_PACK_NOT_READY error should be object');
  const error = (body as Record<string, unknown>).error as Record<string, unknown>;
  assert(isRecord(error.details), 'WORLD_PACK_NOT_READY details should be object');
  assert(typeof error.details.startup_level === 'string', 'WORLD_PACK_NOT_READY details.startup_level should be string');
  assert(Array.isArray(error.details.available_world_packs), 'WORLD_PACK_NOT_READY details.available_world_packs should be array');
};

const assertSuccessEnvelope = (body: unknown): Record<string, unknown> => {
  assert(isRecord(body), 'success response should be object');
  assert(body.success === true, 'success response success should be true');
  assert('data' in body, 'success response data should exist');

  const data = body.data;
  assert(data !== null && data !== undefined, 'success response data should not be null or undefined');
  return data as Record<string, unknown>;
};

const assertWorkflowSnapshot = (value: unknown, label: string): Record<string, unknown> => {
  assert(isRecord(value), `${label} should be object`);
  assert(isRecord(value.records), `${label}.records should be object`);
  assert(isRecord(value.derived), `${label}.derived should be object`);

  const records = value.records as Record<string, unknown>;
  const derived = value.derived as Record<string, unknown>;

  assert('trace' in records, `${label}.records.trace should exist`);
  assert('job' in records, `${label}.records.job should exist`);
  assert('intent' in records, `${label}.records.intent should exist`);
  assert(typeof derived.decision_stage === 'string', `${label}.derived.decision_stage should be string`);
  assert(typeof derived.dispatch_stage === 'string', `${label}.derived.dispatch_stage should be string`);
  assert(typeof derived.workflow_state === 'string', `${label}.derived.workflow_state should be string`);
  assert(typeof derived.failure_stage === 'string', `${label}.derived.failure_stage should be string`);
  assert(isRecord(derived.outcome_summary), `${label}.derived.outcome_summary should be object`);
  return value as Record<string, unknown>;
};

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const pollReplayJobResult = async (
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  label: string,
  predicate: (data: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const replayRes = await requestJson(baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    assert(replayRes.status === 200, `${label} should return 200 while polling`);
    const replayData = assertSuccessEnvelope(replayRes.body);
    lastData = replayData;
    if (predicate(replayData)) {
      return replayData;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected replay state: ${JSON.stringify(lastData)}`);
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    const healthRes = await requestJson(server.baseUrl, '/api/health');
    assert(
      healthRes.status === 200 || healthRes.status === 503,
      `unexpected /api/health status: ${healthRes.status}`
    );
    const healthData = assertSuccessEnvelope(healthRes.body);
    assert(typeof healthData.healthy === 'boolean', '/api/health data.healthy should be boolean');

    const notificationsRes = await requestJson(server.baseUrl, '/api/system/notifications');
    assert(notificationsRes.status === 200, 'GET /api/system/notifications should return 200');
    assertArray(notificationsRes.body, '/api/system/notifications');

    const clearRes = await requestJson(server.baseUrl, '/api/system/notifications/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(clearRes.status === 200, 'POST /api/system/notifications/clear should return 200');
    const clearData = assertSuccessEnvelope(clearRes.body);
    assert(clearData.acknowledged === true, '/api/system/notifications/clear acknowledged should be true');

    const statusRes =await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelope(statusRes.body);
    assert(typeof statusData.runtime_ready === 'boolean', '/api/status data.runtime_ready should be boolean');

    const runtimeReady = statusData.runtime_ready === true;

    const clockRes = await requestJson(server.baseUrl, '/api/clock');
    if (runtimeReady) {
      assert(clockRes.status === 200, 'GET /api/clock should return 200 when runtime ready');
      const clockData = assertSuccessEnvelope(clockRes.body);
      assert(typeof clockData.absolute_ticks === 'string', '/api/clock absolute_ticks should be string');
      assert(Array.isArray(clockData.calendars), '/api/clock calendars should be array');
    } else {
      assert(clockRes.status === 503, 'GET /api/clock should return 503 when runtime not ready');
      assertWorldPackNotReadyEnvelope(clockRes.body);
    }

    const formattedClockRes = await requestJson(server.baseUrl, '/api/clock/formatted');
    if (runtimeReady) {
      assert(
        formattedClockRes.status === 200,
        'GET /api/clock/formatted should return 200 when runtime ready'
      );
      const formattedClockData = assertSuccessEnvelope(formattedClockRes.body);
      assert(typeof formattedClockData.absolute_ticks === 'string', 'formatted clock absolute_ticks should be string');
      assert(Array.isArray(formattedClockData.calendars), 'formatted clock calendars should be array');
    } else {
      assert(
        formattedClockRes.status === 503,
        'GET /api/clock/formatted should return 503 when runtime not ready'
      );
      assertWorldPackNotReadyEnvelope(formattedClockRes.body);
    }

    const pauseRes = await requestJson(server.baseUrl, '/api/clock/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' })
    });
    const resumeRes = await requestJson(server.baseUrl, '/api/clock/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' })
    });

    if (runtimeReady) {
      assert(pauseRes.status === 200, 'pause should return 200 when runtime ready');
      const pauseData = assertSuccessEnvelope(pauseRes.body);
      assert(pauseData.acknowledged === true, 'pause acknowledged should be true');
      assert(pauseData.status === 'paused', 'pause status should be paused');

      assert(resumeRes.status === 200, 'resume should return 200 when runtime ready');
      const resumeData = assertSuccessEnvelope(resumeRes.body);
      assert(resumeData.acknowledged === true, 'resume acknowledged should be true');
      assert(resumeData.status === 'running', 'resume status should be running');
    } else {
      assert(pauseRes.status === 503, 'pause should return 503 when runtime not ready');
      assert(resumeRes.status === 503, 'resume should return 503 when runtime not ready');
    }

    const feedRes = await requestJson(server.baseUrl, '/api/social/feed?limit=5');
    const graphRes = await requestJson(server.baseUrl, '/api/relational/graph');
    const timelineRes = await requestJson(server.baseUrl, '/api/narrative/timeline');

    if (runtimeReady) {
      assert(feedRes.status === 200, 'GET /api/social/feed should return 200 when runtime ready');
      assertArray(feedRes.body, '/api/social/feed');

      assert(graphRes.status === 200, 'GET /api/relational/graph should return 200 when runtime ready');
      const graphData = assertSuccessEnvelope(graphRes.body);
      assert(Array.isArray(graphData.nodes), 'graph.nodes should be array');
      assert(Array.isArray(graphData.edges), 'graph.edges should be array');

      assert(timelineRes.status === 200, 'GET /api/narrative/timeline should return 200 when runtime ready');
      assertArray(timelineRes.body, '/api/narrative/timeline');

      const overrideRes = await requestJson(server.baseUrl, '/api/runtime/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override', step_ticks: '2' })
      });
      assert(overrideRes.status === 200, 'POST /api/runtime/speed override should return 200');
      const overrideData = assertSuccessEnvelope(overrideRes.body);
      assert(isRecord(overrideData.runtime_speed), 'runtime speed override payload should include runtime_speed');
      assert(typeof overrideData.runtime_speed.override_since === 'number', 'runtime speed override should include override_since');

      const overrideClearRes = await requestJson(server.baseUrl, '/api/runtime/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' })
      });
      assert(overrideClearRes.status === 200, 'POST /api/runtime/speed clear should return 200');
      const overrideClearData = assertSuccessEnvelope(overrideClearRes.body);
      assert(isRecord(overrideClearData.runtime_speed), 'runtime speed clear payload should include runtime_speed');
      assert(overrideClearData.runtime_speed.override_since === null, 'runtime speed clear should reset override_since');

      const activeIdentityHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-001', 'agent')
      };

      const previewByAgentRes = await requestJson(server.baseUrl, '/api/inference/preview', {
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
      assert(previewByAgentRes.status === 200, 'POST /api/inference/preview by agent should return 200');
      const previewByAgentData = assertSuccessEnvelope(previewByAgentRes.body);
      assert(typeof previewByAgentData.inference_id === 'string', 'preview by agent inference_id should be string');
      assert(previewByAgentData.provider === 'mock', 'preview by agent provider should be mock');
      assert(typeof previewByAgentData.tick === 'string', 'preview by agent tick should be string');
      assert(isRecord(previewByAgentData.actor_ref), 'preview by agent actor_ref should be object');
      assert(previewByAgentData.actor_ref.role === 'active', 'preview by agent actor_ref.role should be active');
      assert(previewByAgentData.actor_ref.agent_id === 'agent-001', 'preview by agent actor_ref.agent_id should match');
      assert(isRecord(previewByAgentData.prompt), 'preview by agent prompt should be object');
      assert(typeof previewByAgentData.prompt.combined_prompt === 'string', 'preview by agent combined prompt should be string');
      assert(isRecord(previewByAgentData.metadata), 'preview by agent metadata should be object');

      const previewByIdentityRes = await requestJson(server.baseUrl, '/api/inference/preview', {
        method: 'POST',
     headers: activeIdentityHeaders,
        body: JSON.stringify({
          identity_id: 'agent-001',
          strategy: 'mock'
        })
      });
      assert(previewByIdentityRes.status === 200, 'POST /api/inference/preview by identity should return 200');
      const previewByIdentityData = assertSuccessEnvelope(previewByIdentityRes.body);
      assert(isRecord(previewByIdentityData.actor_ref), 'preview by identity actor_ref should be object');
      assert(previewByIdentityData.actor_ref.role === 'active', 'preview by identity actor_ref.role should be active');
      assert(previewByIdentityData.actor_ref.identity_id === 'agent-001', 'preview by identity actor_ref.identity_id should match');
      assert(previewByIdentityData.actor_ref.agent_id === 'agent-001', 'preview by identity actor_ref.agent_id should match');

      const atmosphereIdentityHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('user-001', 'user')
      };
      const previewAtmosphereRes = await requestJson(server.baseUrl, '/api/inference/preview', {
        method: 'POST',
        headers: atmosphereIdentityHeaders,
        body: JSON.stringify({
          identity_id: 'user-001',
          strategy: 'mock'
        })
      });
      assert(previewAtmosphereRes.status === 200, 'POST /api/inference/preview by atmosphere identity should return 200');
      const previewAtmosphereData = assertSuccessEnvelope(previewAtmosphereRes.body);
      assert(isRecord(previewAtmosphereData.actor_ref), 'preview atmosphere actor_ref should be object');
      assert(previewAtmosphereData.actor_ref.role === 'atmosphere', 'preview atmosphere actor_ref.role should be atmosphere');
      assert(previewAtmosphereData.actor_ref.identity_id === 'user-001', 'preview atmosphere actor_ref.identity_id should match');
      assert(previewAtmosphereData.actor_ref.atmosphere_node_id === 'atm-001', 'preview atmosphere node should match seeded node');
      assert(previewAtmosphereData.actor_ref.agent_id === 'agent-001', 'preview atmosphere owner agent should resolve to agent-001');

      const runByMixedActorRes = await requestJson(server.baseUrl, '/api/inference/run', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based'
        })
      });
      assert(runByMixedActorRes.status === 200, 'POST /api/inference/run with matching mixed actor should return 200');
      const runByMixedActorData = assertSuccessEnvelope(runByMixedActorRes.body);
      assert(runByMixedActorData.provider === 'rule_based', 'run by mixed actor provider should be rule_based');
      assert(typeof runByMixedActorData.tick === 'string', 'run by mixed actor tick should be string');
      assert(isRecord(runByMixedActorData.actor_ref), 'run by mixed actor actor_ref should be object');
      assert(runByMixedActorData.actor_ref.role === 'active', 'run by mixed actor actor_ref.role should be active');
      assert(isRecord(runByMixedActorData.decision), 'run by mixed actor decision should be object');
      assert(typeof runByMixedActorData.decision.action_type === 'string', 'run by mixed actor action_type should be string');
      assert(isRecord(runByMixedActorData.trace_metadata), 'run by mixed actor trace_metadata should be object');
      assert(typeof runByMixedActorData.trace_metadata.tick === 'string', 'run by mixed actor trace_metadata.tick should be string');

      const jobIdempotencyKey = `job-smoke-key-${Date.now()}`;
      const jobSubmitRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: jobIdempotencyKey
        })
      });
      assert(jobSubmitRes.status === 200, 'POST /api/inference/jobs should return 200');
      const jobSubmitData = assertSuccessEnvelope(jobSubmitRes.body);
      assert(jobSubmitData.replayed === false, 'first job submission should not be replayed');
      assert(typeof jobSubmitData.inference_id === 'string', 'job submission inference_id should be string');
      assert(isRecord(jobSubmitData.job), 'job submission job should be object');
      assert(jobSubmitData.job.status === 'pending', 'job submission job status should be pending');
      assert(jobSubmitData.job.idempotency_key === jobIdempotencyKey, 'job submission idempotency_key should match');
      assert(jobSubmitData.result === null, 'job submission should not include immediate result in async mode');
      assert(jobSubmitData.result_source === 'not_available', 'pending job should expose not_available result_source');
      const jobSubmitWorkflow = assertWorkflowSnapshot(jobSubmitData.workflow_snapshot, 'job submission workflow_snapshot');
      assert(isRecord(jobSubmitWorkflow.derived), 'job submission workflow derived should be object');
      assert((jobSubmitWorkflow.derived as Record<string, unknown>).workflow_state === 'decision_pending', 'fresh async job should expose decision_pending workflow state');

      const firstJobReadRes = await requestJson(server.baseUrl, `/api/inference/jobs/${jobSubmitData.job.id as string}`);
      assert(firstJobReadRes.status === 200, 'GET /api/inference/jobs/:id should return 200');
      const firstJobReadData = assertSuccessEnvelope(firstJobReadRes.body);
      assert(firstJobReadData.status === 'pending' || firstJobReadData.status === 'completed', 'job should be pending or completed after submit');

      const firstJobWorkflowRes = await requestJson(server.baseUrl, `/api/inference/jobs/${jobSubmitData.job.id as string}/workflow`);
      assert(firstJobWorkflowRes.status === 200, 'GET /api/inference/jobs/:id/workflow should return 200');
      assertWorkflowSnapshot(assertSuccessEnvelope(firstJobWorkflowRes.body), 'job workflow by id');

      const jobReplayRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          identity_id: 'agent-001',
          strategy: 'rule_based',
          idempotency_key: jobSubmitData.job.idempotency_key
        })
      });
      assert(jobReplayRes.status === 200, 'replayed POST /api/inference/jobs should return 200');
      const jobReplayData = assertSuccessEnvelope(jobReplayRes.body);
      assert(jobReplayData.replayed === true, 'second job submission should be replayed');
      assert(jobReplayData.inference_id === jobSubmitData.inference_id, 'replayed inference_id should match first submit');
      assert(isRecord(jobReplayData.job), 'replayed job payload should be object');
      assert(jobReplayData.job.idempotency_key === jobSubmitData.job.idempotency_key, 'replayed job idempotency_key should match');
      assert(jobReplayData.result === null || isRecord(jobReplayData.result), 'replayed job result should be null or stored result');
      assert(
        jobReplayData.result_source === 'not_available' || jobReplayData.result_source === 'stored_trace',
        'replayed job result_source should reflect pending or stored trace state'
      );
      assertWorkflowSnapshot(jobReplayData.workflow_snapshot, 'replayed job workflow_snapshot');

      const failingJobKey = `job-fail-key-${Date.now()}`;
      const failingJobRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
      assert(failingJobRes.status === 200, 'POST /api/inference/jobs with forced provider fail should enqueue job');
      const failingJobData = assertSuccessEnvelope(failingJobRes.body);
      assert(isRecord(failingJobData.job), 'failing job payload should be object');
      assert(failingJobData.job.status === 'pending', 'failing job should start as pending');

      const failedReplayRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({ agent_id: 'agent-001', strategy: 'mock', idempotency_key: failingJobKey })
      });
      assert(failedReplayRes.status === 200, 'failed job replay probe should return 200');
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
      assert(failedReplayData.replayed === true, 'failed replay should still be marked replayed');
      assert(failedReplayData.result === null, 'failed replay should not expose decision result');
      assert(failedReplayData.result_source === 'not_available', 'failed replay should keep not_available result_source');
      const failedWorkflow = assertWorkflowSnapshot(failedReplayData.workflow_snapshot, 'failed replay workflow snapshot');
      assert(isRecord(failedWorkflow.records), 'failed replay workflow records should be object');
      assert(isRecord(failedWorkflow.derived), 'failed replay workflow derived should be object');
      assert((failedWorkflow.records as Record<string, unknown>).trace === null, 'failed replay should not have persisted trace record');
      assert(
        (failedWorkflow.derived as Record<string, unknown>).workflow_state === 'decision_failed',
        'failed replay should expose decision_failed workflow state'
      );
      assert(
        (failedWorkflow.derived as Record<string, unknown>).failure_stage === 'provider',
        'failed replay should expose provider failure stage'
      );
      assert(
        (failedWorkflow.derived as Record<string, unknown>).failure_code === 'INFERENCE_PROVIDER_FAIL',
        'failed replay should expose provider failure code'
      );

      const invalidNormalizationKey = `job-normalization-key-${Date.now()}`;
      const droppedJobKey = `job-drop-key-${Date.now()}`;
      const droppedJobRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
      assert(droppedJobRes.status === 200, 'POST /api/inference/jobs with drop policy should enqueue job');
      const droppedJobData = assertSuccessEnvelope(droppedJobRes.body);
      assert(isRecord(droppedJobData.job), 'dropped job payload should be object');

      const normalizationJobRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
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
      assert(normalizationJobRes.status === 200, 'normalization probe job should enqueue');
      const normalizationReplayData = await pollReplayJobResult(
        server.baseUrl,
        activeIdentityHeaders,
        { agent_id: 'agent-001', strategy: 'mock', idempotency_key: invalidNormalizationKey },
        'normalization replay poll',
        data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.failure_stage === 'dispatch'
      );
      const normalizationWorkflow = assertWorkflowSnapshot(
        normalizationReplayData.workflow_snapshot,
        'normalization workflow snapshot'
      );
      assert(
        (normalizationWorkflow.derived as Record<string, unknown>).failure_stage === 'dispatch',
        'invalid payload replay should currently surface as dispatch-stage failure'
      );
      assert(
        (normalizationWorkflow.derived as Record<string, unknown>).failure_code === 'ACTION_DISPATCH_FAIL',
        'invalid payload replay should currently expose dispatch failure code'
      );

      const droppedReplayRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({ agent_id: 'agent-001', strategy: 'mock', idempotency_key: droppedJobKey })
      });
      assert(droppedReplayRes.status === 200, 'dropped job replay probe should return 200');

      const retrySubmitRes = await requestJson(server.baseUrl, `/api/inference/jobs/${jobSubmitData.job.id as string}/retry`, {
        method: 'POST',
        headers: activeIdentityHeaders
      });
      assert(retrySubmitRes.status === 409, 'retry on completed job should return 409');
      assertErrorEnvelope(retrySubmitRes.body, 'DECISION_JOB_RETRY_INVALID');

      const missingIdempotencyRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'mock'
        })
      });
      assert(missingIdempotencyRes.status === 400, 'POST /api/inference/jobs without idempotency_key should return 400');
      assertErrorEnvelope(missingIdempotencyRes.body, 'INFERENCE_INPUT_INVALID');

      const persistedTraceRes = await requestJson(
        server.baseUrl,
        `/api/inference/traces/${runByMixedActorData.inference_id as string}`
      );
      assert(persistedTraceRes.status === 200, 'GET /api/inference/traces/:id should return 200');
      const persistedTraceData = assertSuccessEnvelope(persistedTraceRes.body);
      assert(persistedTraceData.id === runByMixedActorData.inference_id, 'persisted trace id should match');
      assert(persistedTraceData.kind === 'run', 'persisted trace kind should be run');
      assert(persistedTraceData.provider === 'rule_based', 'persisted trace provider should be rule_based');
      assert(isRecord(persistedTraceData.prompt_bundle), 'persisted trace prompt_bundle should be object');
      assert(isRecord(persistedTraceData.context_snapshot), 'persisted trace context_snapshot should be object');
      assert(isRecord(persistedTraceData.decision), 'persisted trace decision should be object');
      assert(isRecord(persistedTraceData.context_snapshot.memory_context), 'persisted trace context_snapshot.memory_context should be object');
      assert(isRecord(persistedTraceData.context_snapshot.memory_selection), 'persisted trace context_snapshot.memory_selection should be object');
      assert(Array.isArray(persistedTraceData.context_snapshot.memory_selection.selected_entry_ids), 'persisted trace memory_selection.selected_entry_ids should be array');
      assert(isRecord(persistedTraceData.context_snapshot.prompt_processing_trace), 'persisted trace context_snapshot.prompt_processing_trace should be object');
      assert(Array.isArray(persistedTraceData.context_snapshot.prompt_processing_trace.processor_names), 'persisted trace prompt_processing_trace.processor_names should be array');
      assert(isRecord(persistedTraceData.prompt_bundle.metadata), 'persisted trace prompt_bundle.metadata should be object');
      const promptBundleMetadata = persistedTraceData.prompt_bundle.metadata as Record<string, unknown>;
      assert(
        isRecord(promptBundleMetadata.processing_trace) && Array.isArray(promptBundleMetadata.processing_trace.processor_names),
        'persisted trace prompt_bundle.metadata.processing_trace.processor_names should be array'
      );
      assert(
        isRecord(promptBundleMetadata.processing_trace) &&
          Array.isArray(promptBundleMetadata.processing_trace.processor_names) &&
          promptBundleMetadata.processing_trace.processor_names.includes('policy-filter'),
        'persisted trace prompt_bundle.metadata.processing_trace should include policy-filter'
      );
      assert(
        isRecord(promptBundleMetadata.processing_trace) &&
          Array.isArray(promptBundleMetadata.processing_trace.processor_names) &&
          promptBundleMetadata.processing_trace.processor_names.includes('memory-summary'),
        'persisted trace prompt_bundle.metadata.processing_trace should include memory-summary'
      );
      assert(
        isRecord(promptBundleMetadata.processing_trace) &&
          Array.isArray(promptBundleMetadata.processing_trace.processor_names) &&
          promptBundleMetadata.processing_trace.processor_names.includes('token-budget-trimmer'),
        'persisted trace prompt_bundle.metadata.processing_trace should include token-budget-trimmer'
      );
      assert(
        isRecord(persistedTraceData.context_snapshot.prompt_processing_trace) &&
          isRecord(persistedTraceData.context_snapshot.prompt_processing_trace.token_budget_trimming) &&
          typeof persistedTraceData.context_snapshot.prompt_processing_trace.token_budget_trimming.budget === 'number',
        'persisted trace prompt_processing_trace.token_budget_trimming should expose budget metadata'
      );
      assert(
        Array.isArray(persistedTraceData.context_snapshot.prompt_processing_trace.steps),
        'persisted trace prompt_processing_trace.steps should be array'
      );
      assert(
        persistedTraceData.context_snapshot.prompt_processing_trace.steps.some((step: unknown) =>
          isRecord(step) && step.processor_name === 'policy-filter'
        ),
        'persisted trace prompt_processing_trace.steps should include policy-filter step'
      );
      assert(
        persistedTraceData.context_snapshot.prompt_processing_trace.steps.some((step: unknown) =>
          isRecord(step) && step.processor_name === 'token-budget-trimmer'
        ),
        'persisted trace prompt_processing_trace.steps should include token-budget-trimmer step'
      );

      const persistedIntentRes = await requestJson(
        server.baseUrl,
        `/api/inference/traces/${runByMixedActorData.inference_id as string}/intent`
      );
      assert(persistedIntentRes.status === 200, 'GET /api/inference/traces/:id/intent should return 200');
      const persistedIntentData = assertSuccessEnvelope(persistedIntentRes.body);
      assert(persistedIntentData.source_inference_id === runByMixedActorData.inference_id, 'persisted intent inference id should match');
      assert(typeof persistedIntentData.intent_type === 'string', 'persisted intent type should be string');
      assert(
        persistedIntentData.status === 'pending' || persistedIntentData.status === 'completed',
        'persisted intent status should be pending or completed'
      );

      const persistedJobRes = await requestJson(
        server.baseUrl,
        `/api/inference/traces/${runByMixedActorData.inference_id as string}/job`
      );
      assert(persistedJobRes.status === 200, 'GET /api/inference/traces/:id/job should return 200');
      const persistedJobData = assertSuccessEnvelope(persistedJobRes.body);
      assert(persistedJobData.source_inference_id === runByMixedActorData.inference_id, 'persisted job inference id should match');
      assert(persistedJobData.status === 'completed', 'persisted job status should be completed');
      assert(persistedJobData.attempt_count === 1, 'persisted job attempt_count should be 1');

      const persistedTraceWorkflowRes = await requestJson(
        server.baseUrl,
        `/api/inference/traces/${runByMixedActorData.inference_id as string}/workflow`
      );
      assert(persistedTraceWorkflowRes.status === 200, 'GET /api/inference/traces/:id/workflow should return 200');
      const persistedTraceWorkflowData = assertWorkflowSnapshot(
        assertSuccessEnvelope(persistedTraceWorkflowRes.body),
        'trace workflow snapshot'
      );
      assert(isRecord(persistedTraceWorkflowData.records), 'trace workflow records should be object');
      assert(isRecord(persistedTraceWorkflowData.derived), 'trace workflow derived should be object');

      let hasDispatchedRuleBasedPost = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const dispatchedFeedRes = await requestJson(server.baseUrl, '/api/social/feed?limit=20');
        assert(dispatchedFeedRes.status === 200, 'GET /api/social/feed after dispatch should return 200');
        const dispatchedFeed = assertArray(dispatchedFeedRes.body, '/api/social/feed after dispatch');
        hasDispatchedRuleBasedPost = dispatchedFeed.some(item => {
          if (!isRecord(item)) {
            return false;
          }
          return (
            typeof item.content === 'string' &&
            item.content.includes('reports that the current situation')
          );
        });

        if (hasDispatchedRuleBasedPost) {
          break;
        }

        await sleep(250);
      }

      assert(hasDispatchedRuleBasedPost, 'action dispatcher should materialize at least one rule_based post_message into social feed');

      const settledTraceWorkflowRes = await requestJson(
        server.baseUrl,
        `/api/inference/traces/${runByMixedActorData.inference_id as string}/workflow`
      );
      assert(settledTraceWorkflowRes.status === 200, 'settled GET /api/inference/traces/:id/workflow should return 200');
      const settledTraceWorkflowData = assertWorkflowSnapshot(
        assertSuccessEnvelope(settledTraceWorkflowRes.body),
        'settled trace workflow snapshot'
      );
      assert(
        ((settledTraceWorkflowData.derived as Record<string, unknown>).workflow_state === 'workflow_completed') || ((settledTraceWorkflowData.derived as Record<string, unknown>).workflow_state === 'dispatch_pending') || ((settledTraceWorkflowData.derived as Record<string, unknown>).workflow_state === 'dispatching'),
        'settled trace workflow should expose dispatch progression or completion'
      );

      const droppedReplayData = assertSuccessEnvelope(droppedReplayRes.body);
      assert(isRecord(droppedReplayData.job), 'dropped replay job payload should be object');
      const droppedFeedRes = await requestJson(server.baseUrl, '/api/social/feed?limit=20');
      assert(droppedFeedRes.status === 200, 'GET /api/social/feed after dropped dispatch should return 200');
      const droppedFeed = assertArray(droppedFeedRes.body, '/api/social/feed after dropped dispatch');
      const hasDroppedContent = droppedFeed.some(item => {
        if (!isRecord(item)) {
          return false;
        }
        return item.content === 'Dropped by L4 policy';
      });
      assert(
        droppedReplayData.job.status === 'completed' || droppedReplayData.job.status === 'dispatching' || droppedReplayData.job.status === 'pending',
        'dropped job should keep decision side completed/pending semantics during polling window'
      );
      assert(!hasDroppedContent, 'dropped L4 intent should not materialize into social feed');

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
      assert(isRecord(completedReplayData.result), 'completed replay should expose stored decision result');
      assert(
        (completedReplayWorkflow.derived as Record<string, unknown>).workflow_state === 'workflow_completed' ||
          (completedReplayWorkflow.derived as Record<string, unknown>).workflow_state === 'dispatch_pending' ||
          (completedReplayWorkflow.derived as Record<string, unknown>).workflow_state === 'dispatching',
        'completed replay should expose completed or in-flight dispatch workflow state'
      );

      const droppedSettledReplayData = await pollReplayJobResult(
        server.baseUrl,
        activeIdentityHeaders,
        { agent_id: 'agent-001', strategy: 'mock', idempotency_key: droppedJobKey },
        'dropped job replay poll',
        data => data.result_source === 'stored_trace' && isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_dropped'
      );
      const droppedSettledWorkflow = assertWorkflowSnapshot(
        droppedSettledReplayData.workflow_snapshot,
        'dropped settled workflow snapshot'
      );
      assert(isRecord(droppedSettledReplayData.result), 'dropped replay should expose stored decision result from trace');
      assert(
        (droppedSettledWorkflow.derived as Record<string, unknown>).dispatch_stage === 'dropped',
        'dropped replay should expose dropped dispatch stage'
      );
      assert(
        (droppedSettledWorkflow.derived as Record<string, unknown>).failure_stage === 'none',
        'dropped replay should not be treated as dispatch failure'
      );

      const droppedTraceWorkflowRes = await requestJson(
        server.baseUrl,
        `/api/inference/jobs/${droppedReplayData.job.id as string}/workflow`
      );
      assert(droppedTraceWorkflowRes.status === 200, 'GET /api/inference/jobs/:id/workflow for dropped job should return 200');
      const droppedJobWorkflow = assertWorkflowSnapshot(assertSuccessEnvelope(droppedTraceWorkflowRes.body), 'dropped job workflow snapshot');
      assert(
        (droppedJobWorkflow.derived as Record<string, unknown>).failure_stage === 'none',
        'dropped job workflow should distinguish dropped from failed'
      );

      const missingActorRes = await requestJson(server.baseUrl, '/api/inference/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          strategy: 'mock'
        })
      });
      assert(missingActorRes.status === 400, 'POST /api/inference/run without actor should return 400');
      assertErrorEnvelope(missingActorRes.body, 'INFERENCE_INPUT_INVALID');

      const conflictingActorRes = await requestJson(server.baseUrl, '/api/inference/run', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-002',
          identity_id: 'agent-001',
          strategy: 'rule_based'
        })
      });
      assert(conflictingActorRes.status === 400, 'POST /api/inference/run with conflicting actor ids should return 400');
      assertErrorEnvelope(conflictingActorRes.body, 'INFERENCE_INPUT_INVALID');

      const unsupportedStrategyRes = await requestJson(server.baseUrl, '/api/inference/preview', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'future_llm'
        })
      });
      assert(unsupportedStrategyRes.status === 400, 'POST /api/inference/preview with unsupported strategy should return 400');
      assertErrorEnvelope(unsupportedStrategyRes.body, 'INFERENCE_INPUT_INVALID');

      const invalidAttributesRes = await requestJson(server.baseUrl, '/api/inference/preview', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'mock',
          attributes: 'invalid'
        })
      });
      assert(invalidAttributesRes.status === 400, 'POST /api/inference/preview with invalid attributes should return 400');
      assertErrorEnvelope(invalidAttributesRes.body, 'INFERENCE_INPUT_INVALID');

      const missingBindingRes = await requestJson(server.baseUrl, '/api/inference/run', {
        method: 'POST',
        headers: activeIdentityHeaders,
        body: JSON.stringify({
          agent_id: 'missing-agent',
          strategy: 'mock'
        })
      });
      assert(missingBindingRes.status === 400, 'POST /api/inference/run with missing binding should return 400');
      assertErrorEnvelope(missingBindingRes.body, 'INFERENCE_INPUT_INVALID');
    } else {
      assert(feedRes.status === 503, 'GET /api/social/feed should return 503 when runtime not ready');
      assert(graphRes.status === 503, 'GET /api/relational/graph should return 503 when runtime not ready');
      assert(timelineRes.status === 503, 'GET /api/narrative/timeline should return 503 when runtime not ready');

      const previewRes = await requestJson(server.baseUrl, '/api/inference/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'mock'
        })
      });
      assert(previewRes.status === 503, 'POST /api/inference/preview should return 503 when runtime not ready');
      assertWorldPackNotReadyEnvelope(previewRes.body);

      const runRes = await requestJson(server.baseUrl, '/api/inference/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity_id: 'agent-001',
          strategy: 'rule_based'
        })
      });
      assert(runRes.status === 503, 'POST /api/inference/run should return 503 when runtime not ready');
      assertWorldPackNotReadyEnvelope(runRes.body);
    }

    console.log('[smoke_endpoints] PASS');
    console.log(`[smoke_endpoints] runtime_ready=${runtimeReady}`);
  } catch (error: unknown) {
    console.error('[smoke_endpoints] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
