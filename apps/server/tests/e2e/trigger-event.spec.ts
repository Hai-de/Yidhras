import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson, sleep } from '../helpers/server.js';

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

const isWorkflowSettled = (value: unknown): boolean => {
  return value === 'workflow_completed' || value === 'dispatch_pending';
};

describe('trigger event e2e', () => {
  it('narrativizes ritual semantic intent and exposes failed-attempt audit data', async () => {
    await withIsolatedTestServer({ defaultPort: 3110, activePackRef: DEATH_NOTE_PACK_REF }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const activeHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-001', 'agent')
      };

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
          isWorkflowSettled(data.workflow_snapshot.derived.workflow_state),
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
    });
  });

  it('keeps active/system trigger_event workflows in dispatch_pending under replay', async () => {
    await withIsolatedTestServer({ defaultPort: 3110, activePackRef: DEATH_NOTE_PACK_REF }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const activeHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-001', 'agent')
      };

      const secondaryActiveHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('agent-002', 'agent')
      };

      const systemHeaders = {
        'Content-Type': 'application/json',
        'x-m2-identity': createIdentityHeader('system', 'system')
      };

      const activeEventTitle = `Trigger Event Active ${Date.now()}`;
      const activeEventKey = `trigger-event-active-${Date.now()}`;
      const activeResponse = await requestJson(server.baseUrl, '/api/inference/jobs', {
        method: 'POST',
        headers: secondaryActiveHeaders,
        body: JSON.stringify({
          agent_id: 'agent-002',
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
        secondaryActiveHeaders,
        { agent_id: 'agent-002', strategy: 'mock', idempotency_key: activeEventKey },
        data =>
          isRecord(data.workflow_snapshot) &&
          isRecord(data.workflow_snapshot.derived) &&
          isWorkflowSettled(data.workflow_snapshot.derived.workflow_state),
        'active trigger_event replay poll'
      );
      const activeWorkflowDerived = assertRecord(assertRecord(activeReplay.workflow_snapshot, 'active trigger_event workflow snapshot').derived, 'active trigger_event workflow derived');
      expect(activeWorkflowDerived.workflow_state).toBe('dispatch_pending');
      expect(activeWorkflowDerived.dispatch_stage).toBe('pending');
      expect(activeWorkflowDerived.failure_stage).toBe('none');

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
            event_title: `Trigger Event System ${Date.now()}`,
            event_description: 'Trigger event system description',
            event_type: 'system'
          }
        })
      });
      expect(systemResponse.status).toBe(200);

      const systemReplay = await pollReplayJob(
        server.baseUrl,
        systemHeaders,
        { identity_id: 'system', strategy: 'mock', idempotency_key: systemEventKey },
        data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && isWorkflowSettled(data.workflow_snapshot.derived.workflow_state),
        'system trigger_event replay poll'
      );
      const systemWorkflowDerived = assertRecord(assertRecord(systemReplay.workflow_snapshot, 'system trigger_event workflow snapshot').derived, 'system trigger_event workflow derived');
      expect(systemWorkflowDerived.workflow_state).toBe('dispatch_pending');
      expect(systemWorkflowDerived.dispatch_stage).toBe('pending');
    });
  });

  it('rejects mismatched pack route for active runtime timeline projection', async () => {
    await withIsolatedTestServer({ defaultPort: 3110, activePackRef: DEATH_NOTE_PACK_REF }, async server => {
      const mismatchedTimelineResponse = await requestJson(server.baseUrl, '/api/packs/death_note/projections/timeline');
      expect(mismatchedTimelineResponse.status).toBe(409);
      assertErrorEnvelope(mismatchedTimelineResponse.body, 'PACK_ROUTE_ACTIVE_PACK_MISMATCH', 'mismatched trigger-event pack timeline');

      const activeTimelineResponse = await requestJson(server.baseUrl, `/api/packs/${DEATH_NOTE_ACTIVE_PACK_ID}/projections/timeline`);
      expect(activeTimelineResponse.status).toBe(200);
    });
  });
});
