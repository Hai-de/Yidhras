import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { requestJson, summarizeResponse } from '../helpers/server.js';
import { E2ETestKit } from '../testkit_e2e.js';

const DEATH_NOTE_PACK_ID = 'world-death-note';
const DEATH_NOTE_PACK_REF = 'death_note';

describe('world-pack projection endpoints e2e', () => {
  it('serves pack overview, entity overview and pack narrative projection endpoints', async () => {
    const kit = await E2ETestKit.create({ port: 3116, packRef: DEATH_NOTE_PACK_REF });
    try {
      await kit.startServer();
      const statusResponse = await requestJson(kit.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const overviewResponse = await requestJson(kit.baseUrl, `/api/packs/${DEATH_NOTE_PACK_ID}/overview`);
      expect(overviewResponse.status).toBe(200);
      const packOverview = assertSuccessEnvelopeData(overviewResponse.body, 'pack overview');
      expect(packOverview.pack_id).toBe(DEATH_NOTE_PACK_ID);
      expect(typeof packOverview.entity_count).toBe('number');
      expect(typeof packOverview.rule_execution_count).toBe('number');

      const mismatchedOverviewResponse = await requestJson(kit.baseUrl, `/api/packs/${DEATH_NOTE_PACK_REF}/overview`);
      expect(mismatchedOverviewResponse.status).toBe(409);
      assertErrorEnvelope(mismatchedOverviewResponse.body, 'PACK_RUNTIME_NOT_FOUND', 'mismatched pack overview');

      const entityOverviewResponse = await requestJson(kit.baseUrl, '/api/entities/agent-001/overview?limit=5');
      expect(entityOverviewResponse.status, summarizeResponse('entity overview', entityOverviewResponse)).toBe(200);
      const entityOverview = assertSuccessEnvelopeData(entityOverviewResponse.body, 'entity overview');
      const profile = assertRecord(entityOverview.profile, 'entity overview profile');
      expect(profile.id).toBe('agent-001');
      const packProjection = assertRecord(entityOverview.pack_projection, 'entity overview pack_projection');
      expect(Array.isArray(packProjection.recent_rule_executions)).toBe(true);
      expect('entity' in packProjection).toBe(true);

      const packTimelineResponse = await requestJson(kit.baseUrl, `/api/packs/${DEATH_NOTE_PACK_ID}/projections/timeline`);
      expect(packTimelineResponse.status).toBe(200);
      const packTimeline = assertSuccessEnvelopeData(packTimelineResponse.body, 'pack timeline projection');
      const packMeta = assertRecord(packTimeline.pack, 'pack timeline pack');
      expect(packMeta.id).toBe(DEATH_NOTE_PACK_ID);
      expect(Array.isArray(packTimeline.timeline)).toBe(true);

      const mismatchedTimelineResponse = await requestJson(kit.baseUrl, `/api/packs/${DEATH_NOTE_PACK_REF}/projections/timeline`);
      expect(mismatchedTimelineResponse.status).toBe(409);
      assertErrorEnvelope(mismatchedTimelineResponse.body, 'PACK_RUNTIME_NOT_FOUND', 'mismatched pack timeline');

      const summaryResponse = await requestJson(kit.baseUrl, '/api/overview/summary');
      expect(summaryResponse.status).toBe(200);
      const summary = assertSuccessEnvelopeData(summaryResponse.body, 'overview summary');
      const operatorProjection = assertRecord(summary.operator_projection, 'overview operator projection');
      expect(typeof operatorProjection.entity_count).toBe('number');
      const globalProjectionIndex = assertRecord(summary.global_projection_index, 'overview global projection index');
      expect(typeof globalProjectionIndex.generated_at).toBe('string');
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });
});
