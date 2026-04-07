import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

const PACK_ROUTE_NAME = 'world-death-note';
const NON_ACTIVE_PACK_ROUTE_NAME = 'death_note';

describe('world-pack projection endpoints e2e', () => {
  it('serves pack overview, entity overview and pack narrative projection endpoints', async () => {
    await withIsolatedTestServer({ defaultPort: 3116 }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const overviewResponse = await requestJson(server.baseUrl, `/api/packs/${PACK_ROUTE_NAME}/overview`);
      expect(overviewResponse.status).toBe(200);
      const packOverview = assertSuccessEnvelopeData(overviewResponse.body, 'pack overview');
      expect(packOverview.pack_id).toBe(PACK_ROUTE_NAME);
      expect(typeof packOverview.entity_count).toBe('number');
      expect(typeof packOverview.rule_execution_count).toBe('number');

      const mismatchedOverviewResponse = await requestJson(server.baseUrl, `/api/packs/${NON_ACTIVE_PACK_ROUTE_NAME}/overview`);
      expect(mismatchedOverviewResponse.status).toBe(409);
      assertErrorEnvelope(mismatchedOverviewResponse.body, 'PACK_ROUTE_ACTIVE_PACK_MISMATCH', 'mismatched pack overview');

      const entityOverviewResponse = await requestJson(server.baseUrl, '/api/entities/agent-001/overview?limit=5');
      expect(entityOverviewResponse.status).toBe(200);
      const entityOverview = assertSuccessEnvelopeData(entityOverviewResponse.body, 'entity overview');
      const profile = assertRecord(entityOverview.profile, 'entity overview profile');
      expect(profile.id).toBe('agent-001');
      const packProjection = assertRecord(entityOverview.pack_projection, 'entity overview pack_projection');
      expect(Array.isArray(packProjection.recent_rule_executions)).toBe(true);
      expect('entity' in packProjection).toBe(true);

      const packTimelineResponse = await requestJson(server.baseUrl, `/api/packs/${PACK_ROUTE_NAME}/projections/timeline`);
      expect(packTimelineResponse.status).toBe(200);
      const packTimeline = assertSuccessEnvelopeData(packTimelineResponse.body, 'pack timeline projection');
      const packMeta = assertRecord(packTimeline.pack, 'pack timeline pack');
      expect(packMeta.id).toBe(PACK_ROUTE_NAME);
      expect(Array.isArray(packTimeline.timeline)).toBe(true);

      const mismatchedTimelineResponse = await requestJson(server.baseUrl, `/api/packs/${NON_ACTIVE_PACK_ROUTE_NAME}/projections/timeline`);
      expect(mismatchedTimelineResponse.status).toBe(409);
      assertErrorEnvelope(mismatchedTimelineResponse.body, 'PACK_ROUTE_ACTIVE_PACK_MISMATCH', 'mismatched pack timeline');

      const summaryResponse = await requestJson(server.baseUrl, '/api/overview/summary');
      expect(summaryResponse.status).toBe(200);
      const summary = assertSuccessEnvelopeData(summaryResponse.body, 'overview summary');
      const operatorProjection = assertRecord(summary.operator_projection, 'overview operator projection');
      expect(typeof operatorProjection.entity_count).toBe('number');
      const globalProjectionIndex = assertRecord(summary.global_projection_index, 'overview global projection index');
      expect(typeof globalProjectionIndex.generated_at).toBe('string');
    });
  });
});
