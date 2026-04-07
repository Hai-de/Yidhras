import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

describe('agent overview e2e', () => {
  it('returns the overview snapshot for a seeded agent and validates query errors', async () => {
    await withIsolatedTestServer({ defaultPort: 3105 }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const overviewResponse = await requestJson(server.baseUrl, '/api/entities/agent-001/overview?limit=5');
      expect(overviewResponse.status).toBe(200);
      const overview = assertSuccessEnvelopeData(overviewResponse.body, 'entity overview response');

      const profile = assertRecord(overview.profile, 'agent overview profile');
      expect(profile.id).toBe('agent-001');
      expect(typeof profile.name).toBe('string');

      const bindingSummary = assertRecord(overview.binding_summary, 'agent overview binding_summary');
      expect(Array.isArray(bindingSummary.active)).toBe(true);
      expect(Array.isArray(bindingSummary.atmosphere)).toBe(true);
      expect(assertRecord(bindingSummary.counts, 'agent overview binding_summary.counts')).toBeTruthy();

      const relationshipSummary = assertRecord(overview.relationship_summary, 'agent overview relationship_summary');
      expect(Array.isArray(relationshipSummary.incoming)).toBe(true);
      expect(Array.isArray(relationshipSummary.outgoing)).toBe(true);
      expect(assertRecord(relationshipSummary.counts, 'agent overview relationship_summary.counts')).toBeTruthy();

      expect(Array.isArray(overview.recent_activity)).toBe(true);
      expect(Array.isArray(overview.recent_posts)).toBe(true);
      expect(Array.isArray(overview.recent_workflows)).toBe(true);
      expect(Array.isArray(overview.recent_events)).toBe(true);
      expect(Array.isArray(overview.recent_inference_results)).toBe(true);

      const snr = assertRecord(overview.snr, 'agent overview snr');
      expect(typeof snr.current).toBe('number');
      expect(Array.isArray(snr.recent_logs)).toBe(true);

      const memory = assertRecord(overview.memory, 'agent overview memory');
      const memorySummary = assertRecord(memory.summary, 'agent overview memory.summary');
      expect(typeof memorySummary.recent_trace_count).toBe('number');

      const invalidOverviewLimitResponse = await requestJson(server.baseUrl, '/api/entities/agent-001/overview?limit=abc');
      expect(invalidOverviewLimitResponse.status).toBe(400);
      assertErrorEnvelope(invalidOverviewLimitResponse.body, 'AGENT_QUERY_INVALID', 'invalid agent overview limit');

      const invalidSchedulerLimitResponse = await requestJson(
        server.baseUrl,
        '/api/agent/agent-001/scheduler/projection?limit=abc'
      );
      expect(invalidSchedulerLimitResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidSchedulerLimitResponse.body,
        'AGENT_QUERY_INVALID',
        'invalid agent scheduler projection limit'
      );

      const invalidSnrLimitResponse = await requestJson(server.baseUrl, '/api/agent/agent-001/snr/logs?limit=abc');
      expect(invalidSnrLimitResponse.status).toBe(400);
      assertErrorEnvelope(invalidSnrLimitResponse.body, 'SNR_LOG_QUERY_INVALID', 'invalid agent snr logs limit');

      const missingAgentResponse = await requestJson(server.baseUrl, '/api/entities/missing-agent/overview');
      expect(missingAgentResponse.status).toBe(404);
      assertErrorEnvelope(missingAgentResponse.body, 'AGENT_NOT_FOUND', 'missing agent overview');
    });
  });
});
