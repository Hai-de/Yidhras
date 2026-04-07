import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson, sleep } from '../helpers/server.js';

const ACTIVE_PACK_ROUTE_NAME = 'world-death-note';

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
    await withIsolatedTestServer({ defaultPort: 3110 }, async server => {
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

      const packTimelineResponse = await requestJson(server.baseUrl, `/api/packs/${ACTIVE_PACK_ROUTE_NAME}/projections/timeline`);
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

      const packTimelineAfterSystemResponse = await requestJson(server.baseUrl, `/api/packs/${ACTIVE_PACK_ROUTE_NAME}/projections/timeline`);
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
