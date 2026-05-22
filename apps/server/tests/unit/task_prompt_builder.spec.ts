import { describe, expect, it } from 'vitest';

import { buildAiTaskRequestFromInferenceContext } from '../../src/ai/task_prompt_builder.js';
import { buildWorkflowPromptBundle } from '../../src/context/workflow/orchestrator.js';
import type { InferenceContext } from '../../src/inference/types.js';
import type { MemoryContextPack } from '../../src/memory/types.js';

const createInferenceContext = (): InferenceContext => {
  const baseMemoryContext = {
    short_term: [],
    long_term: [],
    summaries: [],
    diagnostics: {
      selected_count: 0,
      skipped_count: 0,
      memory_selection: {
        selected_entry_ids: [],
        dropped: []
      }
    }
  } satisfies MemoryContextPack;

  return {
    inference_id: 'inf-task-aware-001',
    actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
    actor_display_name: '夜神月',
    identity: { id: 'agent-001', type: 'agent', name: '夜神月', provider: null, status: null, claims: null },
    binding_ref: null,
    resolved_agent_id: 'agent-001',
    agent_snapshot: null,
    tick: 1000n,
    agent_capabilities: [],
    strategy: 'model_routed',
    attributes: {},
    world_pack: { id: 'world-death-note', name: '死亡笔记', version: '0.4.0' },
    world_prompts: {},
    world_ai: {
      memory_loop: {
        summary_every_n_rounds: 5,
        compaction_every_n_rounds: 5
      },
      tasks: {
        intent_grounding_assist: {
          prompt: {
            preset: 'death_note_intent_grounding_v1',
            include_sections: ['pack_rules', 'recent_events']
          },
          metadata: {
            fallback_policy: 'prefer_existing_capability_or_narrativized'
          }
        },
        context_summary: {
          prompt: { preset: 'death_note_context_summary_v1' },
          metadata: { summary_axes: ['investigation_heat', 'evidence_chain_strength'] }
        },
        memory_compaction: {
          prompt: { preset: 'death_note_memory_compaction_v1' },
          metadata: { retention_bias: ['target_identity_confirmation', 'execution_postmortem'] }
        },
        classification: {
          prompt: { preset: 'death_note_classification_v1' },
          metadata: { labels: ['execution_window', 'false_lead', 'pressure_escalation'] }
        }
      }
    },
    visible_variables: {},
    variable_context: { layers: [] },
    variable_context_summary: { namespaces: [], layer_count: 0 },
    policy_summary: {
      social_post_read_allowed: true,
      social_post_readable_fields: ['id', 'content'],
      social_post_write_allowed: true,
      social_post_writable_fields: ['content']
    },
    transmission_profile: { policy: 'reliable', drop_reason: null, delay_ticks: '1', drop_chance: 0, derived_from: ['test'] },
    context_run: {
      id: 'ctx-task-aware-001',
      created_at_tick: '1000',
      selected_node_ids: [],
      nodes: [],
      diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] }
    },
    memory_context: baseMemoryContext,
    pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null, recent_events: [] },
    pack_runtime: { invocation_rules: [] }
  } satisfies InferenceContext;
};

describe('buildAiTaskRequestFromInferenceContext', () => {
  it('rejects requests without a PromptBundleV2', async () => {
    const inferenceContext = createInferenceContext();

    await expect(
      buildAiTaskRequestFromInferenceContext(inferenceContext, { task_type: 'context_summary' })
    ).rejects.toMatchObject({ code: 'PROMPT_BUNDLE_REQUIRED' });
  });

  it('builds context_summary and memory_compaction ai task requests with task-aware workflow metadata', async () => {
    const inferenceContext = createInferenceContext();

    const { bundle: contextSummaryBundle } = await buildWorkflowPromptBundle({
      context: inferenceContext,
      taskType: 'context_summary'
    });
    const contextSummaryRequest = await buildAiTaskRequestFromInferenceContext(inferenceContext, {
      task_type: 'context_summary',
      prompt_bundle: contextSummaryBundle
    });
    expect(contextSummaryRequest.task_type).toBe('context_summary');
    expect(contextSummaryRequest.prompt_context.prompt_bundle_v2).toBe(contextSummaryBundle);
    expect(contextSummaryRequest.metadata?.workflow_task_type).toBe('context_summary');
    expect(contextSummaryRequest.metadata?.workflow_profile_id).toBe('context-summary-default');

    const { bundle: memoryCompactionBundle } = await buildWorkflowPromptBundle({
      context: inferenceContext,
      taskType: 'memory_compaction'
    });
    const memoryCompactionRequest = await buildAiTaskRequestFromInferenceContext(inferenceContext, {
      task_type: 'memory_compaction',
      prompt_bundle: memoryCompactionBundle
    });
    expect(memoryCompactionRequest.task_type).toBe('memory_compaction');
    expect(memoryCompactionRequest.prompt_context.prompt_bundle_v2).toBe(memoryCompactionBundle);
    expect(memoryCompactionRequest.metadata?.workflow_task_type).toBe('memory_compaction');
    expect(memoryCompactionRequest.metadata?.workflow_profile_id).toBe('memory-compaction-default');
  });
});
