import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppInfrastructure } from '../../src/app/context.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import { createPrismaInferenceTraceSink } from '../../src/inference/sinks/prisma.js';
import type { InferenceTraceEvent } from '../../src/inference/trace_sink.js';
import { expectDefined } from '../helpers/assertions.js';
import type { IsolatedRuntimeEnvironment } from '../helpers/runtime.js';
import {
  createIsolatedRuntimeEnvironment,
  createPrismaClientForEnvironment,
  migrateIsolatedDatabase
} from '../helpers/runtime.js';

const createTraceEvent = (overrides?: Partial<InferenceTraceEvent>): InferenceTraceEvent => {
  const contextRun = {
    id: 'ctx-workflow-source',
    created_at_tick: '100',
    selected_node_ids: [],
    nodes: [],
    diagnostics: {
      source_adapter_names: [],
      node_count: 0,
      node_counts_by_type: {},
      selected_node_ids: [],
      selected_node_summaries: [],
      policy_decisions: [],
      blocked_nodes: [],
      locked_nodes: [],
      visibility_denials: [],
      overlay_nodes_loaded: [],
      overlay_nodes_mutated: [],
      memory_block_mutations: [],
      memory_blocks: null,
      submitted_directives: [],
      approved_directives: [],
      denied_directives: [],
      dropped_nodes: [],
      prompt_assembly: null
    }
  };

  const actorRef = {
    identity_id: 'identity-workflow-source',
    identity_type: 'agent' as const,
    role: 'active' as const,
    agent_id: 'agent-workflow-source',
    atmosphere_node_id: null
  };

  const event: InferenceTraceEvent = {
    kind: 'run',
    inference_id: 'inf-workflow-source',
    strategy: 'mock',
    provider: 'mock',
    actor_ref: actorRef,
    input: {
      agent_id: 'agent-workflow-source',
      strategy: 'mock',
      pack_id: 'pack-workflow-source',
      idempotency_key: 'job-workflow-source',
      workflow_source: {
        source_workflow_run_id: 'wf-run-1',
        source_workflow_step_id: 'draft',
        source_step_attempt: 2
      }
    },
    context: {
      inference_id: 'inf-workflow-source',
      actor_ref: actorRef,
      actor_display_name: 'Workflow Source Agent',
      identity: { id: 'identity-workflow-source', type: 'agent' },
      binding_ref: null,
      resolved_agent_id: 'agent-workflow-source',
      agent_snapshot: null,
      tick: 100n,
      strategy: 'mock',
      attributes: {},
      world_pack: {
        instance_id: 'pack-workflow-source',
        metadata_id: 'pack-workflow-source',
        name: 'Workflow Source Pack',
        version: '0.0.0'
      },
      world_prompts: {},
      visible_variables: {},
      transmission_profile: {
        policy: 'reliable',
        drop_reason: null,
        delay_ticks: '0',
        drop_chance: 0,
        derived_from: []
      },
      agent_capabilities: [],
      variable_context: { layers: [] },
      variable_context_summary: { namespaces: [], layer_count: 0 },
      policy_summary: {
        social_post_read_allowed: true,
        social_post_readable_fields: [],
        social_post_write_allowed: true,
        social_post_writable_fields: []
      },
      memory_context: {
        short_term: [],
        long_term: [],
        summaries: [],
        diagnostics: {
          selected_count: 0,
          skipped_count: 0
        }
      },
      pack_state: {
        actor_roles: [],
        actor_state: null,
        owned_artifacts: [],
        world_state: null,
        latest_event: null,
        recent_events: []
      },
      pack_runtime: {},
      context_run: contextRun
    } as InferenceTraceEvent['context'],
    prompt: {
      slots: {},
      slot_order: [],
      combined_prompt: '',
      metadata: { prompt_version: 'test', source_prompt_keys: [] },
      tree: {
        inference_id: 'inf-workflow-source',
        task_type: 'agent_decision',
        fragments_by_slot: {},
        slot_registry: {},
        resolved_positions: [],
        metadata: { prompt_version: 'test', profile_id: null, profile_version: null, source_prompt_keys: [] }
      }
    },
    trace_metadata: {
      inference_id: 'inf-workflow-source',
      tick: '100',
      strategy: 'mock',
      provider: 'mock',
      world_pack_id: 'pack-workflow-source',
      binding_ref: null,
      prompt_version: 'test'
    },
    decision: {
      action_type: 'post_message',
      target_ref: null,
      payload: { content: 'workflow-source action' },
      reasoning: 'workflow source reasoning'
    },
    action_intent_draft: {
      intent_type: 'post_message',
      actor_ref: actorRef,
      target_ref: null,
      payload: { content: 'workflow-source action' },
      scheduled_after_ticks: null,
      transmission_delay_ticks: null,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null,
      source_inference_id: 'inf-workflow-source'
    },
    job_status: 'completed',
    job_attempt_count: 1,
    job_max_attempts: 3
  };

  return { ...event, ...overrides };
};

describe('workflow action source persistence', () => {
  let environment: IsolatedRuntimeEnvironment;
  let prisma: PrismaClient;

  beforeAll(async () => {
    environment = await createIsolatedRuntimeEnvironment({ seededPackRefs: [] });
    await migrateIsolatedDatabase(environment);
    prisma = createPrismaClientForEnvironment(environment);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await environment?.cleanup();
  });

  it('persists workflow source metadata from request input onto ActionIntent', async () => {
    const sink = createPrismaInferenceTraceSink({
      repos: createPrismaRepositories(prisma)
    } as AppInfrastructure);

    await sink.record(createTraceEvent());

    const intent = await prisma.actionIntent.findUnique({
      where: { source_inference_id: 'inf-workflow-source' }
    });

    expect(intent).toMatchObject({
      source_workflow_run_id: 'wf-run-1',
      source_workflow_step_id: 'draft',
      source_step_attempt: 2
    });
  });

  it('lets action draft workflow source override request input workflow source', async () => {
    const sink = createPrismaInferenceTraceSink({
      repos: createPrismaRepositories(prisma)
    } as AppInfrastructure);

    await sink.record(createTraceEvent({
      inference_id: 'inf-workflow-source-draft',
      input: {
        agent_id: 'agent-workflow-source',
        strategy: 'mock',
        pack_id: 'pack-workflow-source',
        idempotency_key: 'job-workflow-source-draft',
        workflow_source: {
          source_workflow_run_id: 'wf-run-input',
          source_workflow_step_id: 'input-step',
          source_step_attempt: 1
        }
      },
      action_intent_draft: {
        ...expectDefined(createTraceEvent().action_intent_draft, 'default action intent draft'),
        source_inference_id: 'inf-workflow-source-draft',
        source_workflow_run_id: 'wf-run-draft',
        source_workflow_step_id: 'draft-step',
        source_step_attempt: 3
      }
    }));

    const intent = await prisma.actionIntent.findUnique({
      where: { source_inference_id: 'inf-workflow-source-draft' }
    });

    expect(intent).toMatchObject({
      source_workflow_run_id: 'wf-run-draft',
      source_workflow_step_id: 'draft-step',
      source_step_attempt: 3
    });
  });
});
