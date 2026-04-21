import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson, sleep, summarizeResponse } from '../helpers/server.js';

const DEATH_NOTE_ACTIVE_PACK_ID = 'world-death-note';
const DEATH_NOTE_PACK_REF = 'death_note';

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

describe('trigger event e2e', () => {
  it('creates history/system events and fails invalid event types through workflow replay', async () => {
    await withIsolatedTestServer({ defaultPort: 3110, activePackRef: DEATH_NOTE_PACK_REF }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const activeHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-001', 'agent')
      };

      const systemHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('system', 'system')
      };

      const activeEventTitle = `Trigger Event Active ${Date.now()}`;
      const activeEventKey = `trigger-event-active-${Date.now()}`;
      const activeResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'mock',
          idempotency_key: activeEventKey,
          attributes: {
            mock_action_type: 'trigger_event',
            event_title: activeEventTitle,
            event_description: 'Trigger event active description',
            event_type: 'history'
          }
        })
      });
      expect(activeResponse.status).toBe(200);

      const activeReplay = await pollReplayJob(
        server.baseUrl,
        activeHeaders,
        { agent_id: 'agent-001', strategy: 'mock', idempotency_key: activeEventKey },
        data =>
          isRecord(data.workflow_snapshot) &&
          isRecord(data.workflow_snapshot.derived) &&
          data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
        'active trigger_event replay poll'
      );
      expect(isRecord(activeReplay.job)).toBe(true);
      const packTimelineResponse = await requestJson(server.baseUrl, `/api/packs/${DEATH_NOTE_ACTIVE_PACK_ID}/projections/timeline`);
      expect(packTimelineResponse.status).toBe(200);
      const packTimelineData = assertSuccessEnvelopeData(packTimelineResponse.body, 'pack timeline envelope') as { timeline: unknown[] };
      expect(Array.isArray(packTimelineData.timeline)).toBe(true);
      expect(
        packTimelineData.timeline.some(
          (entry: unknown) => isRecord(entry) && entry.title === activeEventTitle && entry.kind === 'event'
        )
      ).toBe(true);

      const systemEventTitle = `Trigger Event System ${Date.now()}`;
      const systemEventKey = `trigger-event-system-${Date.now()}`;
      const systemResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: systemHeaders,
        body: JSON.stringify({
          identity_id: 'system',
          strategy: 'mock',
          idempotency_key: systemEventKey,
          attributes: {
            mock_action_type: 'trigger_event',
            event_title: systemEventTitle,
            event_description: 'Trigger event system description',
            event_type: 'system'
          }
        })
      });
      expect(systemResponse.status).toBe(200);

      await pollReplayJob(
        server.baseUrl,
        systemHeaders,
        { identity_id: 'system', strategy: 'mock', idempotency_key: systemEventKey },
        data =>
          isRecord(data.workflow_snapshot) &&
          isRecord(data.workflow_snapshot.derived) &&
          data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
        'system trigger_event replay poll'
      );

      const packTimelineAfterSystemResponse = await requestJson(server.baseUrl, `/api/packs/${DEATH_NOTE_ACTIVE_PACK_ID}/projections/timeline`);
      expect(packTimelineAfterSystemResponse.status).toBe(200);
      const packTimelineAfterSystemData = assertSuccessEnvelopeData(
        packTimelineAfterSystemResponse.body,
        'pack timeline after system envelope'
      ) as { timeline: unknown[] };
      expect(Array.isArray(packTimelineAfterSystemData.timeline)).toBe(true);
      expect(
        packTimelineAfterSystemData.timeline.some(
          (entry: unknown) => isRecord(entry) && entry.title === systemEventTitle && entry.kind === 'event'
        )
      ).toBe(true);

      const ritualEventKey = `trigger-event-ritual-${Date.now()}`;
      const ritualReplay = await pollReplayJob(
        server.baseUrl,
        activeHeaders,
        {
          agent_id: 'agent-001',
          strategy: 'mock',
          idempotency_key: ritualEventKey,
          attributes: {
            mock_action_type: 'semantic_intent',
            semantic_intent_kind: 'ritual_divination',
            semantic_intent_text: 'Agent attempts to divine the target through a forbidden ritual.',
            semantic_target_ref: {
              agent_id: 'agent-002',
              entity_id: 'agent-002',
              kind: 'actor'
            }
          }
        },
        data =>
          isRecord(data.workflow_snapshot) &&
          isRecord(data.workflow_snapshot.derived) &&
          data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
        'ritual narrativized replay poll'
      );

      const ritualWorkflowSnapshot = assertRecord(ritualReplay.workflow_snapshot, 'ritual workflow snapshot');
      const ritualRecords = assertRecord(ritualWorkflowSnapshot.records, 'ritual workflow snapshot records');
      const ritualTrace = assertRecord(ritualRecords.trace, 'ritual workflow trace');
      const ritualTraceMetadata = assertRecord(ritualTrace.trace_metadata, 'ritual workflow trace metadata');
      const ritualIntentGrounding = assertRecord(ritualTraceMetadata.intent_grounding, 'ritual intent grounding');
      expect(ritualIntentGrounding.resolution_mode).toBe('narrativized');
      expect(ritualIntentGrounding.objective_effect_applied).toBe(false);

      const ritualDecision = assertRecord(ritualTrace.decision, 'ritual workflow decision');
      const ritualDecisionMeta = assertRecord(ritualDecision.meta, 'ritual workflow decision meta');
      expect(ritualDecisionMeta.semantic_outcome).toBe('failed_attempt');

      const ritualJob = assertRecord(ritualReplay.job, 'ritual workflow job');
      const ritualJobId = String(ritualJob.id);

      const ritualAuditFeedResponse = await requestJson(server.baseUrl, `/api/audit/feed?job_id=${ritualJobId}`);
      expect(ritualAuditFeedResponse.status).toBe(200);
      const ritualAuditFeedData = assertSuccessEnvelopeData(ritualAuditFeedResponse.body, 'ritual audit feed');
      expect(Array.isArray(ritualAuditFeedData.entries)).toBe(true);
      const ritualWorkflowEntry = (ritualAuditFeedData.entries as unknown[]).find(
        entry => isRecord(entry) && entry.kind === 'workflow' && entry.id === ritualJobId
      );
      expect(isRecord(ritualWorkflowEntry)).toBe(true);
      const ritualWorkflowEntryData = assertRecord((ritualWorkflowEntry as Record<string, unknown>).data, 'ritual workflow audit entry data');
      expect(ritualWorkflowEntryData.semantic_outcome).toBe('failed_attempt');
      expect(ritualWorkflowEntryData.objective_effect_applied).toBe(false);
      expect(isRecord(ritualWorkflowEntryData.intent_grounding)).toBe(true);

      const ritualDetailResponse = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${ritualJobId}`);
      expect(ritualDetailResponse.status).toBe(200);
      const ritualDetail = assertSuccessEnvelopeData(ritualDetailResponse.body, 'ritual workflow detail');
      const ritualDetailData = assertRecord(ritualDetail.data, 'ritual workflow detail data');
      expect(ritualDetailData.semantic_outcome).toBe('failed_attempt');
      expect(ritualDetailData.objective_effect_applied).toBe(false);
      const ritualRelatedRecords = assertRecord(ritualDetailData.related_records, 'ritual related records');
      const ritualEvents = ritualRelatedRecords.events;
      expect(Array.isArray(ritualEvents)).toBe(true);
      expect(
        (ritualEvents as unknown[]).some(item => {
          if (!isRecord(item)) {
            return false;
          }
          const eventData = isRecord(item.data) ? item.data : null;
          return eventData?.failed_attempt === true && eventData?.grounding_mode === 'narrativized';
        })
      ).toBe(true);

      const agentOverviewResponse = await requestJson(server.baseUrl, '/api/entities/agent-001/overview?limit=10');
      expect(agentOverviewResponse.status, summarizeResponse('ritual agent overview', agentOverviewResponse)).toBe(200);
      const agentOverview = assertSuccessEnvelopeData(agentOverviewResponse.body, 'ritual agent overview');
      expect(Array.isArray(agentOverview.recent_events)).toBe(true);
      expect(
        (agentOverview.recent_events as unknown[]).some(item => {
          if (!isRecord(item)) {
            return false;
          }
          const eventData = isRecord(item.data) ? item.data : null;
          return eventData?.failed_attempt === true && eventData?.semantic_type === 'failed_ritual_attempt';
        })
      ).toBe(true);

      const packTimelineAfterRitualResponse = await requestJson(server.baseUrl, `/api/packs/${DEATH_NOTE_ACTIVE_PACK_ID}/projections/timeline`);
      expect(packTimelineAfterRitualResponse.status).toBe(200);
      const packTimelineAfterRitualData = assertSuccessEnvelopeData(
        packTimelineAfterRitualResponse.body,
        'pack timeline after ritual envelope'
      ) as { timeline: unknown[] };
      expect(Array.isArray(packTimelineAfterRitualData.timeline)).toBe(true);
      expect(
        packTimelineAfterRitualData.timeline.some(entry => {
          if (!isRecord(entry)) {
            return false;
          }
          if (entry.kind !== 'event') {
            return false;
          }
          const data = isRecord(entry.data) ? entry.data : null;
          const impactData = data && isRecord(data.impact_data) ? data.impact_data : null;
          return impactData?.failed_attempt === true && impactData?.grounding_mode === 'narrativized';
        })
      ).toBe(true);

      const invalidTypeKey = `trigger-event-invalid-type-${Date.now()}`;
      const invalidTypeResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: activeHeaders,
        body: JSON.stringify({
          agent_id: 'agent-001',
          strategy: 'mock',
          idempotency_key: invalidTypeKey,
          attributes: {
            mock_action_type: 'trigger_event',
            event_title: `Invalid Trigger Event ${Date.now()}`,
            event_description: 'Invalid trigger event description',
            event_type: 'unsupported_type'
          }
        })
      });
      expect(invalidTypeResponse.status).toBe(200);

      const invalidTypeReplay = await pollReplayJob(
        server.baseUrl,
        activeHeaders,
        { agent_id: 'agent-001', strategy: 'mock', idempotency_key: invalidTypeKey },
        data =>
          isRecord(data.workflow_snapshot) &&
          isRecord(data.workflow_snapshot.derived) &&
          data.workflow_snapshot.derived.workflow_state === 'workflow_failed',
        'invalid trigger_event type replay poll'
      );
      const invalidTypeDerived = assertRecord(
        assertRecord(invalidTypeReplay.workflow_snapshot, 'invalid trigger_event workflow snapshot').derived,
        'invalid trigger_event workflow derived'
      );
      expect(invalidTypeDerived.failure_stage).toBe('dispatch');

      const mismatchedTimelineResponse = await requestJson(server.baseUrl, '/api/packs/death_note/projections/timeline');
      expect(mismatchedTimelineResponse.status).toBe(409);
      assertErrorEnvelope(mismatchedTimelineResponse.body, 'PACK_ROUTE_ACTIVE_PACK_MISMATCH', 'mismatched trigger-event pack timeline');
    });
  });
});
