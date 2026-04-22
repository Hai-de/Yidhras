import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeArrayData, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson } from '../helpers/server.js';

const DEATH_NOTE_PACK_REF = 'death_note';
const DEATH_NOTE_PACK_ID = 'world-death-note';

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

describe('smoke death note scenario endpoints e2e', () => {
  it('covers social, relational, projection and scenario-bound inference reads under explicit death_note', async () => {
    await withIsolatedTestServer(
      {
        defaultPort: 3103,
        activePackRef: DEATH_NOTE_PACK_REF,
        seededPackRefs: [DEATH_NOTE_PACK_REF]
      },
      async server => {
        const statusResponse = await requestJson(server.baseUrl, '/api/status');
        expect(statusResponse.status).toBe(200);
        const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
        const worldPack = assertRecord(statusData.world_pack, '/api/status.world_pack');
        expect(statusData.runtime_ready).toBe(true);
        expect(worldPack.id).toBe(DEATH_NOTE_PACK_ID);

        const feedResponse = await requestJson(server.baseUrl, '/api/social/feed?limit=5');
        expect(feedResponse.status).toBe(200);
        assertSuccessEnvelopeArrayData(feedResponse.body, '/api/social/feed');

        const graphResponse = await requestJson(server.baseUrl, '/api/relational/graph');
        expect(graphResponse.status).toBe(200);
        const graphData = assertSuccessEnvelopeData(graphResponse.body, '/api/relational/graph');
        expect(Array.isArray(graphData.nodes)).toBe(true);
        expect(Array.isArray(graphData.edges)).toBe(true);

        const timelineResponse = await requestJson(server.baseUrl, `/api/packs/${DEATH_NOTE_PACK_ID}/projections/timeline`);
        expect(timelineResponse.status).toBe(200);
        const timelineData = assertSuccessEnvelopeData(timelineResponse.body, '/api/packs/world-death-note/projections/timeline');
        expect(Array.isArray(timelineData.timeline)).toBe(true);

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
              mock_content: 'scenario smoke preview content'
            }
          })
        });
        expect(previewByAgentResponse.status).toBe(200);
        const previewByAgentData = assertSuccessEnvelopeData(previewByAgentResponse.body, 'preview by agent');
        const previewByAgentActor = assertRecord(previewByAgentData.actor_ref, 'preview by agent actor_ref');
        expect(previewByAgentActor.role).toBe('active');
        expect(previewByAgentActor.agent_id).toBe('agent-001');
        expect(isRecord(previewByAgentData.prompt)).toBe(true);

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
        expect(previewAtmosphereActor.agent_id).toBeNull();

        const runResponse = await requestJson(server.baseUrl, '/api/inference/run', {
          method: 'POST',
          headers: activeIdentityHeaders,
          body: JSON.stringify({
            agent_id: 'agent-001',
            identity_id: 'agent-001',
            strategy: 'rule_based'
          })
        });
        expect(runResponse.status).toBe(200);
        const runData = assertSuccessEnvelopeData(runResponse.body, 'run by mixed actor');
        expect(runData.provider).toBe('rule_based');
        const runActorRef = assertRecord(runData.actor_ref, 'run by mixed actor actor_ref');
        expect(runActorRef.role).toBe('active');
        expect(isRecord(runData.decision)).toBe(true);
        expect(isRecord(runData.trace_metadata)).toBe(true);

        const persistedTraceResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runData.inference_id as string}`
        );
        expect(persistedTraceResponse.status).toBe(200);
        const persistedTraceData = assertSuccessEnvelopeData(persistedTraceResponse.body, 'persisted trace');
        expect(persistedTraceData.id).toBe(runData.inference_id);
        expect(persistedTraceData.kind).toBe('run');
        expect(persistedTraceData.provider).toBe('rule_based');
        expect(isRecord(persistedTraceData.prompt_bundle)).toBe(true);
        expect(isRecord(persistedTraceData.context_snapshot)).toBe(true);
        expect(isRecord(persistedTraceData.decision)).toBe(true);

        const persistedWorkflowResponse = await requestJson(
          server.baseUrl,
          `/api/inference/traces/${runData.inference_id as string}/workflow`
        );
        expect(persistedWorkflowResponse.status).toBe(200);
        const persistedWorkflowData = assertSuccessEnvelopeData(persistedWorkflowResponse.body, 'persisted workflow');
        expect(isRecord(persistedWorkflowData.records)).toBe(true);
        expect(isRecord(persistedWorkflowData.derived)).toBe(true);
      }
    );
  });
});
