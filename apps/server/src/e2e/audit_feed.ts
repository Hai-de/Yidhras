
import { PrismaClient } from '@prisma/client';

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
    return 3106;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }

  return port;
};

const assertSuccessEnvelope = (body: unknown): Record<string, unknown> => {
  assert(isRecord(body), 'success response should be object');
  assert(body.success === true, 'success response success should be true');
  assert(isRecord(body.data), 'success response data should be object');
  return body.data as Record<string, unknown>;
};

const createIdentityHeader = (identityId: string, type: 'agent' | 'user' | 'system' = 'agent'): string => {
  return JSON.stringify({
    id: identityId,
    type,
    name: identityId
  });
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const pollWorkflowState = async (
  baseUrl: string,
  jobId: string,
  predicate: (workflow: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> => {
  let lastData: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const workflowRes = await requestJson(baseUrl, `/api/inference/jobs/${jobId}/workflow`);
    assert(workflowRes.status === 200, 'GET workflow should return 200 while polling');
    const data = assertSuccessEnvelope(workflowRes.body);
    lastData = data;
    if (predicate(data)) {
      return data;
    }
    await sleep(500);
  }

  throw new Error(`workflow ${jobId} did not reach expected state: ${JSON.stringify(lastData)}`);
};

const prepareAuditFixtures = async (): Promise<void> => {
  const prisma = new PrismaClient();

  try {
    await prisma.relationshipAdjustmentLog.deleteMany({
      where: {
        from_id: 'agent-001',
        to_id: 'agent-002',
        type: 'friend'
      }
    });

    await prisma.relationship.deleteMany({
      where: {
        from_id: 'agent-001',
        to_id: 'agent-002',
        type: 'friend'
      }
    });

    await prisma.relationship.create({
      data: {
        from_id: 'agent-001',
        to_id: 'agent-002',
        type: 'friend',
        weight: 0.2,
        created_at: 0n,
        updated_at: 0n
      }
    });

    await prisma.sNRAdjustmentLog.deleteMany({
      where: {
        agent_id: 'agent-002'
      }
    });

    await prisma.agent.update({
      where: { id: 'agent-002' },
      data: {
        snr: 0.5,
        updated_at: 0n
      }
    });
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  const port = parsePort();
  await prepareAuditFixtures();
  const server = await startServer({ port });

  try {
    const statusRes = await requestJson(server.baseUrl, '/api/status');
    assert(statusRes.status === 200, 'GET /api/status should return 200');
    assert(isRecord(statusRes.body), '/api/status should return object');
    assert(statusRes.body.runtime_ready === true, 'audit feed test requires runtime_ready=true');

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': createIdentityHeader('agent-001', 'agent')
    };

    const messageContent = `Audit feed post ${Date.now()}`;
    const postRes = await requestJson(server.baseUrl, '/api/social/post', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: messageContent
      })
    });
    assert(postRes.status === 200, 'POST /api/social/post should return 200');
    assert(isRecord(postRes.body), 'social post response should be object');

    const workflowPostContent = `Audit workflow post ${Date.now()}`;
    const workflowPostRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: `audit-feed-post-workflow-${Date.now()}`,
        attributes: {
          mock_content: workflowPostContent
        }
      })
    });
    assert(workflowPostRes.status === 200, 'workflow post submit should return 200');
    const workflowPostData = assertSuccessEnvelope(workflowPostRes.body);
    assert(isRecord(workflowPostData.job), 'workflow post job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      workflowPostData.job.id as string,
      workflow =>
        isRecord(workflow.derived) &&
        (workflow.derived.workflow_state === 'workflow_completed' || workflow.derived.workflow_state === 'dispatching')
    );

    const relationshipKey = `audit-feed-relationship-${Date.now()}`;
    const relationshipRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: relationshipKey,
        attributes: {
          mock_action_type: 'adjust_relationship',
          target_agent_id: 'agent-002',
          relationship_type: 'friend',
          relationship_operation: 'set',
          relationship_target_weight: 0.7,
          create_if_missing: false,
          relationship_reason: 'audit_feed_relationship'
        }
      })
    });
    assert(relationshipRes.status === 200, 'adjust_relationship submit should return 200');
    const relationshipData = assertSuccessEnvelope(relationshipRes.body);
    assert(isRecord(relationshipData.job), 'relationship job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      relationshipData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const snrKey = `audit-feed-snr-${Date.now()}`;
    const snrRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: snrKey,
        attributes: {
          mock_action_type: 'adjust_snr',
          target_agent_id: 'agent-002',
          snr_operation: 'set',
          target_snr: 0.66,
          snr_reason: 'audit_feed_snr'
        }
      })
    });
    assert(snrRes.status === 200, 'adjust_snr submit should return 200');
    const snrData = assertSuccessEnvelope(snrRes.body);
    assert(isRecord(snrData.job), 'snr job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      snrData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const eventTitle = `Audit Feed Event ${Date.now()}`;
    const eventRes = await requestJson(server.baseUrl, '/api/inference/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: 'agent-001',
        strategy: 'mock',
        idempotency_key: `audit-feed-event-${Date.now()}`,
        attributes: {
          mock_action_type: 'trigger_event',
          event_type: 'interaction',
          event_title: eventTitle,
          event_description: 'Audit feed event description'
        }
      })
    });
    assert(eventRes.status === 200, 'trigger_event submit should return 200');
    const eventData = assertSuccessEnvelope(eventRes.body);
    assert(isRecord(eventData.job), 'event job payload should be object');

    await pollWorkflowState(
      server.baseUrl,
      eventData.job.id as string,
      workflow => isRecord(workflow.derived) && workflow.derived.workflow_state === 'workflow_completed'
    );

    const auditRes = await requestJson(server.baseUrl, '/api/audit/feed?limit=20');
    assert(auditRes.status === 200, 'GET /api/audit/feed should return 200');
    assert(isRecord(auditRes.body), 'audit feed response should be object');
    assert(Array.isArray(auditRes.body.entries), 'audit feed entries should be array');
    assert(isRecord(auditRes.body.summary), 'audit feed summary should be object');

    const entries = auditRes.body.entries as unknown[];
    assert(entries.length > 0, 'audit feed should return at least one entry');

    const kinds = new Set<string>();
    for (const entry of entries) {
      assert(isRecord(entry), 'audit feed entry should be object');
      assert(typeof entry.kind === 'string', 'audit feed entry.kind should be string');
      assert(typeof entry.id === 'string', 'audit feed entry.id should be string');
      assert(typeof entry.created_at === 'string', 'audit feed entry.created_at should be string');
      assert(isRecord(entry.refs), 'audit feed entry.refs should be object');
      assert(typeof entry.summary === 'string', 'audit feed entry.summary should be string');
      assert(isRecord(entry.data), 'audit feed entry.data should be object');
      kinds.add(entry.kind);
    }

    assert(kinds.has('workflow'), 'audit feed should include workflow entries');
    assert(kinds.has('post'), 'audit feed should include post entries');
    assert(kinds.has('relationship_adjustment'), 'audit feed should include relationship adjustment entries');
    assert(kinds.has('snr_adjustment'), 'audit feed should include snr adjustment entries');
    assert(kinds.has('event'), 'audit feed should include event entries');

    const workflowEntry = entries.find(entry => isRecord(entry) && entry.kind === 'workflow');
    assert(isRecord(workflowEntry), 'audit feed should include a workflow entry object');
    assert(isRecord(workflowEntry.data), 'workflow audit entry data should be object');
    assert(typeof workflowEntry.data.workflow_state === 'string', 'workflow audit entry should expose workflow_state');
    assert('decision_stage' in workflowEntry.data, 'workflow audit entry should expose decision_stage');
    assert('dispatch_stage' in workflowEntry.data, 'workflow audit entry should expose dispatch_stage');

    const hasSummary = (entry: unknown): entry is Record<string, unknown> & { summary: string; kind: string } => {
      return isRecord(entry) && typeof entry.kind === 'string' && typeof entry.summary === 'string';
    };

    const hasRefs = (entry: unknown): entry is Record<string, unknown> & { refs: Record<string, unknown> } => {
      return isRecord(entry) && isRecord(entry.refs);
    };

    const postOnlyRes = await requestJson(server.baseUrl, '/api/audit/feed?limit=20&kinds=post&agent_id=agent-001');
    assert(postOnlyRes.status === 200, 'post-only audit feed should return 200');
    assert(isRecord(postOnlyRes.body), 'post-only audit feed response should be object');
    assert(Array.isArray(postOnlyRes.body.entries), 'post-only audit feed entries should be array');
    const postEntries = postOnlyRes.body.entries as unknown[];

    const postEntry = postEntries.find(entry => hasSummary(entry) && entry.kind === 'post' && entry.summary.includes(messageContent));
    assert(isRecord(postEntry), 'audit feed should include created social post entry');

    const workflowPostEntry = postEntries.find(
      entry => hasSummary(entry) && entry.kind === 'post' && entry.summary.includes(workflowPostContent)
    );
    assert(isRecord(workflowPostEntry), 'audit feed should include workflow-dispatched social post entry');

    const relationshipEntry = entries.find(
      entry => hasSummary(entry) && entry.kind === 'relationship_adjustment' && entry.summary.includes('agent-001 -> agent-002')
    );
    assert(isRecord(relationshipEntry), 'audit feed should include relationship adjustment entry');

    const snrEntry = entries.find(
      entry => hasSummary(entry) && entry.kind === 'snr_adjustment' && entry.summary.includes('0.5 -> 0.66')
    );
    assert(isRecord(snrEntry), 'audit feed should include snr adjustment entry');

    const eventEntry = entries.find(
      entry => hasSummary(entry) && entry.kind === 'event' && entry.summary.includes(eventTitle)
    );
    assert(hasRefs(workflowPostEntry), 'workflow post entry should expose refs object');
    assert(typeof workflowPostEntry.refs.action_intent_id === 'string', 'workflow post entry should expose action_intent_id provenance');
    assert(isRecord(eventEntry), 'audit feed should include triggered event entry');
    assert(hasRefs(snrEntry), 'snr audit entry should expose refs object');

    assert(typeof snrEntry.refs.action_intent_id === 'string', 'snr audit entry should expose action_intent_id ref');

    const filteredRes = await requestJson(server.baseUrl, '/api/audit/feed?limit=10&kinds=snr_adjustment,event');
    assert(filteredRes.status === 200, 'filtered audit feed should return 200');
    assert(isRecord(filteredRes.body), 'filtered audit feed response should be object');
    assert(Array.isArray(filteredRes.body.entries), 'filtered audit feed entries should be array');
    assert(isRecord(filteredRes.body.summary), 'filtered audit feed summary should be object');
    assert(Array.isArray(filteredRes.body.summary.applied_kinds), 'filtered audit feed summary.applied_kinds should be array');
    assert(isRecord(filteredRes.body.summary.filters), 'filtered audit feed summary.filters should be object');
    assert(
      filteredRes.body.entries.every(entry => isRecord(entry) && (entry.kind === 'snr_adjustment' || entry.kind === 'event')),
      'filtered audit feed should only contain requested kinds'
    );

    const agentFilteredRes = await requestJson(server.baseUrl, '/api/audit/feed?limit=20&agent_id=agent-002');
    assert(agentFilteredRes.status === 200, 'agent filtered audit feed should return 200');
    assert(isRecord(agentFilteredRes.body), 'agent filtered audit feed response should be object');
    assert(Array.isArray(agentFilteredRes.body.entries), 'agent filtered audit feed entries should be array');
    assert(isRecord(agentFilteredRes.body.summary), 'agent filtered audit feed summary should be object');
    assert(isRecord(agentFilteredRes.body.summary.filters), 'agent filtered audit feed summary.filters should be object');
    assert(agentFilteredRes.body.summary.filters.agent_id === 'agent-002', 'agent filtered audit feed should echo agent_id filter');
    assert(agentFilteredRes.body.entries.length > 0, 'agent filtered audit feed should return matching entries');
    assert(
      agentFilteredRes.body.entries.every(entry => isRecord(entry) && entry.kind !== 'post'),
      'agent filtered audit feed for agent-002 should exclude unrelated post entries authored by agent-001'
    );
    assert(
      agentFilteredRes.body.entries.some(entry => isRecord(entry) && entry.kind === 'snr_adjustment'),
      'agent filtered audit feed should include snr adjustment for target agent'
    );

    const snrActionIntentId = snrEntry.refs.action_intent_id as string;
    const actionIntentFilteredRes = await requestJson(server.baseUrl, `/api/audit/feed?limit=20&action_intent_id=${snrActionIntentId}`);
    assert(actionIntentFilteredRes.status === 200, 'action_intent filtered audit feed should return 200');
    assert(isRecord(actionIntentFilteredRes.body), 'action_intent filtered audit feed response should be object');
    assert(Array.isArray(actionIntentFilteredRes.body.entries), 'action_intent filtered audit feed entries should be array');
    assert(isRecord(actionIntentFilteredRes.body.summary), 'action_intent filtered audit feed summary should be object');
    assert(isRecord(actionIntentFilteredRes.body.summary.filters), 'action_intent filtered audit feed summary.filters should be object');
    assert(actionIntentFilteredRes.body.summary.filters.action_intent_id === snrActionIntentId, 'action_intent filtered audit feed should echo action_intent_id filter');
    assert(actionIntentFilteredRes.body.entries.length >= 1, 'action_intent filtered audit feed should return at least one matching entry');
    assert(
      actionIntentFilteredRes.body.entries.every(
        entry =>
          isRecord(entry) &&
          isRecord(entry.refs) &&
          entry.refs.action_intent_id === snrActionIntentId
      ),
      'action_intent filtered audit feed should only contain entries linked to the requested action_intent_id'
    );

    const workflowPostActionIntentId = workflowPostEntry.refs.action_intent_id as string;
    const postActionIntentFilteredRes = await requestJson(server.baseUrl, `/api/audit/feed?limit=20&action_intent_id=${workflowPostActionIntentId}`);
    assert(postActionIntentFilteredRes.status === 200, 'post action_intent filtered audit feed should return 200');
    assert(isRecord(postActionIntentFilteredRes.body), 'post action_intent filtered audit feed response should be object');
    assert(Array.isArray(postActionIntentFilteredRes.body.entries), 'post action_intent filtered audit feed entries should be array');
    assert(
      postActionIntentFilteredRes.body.entries.some(
        entry => isRecord(entry) && entry.kind === 'post' && isRecord(entry.refs) && entry.refs.action_intent_id === workflowPostActionIntentId
      ),
      'post action_intent filtered audit feed should include post entry provenance'
    );

    assert(isRecord(workflowEntry.refs), 'workflow audit entry should expose refs object');
    assert(typeof workflowEntry.refs.job_id === 'string', 'workflow audit entry should expose job_id ref');
    assert(typeof workflowEntry.refs.inference_id === 'string', 'workflow audit entry should expose inference_id ref');
    const workflowJobId = workflowEntry.refs.job_id;
    const workflowInferenceId = workflowEntry.refs.inference_id;

    const jobFilteredRes = await requestJson(server.baseUrl, `/api/audit/feed?limit=20&job_id=${workflowJobId}`);
    assert(jobFilteredRes.status === 200, 'job filtered audit feed should return 200');
    assert(isRecord(jobFilteredRes.body), 'job filtered audit feed response should be object');
    assert(Array.isArray(jobFilteredRes.body.entries), 'job filtered audit feed entries should be array');
    assert(isRecord(jobFilteredRes.body.summary), 'job filtered audit feed summary should be object');
    assert(isRecord(jobFilteredRes.body.summary.filters), 'job filtered audit feed summary.filters should be object');
    assert(jobFilteredRes.body.summary.filters.job_id === workflowJobId, 'job filtered audit feed should echo job_id filter');
    assert(jobFilteredRes.body.entries.length >= 1, 'job filtered audit feed should return at least one matching entry');
    assert(
      jobFilteredRes.body.entries.every(entry => isRecord(entry) && isRecord(entry.refs) && entry.refs.job_id === workflowJobId),
      'job filtered audit feed should only contain entries linked to the requested job_id'
    );

    const inferenceFilteredRes = await requestJson(server.baseUrl, `/api/audit/feed?limit=20&inference_id=${workflowInferenceId}`);
    assert(inferenceFilteredRes.status === 200, 'inference filtered audit feed should return 200');
    assert(isRecord(inferenceFilteredRes.body), 'inference filtered audit feed response should be object');
    assert(Array.isArray(inferenceFilteredRes.body.entries), 'inference filtered audit feed entries should be array');
    assert(isRecord(inferenceFilteredRes.body.summary), 'inference filtered audit feed summary should be object');
    assert(isRecord(inferenceFilteredRes.body.summary.filters), 'inference filtered audit feed summary.filters should be object');
    assert(inferenceFilteredRes.body.summary.filters.inference_id === workflowInferenceId, 'inference filtered audit feed should echo inference_id filter');
    assert(inferenceFilteredRes.body.entries.length >= 1, 'inference filtered audit feed should return at least one matching entry');
    assert(
      inferenceFilteredRes.body.entries.every(entry => isRecord(entry) && isRecord(entry.refs) && entry.refs.inference_id === workflowInferenceId),
      'inference filtered audit feed should only contain entries linked to the requested inference_id'
    );

    const rangeFilteredRes = await requestJson(server.baseUrl, `/api/audit/feed?limit=20&from_tick=1&to_tick=1`);
    assert(rangeFilteredRes.status === 200, 'range filtered audit feed should return 200');
    assert(isRecord(rangeFilteredRes.body), 'range filtered audit feed response should be object');
    assert(Array.isArray(rangeFilteredRes.body.entries), 'range filtered audit feed entries should be array');
    assert(isRecord(rangeFilteredRes.body.summary), 'range filtered audit feed summary should be object');
    assert(isRecord(rangeFilteredRes.body.summary.filters), 'range filtered audit feed summary.filters should be object');
    assert(rangeFilteredRes.body.summary.filters.from_tick === '1', 'range filtered audit feed should echo from_tick');
    assert(rangeFilteredRes.body.summary.filters.to_tick === '1', 'range filtered audit feed should echo to_tick');
    assert(rangeFilteredRes.body.entries.every(entry => isRecord(entry) && entry.created_at === '1'), 'range filtered audit feed should only contain entries within tick range');

    const firstPageRes = await requestJson(server.baseUrl, '/api/audit/feed?limit=2');
    assert(firstPageRes.status === 200, 'first cursor page should return 200');
    assert(isRecord(firstPageRes.body), 'first cursor page response should be object');
    assert(Array.isArray(firstPageRes.body.entries), 'first cursor page entries should be array');
    assert(isRecord(firstPageRes.body.summary), 'first cursor page summary should be object');
    assert(isRecord(firstPageRes.body.summary.page_info), 'first cursor page summary.page_info should be object');
    const firstPageBody = firstPageRes.body;
    const firstPageEntries = firstPageBody.entries as unknown[];
    assert(firstPageRes.body.entries.length === 2, 'first cursor page should return limit-sized entries when enough data exists');
    assert(firstPageRes.body.summary.page_info.has_next_page === true, 'first cursor page should indicate next page exists');
    assert(typeof firstPageRes.body.summary.page_info.next_cursor === 'string', 'first cursor page should return next_cursor string');

    const secondPageRes = await requestJson(server.baseUrl, `/api/audit/feed?limit=2&cursor=${encodeURIComponent(firstPageRes.body.summary.page_info.next_cursor as string)}`);
    assert(secondPageRes.status === 200, 'second cursor page should return 200');
    assert(isRecord(secondPageRes.body), 'second cursor page response should be object');
    assert(Array.isArray(secondPageRes.body.entries), 'second cursor page entries should be array');
    assert(secondPageRes.body.entries.length >= 1, 'second cursor page should return remaining entries');
    assert(
      secondPageRes.body.entries.every(secondEntry => isRecord(secondEntry) && !firstPageEntries.some((firstEntry: unknown) => isRecord(firstEntry) && firstEntry.kind === secondEntry.kind && firstEntry.id === secondEntry.id)),
      'cursor pagination pages should not overlap'
    );

    const workflowDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/workflow/${workflowJobId}`);
    assert(workflowDetailRes.status === 200, 'workflow audit detail should return 200');
    assert(isRecord(workflowDetailRes.body), 'workflow audit detail should be object');
    assert(workflowDetailRes.body.kind === 'workflow', 'workflow audit detail kind should be workflow');
    assert(workflowDetailRes.body.id === workflowJobId, 'workflow audit detail id should match');
    assert(isRecord(workflowDetailRes.body.refs), 'workflow audit detail refs should be object');
    assert(workflowDetailRes.body.refs.job_id === workflowJobId, 'workflow audit detail refs.job_id should match');
    assert(isRecord(workflowDetailRes.body.data), 'workflow audit detail data should be object');
    assert(isRecord(workflowDetailRes.body.data.related_counts), 'workflow audit detail should expose related_counts');
    assert(isRecord(workflowDetailRes.body.data.related_records), 'workflow audit detail should expose related_records');
    assert(Array.isArray(workflowDetailRes.body.data.related_records.posts), 'workflow audit detail should expose related post records');
    assert(Array.isArray(workflowDetailRes.body.data.related_records.events), 'workflow audit detail should expose related event records');
    assert(Array.isArray(workflowDetailRes.body.data.related_records.relationship_adjustments), 'workflow audit detail should expose related relationship adjustments');
    assert(isRecord(workflowDetailRes.body.data.lineage_detail), 'workflow audit detail should expose lineage_detail');
    assert('parent_workflow' in workflowDetailRes.body.data.lineage_detail, 'workflow audit detail lineage_detail should expose parent_workflow');
    assert(Array.isArray(workflowDetailRes.body.data.lineage_detail.child_workflows), 'workflow audit detail lineage_detail should expose child_workflows');
    if (workflowDetailRes.body.data.lineage_detail.parent_workflow !== null) {
      assert(isRecord(workflowDetailRes.body.data.lineage_detail.parent_workflow), 'workflow audit detail parent_workflow should be object when present');
      assert('workflow_state' in workflowDetailRes.body.data.lineage_detail.parent_workflow, 'workflow audit detail parent_workflow should expose workflow_state');
      assert('intent_type' in workflowDetailRes.body.data.lineage_detail.parent_workflow, 'workflow audit detail parent_workflow should expose intent_type');
    }

    const postDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/post/${workflowPostEntry.id as string}`);
    assert(postDetailRes.status === 200, 'post audit detail should return 200');
    assert(isRecord(postDetailRes.body), 'post audit detail should be object');
    assert(postDetailRes.body.kind === 'post', 'post audit detail kind should be post');
    assert(isRecord(postDetailRes.body.refs), 'post audit detail refs should be object');
    assert(postDetailRes.body.refs.action_intent_id === workflowPostActionIntentId, 'post audit detail should preserve action intent provenance');

    const relationshipDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/relationship_adjustment/${relationshipEntry.id as string}`);
    assert(relationshipDetailRes.status === 200, 'relationship audit detail should return 200');
    assert(isRecord(relationshipDetailRes.body), 'relationship audit detail should be object');
    assert(relationshipDetailRes.body.kind === 'relationship_adjustment', 'relationship audit detail kind should match');
    assert(isRecord(relationshipDetailRes.body.data), 'relationship audit detail data should be object');
    assert(relationshipDetailRes.body.data.type === 'friend', 'relationship audit detail should preserve relationship type');
    assert(isRecord(relationshipDetailRes.body.data.resolved_intent), 'relationship audit detail should expose resolved_intent');
    assert(isRecord(relationshipDetailRes.body.data.resolved_intent.intent), 'relationship audit detail resolved_intent.intent should be object');
    assert(isRecord(relationshipDetailRes.body.data.resolved_intent.result), 'relationship audit detail resolved_intent.result should be object');
    assert(isRecord(relationshipDetailRes.body.data.resolved_intent.result.absolute), 'relationship audit detail resolved_intent.result.absolute should be object');
    assert(relationshipDetailRes.body.data.resolved_intent.result.absolute.weight === 0.7, 'relationship audit detail resolved_intent should preserve absolute weight');

    const snrDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/snr_adjustment/${snrEntry.id as string}`);
    assert(snrDetailRes.status === 200, 'snr audit detail should return 200');
    assert(isRecord(snrDetailRes.body), 'snr audit detail should be object');
    assert(snrDetailRes.body.kind === 'snr_adjustment', 'snr audit detail kind should match');
    assert(isRecord(snrDetailRes.body.data), 'snr audit detail data should be object');
    assert(snrDetailRes.body.data.resolved_value === 0.66, 'snr audit detail should preserve resolved_value');
    assert(isRecord(snrDetailRes.body.data.resolved_intent), 'snr audit detail should expose resolved_intent');
    assert(isRecord(snrDetailRes.body.data.resolved_intent.intent), 'snr audit detail resolved_intent.intent should be object');
    assert(isRecord(snrDetailRes.body.data.resolved_intent.result), 'snr audit detail resolved_intent.result should be object');
    assert(isRecord(snrDetailRes.body.data.resolved_intent.result.absolute), 'snr audit detail resolved_intent.result.absolute should be object');
    assert(snrDetailRes.body.data.resolved_intent.result.absolute.value === 0.66, 'snr audit detail resolved_intent should preserve absolute value');

    const eventDetailRes = await requestJson(server.baseUrl, `/api/audit/entries/event/${eventEntry.id as string}`);
    assert(eventDetailRes.status === 200, 'event audit detail should return 200');
    assert(isRecord(eventDetailRes.body), 'event audit detail should be object');
    assert(eventDetailRes.body.kind === 'event', 'event audit detail kind should match');
    assert(isRecord(eventDetailRes.body.data), 'event audit detail data should be object');
    assert(eventDetailRes.body.data.title === eventTitle, 'event audit detail should preserve title');

    const missingDetailRes = await requestJson(server.baseUrl, '/api/audit/entries/post/not-found-entry');
    assert(missingDetailRes.status === 404, 'missing audit detail should return 404');
    assert(isRecord(missingDetailRes.body), 'missing audit detail error response should be object');
    assert(missingDetailRes.body.success === false, 'missing audit detail should return error envelope');

    console.log('[audit_feed] PASS');
  } catch (error: unknown) {
    console.error('[audit_feed] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling audit_feed failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
  }
};

void main();
