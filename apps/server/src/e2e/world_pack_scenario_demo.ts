import { assert, isRecord, requestJson, startServer, summarizeResponse } from './helpers.js';
import { assertSuccessEnvelopeData } from './status_helpers.js';

const parsePort = (): number => {
  const value = process.env.SMOKE_PORT;
  if (!value) {
    return 3103;
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

const pollJobUntil = async (
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  predicate: (data: Record<string, unknown>) => boolean,
  label: string
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const res = await requestJson(baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    assert(res.status === 200, `${label} should return 200 while polling`);
    const data = assertSuccessEnvelopeData(res.body, label);
    lastData = data;
    if (predicate(data)) {
      return data;
    }
    await sleep(500);
  }

  throw new Error(`${label} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port, prepareRuntime: true });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    const statusData = assertSuccessEnvelopeData(statusRes.body, '/api/status');
    assert(statusData.runtime_ready === true, 'world_pack_scenario_demo requires runtime_ready=true');
    assert(isRecord(statusData.world_pack), 'world_pack_scenario_demo requires active world pack metadata');
    assert(statusData.world_pack.id === 'world-death-note', 'active world pack should be death_note');

    const lightHeaders = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-light', 'agent')
    };

    const previewRes = await requestJson(server.baseUrl, '/api/inference/preview', {
      method: 'POST',
      headers: lightHeaders,
      body: JSON.stringify({
        identity_id: 'agent-light',
        strategy: 'rule_based',
        attributes: {
          latest_event_semantic_type: 'notebook_discovered'
        }
      })
    });
    assert(previewRes.status === 200, 'POST /api/inference/preview should return 200 when pack identity is materialized');
    const previewData = assertSuccessEnvelopeData(previewRes.body, 'agent-light preview');
    assert(isRecord(previewData.actor_ref), 'preview should expose actor_ref');
    assert(previewData.actor_ref.identity_id === 'agent-light', 'preview should resolve pack identity_id=agent-light');
    assert(isRecord(previewData.prompt), 'preview should expose prompt bundle');
    const prompt = previewData.prompt as Record<string, unknown>;
    assert(typeof prompt.role_prompt === 'string', 'preview prompt should include role_prompt');
    assert((prompt.role_prompt as string).includes('Pack actor roles:'), 'role_prompt should include pack actor roles context');

    const claimJobKey = `pack-claim-death-note-${Date.now()}`;
    const claimReplay = await pollJobUntil(
      server.baseUrl,
      lightHeaders,
      {
        identity_id: 'agent-light',
        strategy: 'rule_based',
        idempotency_key: claimJobKey,
        attributes: {
          latest_event_semantic_type: 'notebook_discovered'
        }
      },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'claim_death_note workflow poll'
    );

    assert(isRecord(claimReplay.result), 'claim replay should expose result');
    assert(isRecord(claimReplay.result.decision) && claimReplay.result.decision.action_type === 'claim_death_note', 'first pack rule should materialize claim_death_note');

    const timelineAfterClaimRes = await requestJson(server.baseUrl, '/api/narrative/timeline');
    assert(timelineAfterClaimRes.status === 200, 'timeline after claim should return 200');
    assert(isRecord(timelineAfterClaimRes.body), 'timeline after claim should be envelope object');
    assert(Array.isArray(timelineAfterClaimRes.body.data), 'timeline after claim should contain data array');
    const claimTimelineEntries = timelineAfterClaimRes.body.data as unknown[];
    assert(
      claimTimelineEntries.some(
        entry => isRecord(entry) && entry.type === 'history' && entry.title === '夜神月 捡到了 死亡笔记'
      ),
      'timeline should contain notebook_claimed event emitted by claim_artifact'
    );

    const intentJobKey = `pack-rule-murderous-intent-${Date.now()}`;
    const intentReplay = await pollJobUntil(
      server.baseUrl,
      lightHeaders,
      {
        identity_id: 'agent-light',
        strategy: 'rule_based',
        idempotency_key: intentJobKey,
        attributes: {
          latest_event_semantic_type: 'notebook_claimed'
        }
      },
      data => isRecord(data.workflow_snapshot) && isRecord(data.workflow_snapshot.derived) && data.workflow_snapshot.derived.workflow_state === 'workflow_completed',
      'pack rule murderous_intent workflow poll'
    );

    assert(isRecord(intentReplay.job), 'pack rule replay should include job');
    assert(isRecord(intentReplay.workflow_snapshot), 'pack rule replay should expose workflow_snapshot');
    assert(isRecord(intentReplay.result), 'pack rule replay should expose result');
    assert(isRecord(intentReplay.result.decision) && intentReplay.result.decision.action_type === 'form_murderous_intent', 'second pack rule should materialize form_murderous_intent decision');

    const timelineRes = await requestJson(server.baseUrl, '/api/narrative/timeline');
    assert(timelineRes.status === 200, 'GET /api/narrative/timeline should return 200');
    assert(isRecord(timelineRes.body), 'timeline response should be envelope object');
    assert(Array.isArray(timelineRes.body.data), 'timeline response should contain data array');
    const timelineEntries = timelineRes.body.data as unknown[];
    assert(
      timelineEntries.some(
        entry =>
          isRecord(entry)
          && entry.type === 'history'
          && entry.title === '夜神月 产生了杀意'
      ),
      'timeline should contain murderous_intent_formed event emitted by pack template'
    );

    const schedulerRes = await requestJson(server.baseUrl, '/api/agent/agent-light/scheduler/projection?limit=10');
    assert(schedulerRes.status === 200, 'GET /api/agent/agent-light/scheduler/projection should return 200');
    const schedulerProjection = assertSuccessEnvelopeData(schedulerRes.body, 'agent-light scheduler projection');
    assert(Array.isArray(schedulerProjection.timeline), 'agent-light scheduler projection should include timeline');

    console.log('[world_pack_scenario_demo] PASS');
  } catch (error: unknown) {
    console.error('[world_pack_scenario_demo] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling world_pack_scenario_demo failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
