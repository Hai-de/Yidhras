import { describe, expect, it } from 'vitest';

import { runContextOrchestrator } from '../../src/context/workflow/orchestrator.js';
import { buildPromptBundle, buildPromptBundleFromFragments } from '../../src/inference/prompt_builder.js';
import type { PromptFragment } from '../../src/inference/prompt_fragments.js';
import type { InferenceContext } from '../../src/inference/types.js';

const buildInferenceContext = (): InferenceContext => ({
  inference_id: 'ctx-orchestrator-test',
  actor_ref: {
    identity_id: 'agent-001',
    identity_type: 'agent',
    role: 'active',
    agent_id: 'agent-001',
    atmosphere_node_id: null
  },
  actor_display_name: '夜神月',
  identity: {
    id: 'agent-001',
    type: 'agent',
    name: '夜神月',
    provider: null,
    status: null,
    claims: null
  },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: {
    id: 'agent-001',
    name: '夜神月',
    type: 'active',
    snr: 0.8,
    is_pinned: false
  },
  tick: 1000n,
  strategy: 'rule_based',
  attributes: {},
  world_pack: {
    id: 'world-death-note',
    name: '死亡笔记',
    version: '0.4.0'
  },
  world_prompts: {},
  visible_variables: {},
  variable_context: {
    layers: [],
    alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
    strict_namespace: false
  },
  variable_context_summary: {
    namespaces: [],
    alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
    strict_namespace: false,
    layer_count: 0
  },
  policy_summary: {
    social_post_read_allowed: true,
    social_post_readable_fields: ['id', 'content'],
    social_post_write_allowed: true,
    social_post_writable_fields: ['content']
  },
  transmission_profile: {
    policy: 'reliable',
    drop_reason: null,
    delay_ticks: '1',
    drop_chance: 0,
    derived_from: ['test']
  },
  context_run: {
    id: 'context-run-1',
    created_at_tick: '1000',
    selected_node_ids: ['mem-short-1', 'mem-short-2', 'mem-short-3', 'mem-short-4', 'mem-short-5', 'mem-long-1', 'mem-summary-1', 'memory-block-1'],
    nodes: [],
    diagnostics: {
      source_adapter_names: ['memory-selection', 'runtime-state-snapshots', 'memory-block-runtime'],
      node_count: 8,
      node_counts_by_type: {
        recent_trace: 3,
        recent_event: 1,
        recent_post: 1,
        manual_note: 1,
        memory_summary: 1,
        memory_block_reflection: 1
      },
      selected_node_ids: ['mem-short-1', 'mem-short-2', 'mem-short-3', 'mem-short-4', 'mem-short-5', 'mem-long-1', 'mem-summary-1', 'memory-block-1'],
      dropped_nodes: []
    }
  },
  memory_context: {
    short_term: [
      {
        id: 'mem-short-1',
        scope: 'short_term',
        source_kind: 'trace',
        source_ref: { trace_id: 'trace-1' },
        content: { text: 'Short term trace one' },
        tags: ['trace'],
        importance: 0.9,
        salience: 0.9,
        visibility: { policy_gate: 'allow' },
        created_at: '1000',
        occurred_at: '1000'
      },
      {
        id: 'mem-short-2',
        scope: 'short_term',
        source_kind: 'event',
        source_ref: { event_id: 'event-2' },
        content: { text: 'Short term event two' },
        tags: ['event'],
        importance: 0.8,
        salience: 0.7,
        visibility: { policy_gate: 'allow' },
        created_at: '999',
        occurred_at: '999'
      },
      {
        id: 'mem-short-3',
        scope: 'short_term',
        source_kind: 'job',
        source_ref: { job_id: 'job-3' },
        content: { text: 'Short term job three' },
        tags: ['job'],
        importance: 0.7,
        salience: 0.6,
        visibility: { policy_gate: 'allow' },
        created_at: '998',
        occurred_at: '998'
      },
      {
        id: 'mem-short-4',
        scope: 'short_term',
        source_kind: 'intent',
        source_ref: { intent_id: 'intent-4' },
        content: { text: 'Short term intent four' },
        tags: ['intent'],
        importance: 0.6,
        salience: 0.5,
        visibility: { policy_gate: 'deny' },
        created_at: '997',
        occurred_at: '997'
      },
      {
        id: 'mem-short-5',
        scope: 'short_term',
        source_kind: 'post',
        source_ref: { post_id: 'post-5' },
        content: { text: 'Short term post five' },
        tags: ['post'],
        importance: 0.55,
        salience: 0.45,
        visibility: { policy_gate: 'allow' },
        created_at: '996',
        occurred_at: '996'
      }
    ],
    long_term: [
      {
        id: 'mem-long-1',
        scope: 'long_term',
        source_kind: 'manual',
        source_ref: { trace_id: 'manual-1' },
        content: { text: 'Long term manual note' },
        tags: ['manual'],
        importance: 0.5,
        salience: 0.4,
        visibility: { policy_gate: 'allow' },
        created_at: '950',
        occurred_at: '950'
      },
      {
        id: 'memory-block-1',
        scope: 'long_term',
        source_kind: 'manual',
        source_ref: { source_message_id: 'trace-1' },
        content: { text: 'Long suspicion memo\nMemory block should be placed after the anchor.' },
        tags: ['memory_block', 'memory_kind:reflection'],
        importance: 0.88,
        salience: 0.77,
        visibility: { policy_gate: 'allow' },
        created_at: '995',
        occurred_at: '999',
        metadata: {
          memory_block_id: 'memory-block-1',
          placement_anchor: {
            kind: 'source',
            value: 'memory.long_term.manual'
          },
          placement_depth: 10,
          placement_order: 2,
          placement_mode: 'after_anchor'
        }
      }
    ],
    summaries: [
      {
        id: 'mem-summary-1',
        scope: 'short_term',
        source_kind: 'summary',
        source_ref: { trace_id: 'summary-1' },
        content: { text: 'Existing summary fragment' },
        tags: ['summary'],
        importance: 0.95,
        salience: 0.95,
        visibility: { policy_gate: 'allow' },
        created_at: '1000',
        occurred_at: '1000'
      }
    ],
    diagnostics: {
      selected_count: 8,
      skipped_count: 0,
      memory_selection: {
        selected_entry_ids: ['mem-short-1', 'mem-short-2', 'mem-short-3', 'mem-short-4', 'mem-short-5', 'mem-long-1', 'mem-summary-1', 'memory-block-1'],
        dropped: []
      }
    }
  },
  pack_state: {
    actor_roles: ['planner'],
    actor_state: {
      murderous_intent: true
    },
    owned_artifacts: [],
    world_state: {
      kira_case_phase: 'kira_active'
    },
    latest_event: null
  },
  pack_runtime: {
    invocation_rules: []
  }
});

const baseFragments: PromptFragment[] = [
  {
    id: 'fragment-system',
    slot: 'system_core',
    priority: 100,
    content: 'System prompt',
    source: 'system.core'
  },
  {
    id: 'fragment-role',
    slot: 'role_core',
    priority: 90,
    content: 'Role prompt',
    source: 'role.core'
  },
  {
    id: 'fragment-world',
    slot: 'world_context',
    priority: 80,
    content: 'World prompt',
    source: 'world.prompt'
  }
];

describe('context orchestrator', () => {
  it('injects memory fragments, applies policy filtering, compacts summaries, and records prompt workflow diagnostics', async () => {
    const context = buildInferenceContext();
    const result = await runContextOrchestrator(context, baseFragments);

    const memoryLongTerm = result.fragments.filter(fragment => fragment.slot === 'memory_long_term');
    expect(memoryLongTerm).toHaveLength(2);
    expect(memoryLongTerm[0]?.metadata?.memory_entry_id).toBe('mem-long-1');
    expect(memoryLongTerm[1]?.metadata?.memory_block_id).toBe('memory-block-1');
    expect(memoryLongTerm[1]?.anchor).toEqual({
      kind: 'source',
      value: 'memory.long_term.manual'
    });
    expect(memoryLongTerm[1]?.depth).toBe(10);
    expect(memoryLongTerm[1]?.order).toBe(2);

    const summaryFragments = result.fragments.filter(fragment => fragment.slot === 'memory_summary');
    expect(summaryFragments.length).toBeGreaterThan(0);
    expect(summaryFragments.some(fragment => fragment.source === 'memory.summary.compaction')).toBe(true);

    const blockedFragment = result.fragments.find(fragment => fragment.metadata?.memory_entry_id === 'mem-short-4');
    expect(blockedFragment).toBeUndefined();

    expect(context.memory_context.diagnostics.prompt_processing_trace).toMatchObject({
      context_run_id: 'context-run-1',
      workflow_task_type: 'agent_decision',
      workflow_profile_id: 'agent-decision-default',
      workflow_profile_version: '1',
      workflow_step_keys: [
        'memory_projection',
        'node_working_set_filter',
        'summary_compaction',
        'token_budget_trim',
        'placement_resolution',
        'bundle_finalize'
      ],
      prompt_workflow: {
        task_type: 'agent_decision',
        profile_id: 'agent-decision-default',
        profile_version: '1',
        selected_step_keys: [
          'memory_projection',
          'node_working_set_filter',
          'summary_compaction',
          'token_budget_trim',
          'placement_resolution',
          'bundle_finalize'
        ],
        placement_summary: {
          total_fragments: expect.any(Number),
          resolved_with_anchor: expect.any(Number),
          fallback_count: expect.any(Number)
        },
        section_summary: null
      },
      summary_compaction: {
        summarized_fragment_ids: expect.any(Array),
        summary_fragment_id: expect.any(String)
      },
      token_budget_trimming: {
        task_type: 'agent_decision',
        budget: expect.any(Number),
        used: expect.any(Number),
        trimmed_fragment_ids: expect.any(Array),
        kept_fragment_ids: expect.any(Array),
        always_kept_fragment_ids: expect.any(Array),
        kept_optional_fragment_ids: expect.any(Array),
        slot_priority: expect.any(Object),
        optional_fragment_scores: expect.any(Array),
        section_budget: {
          mode: expect.any(String),
          total_budget: expect.any(Number),
          allocated_budget: expect.any(Number),
          allocations: expect.any(Array),
          kept_section_ids: expect.any(Array),
          dropped_section_ids: expect.any(Array),
        },
        trimmed_by_slot: expect.any(Object),
        trimmed_sources: expect.any(Array),
        section_summary: null
      },
      policy_filtering: {
        filtered_fragment_ids: expect.any(Array),
        reasons: expect.any(Object)
      },
      workflow_step_traces: expect.any(Array)
    });

    expect(context.context_run.diagnostics.orchestration).toMatchObject({
      step_keys: [
        'memory_projection',
        'node_working_set_filter',
        'summary_compaction',
        'token_budget_trim',
        'placement_resolution',
        'bundle_finalize'
      ],
      processor_names: [
        'memory-injector',
        'policy-filter',
        'memory-summary',
        'token-budget-trimmer',
        'prompt-workflow:placement_resolution',
        'prompt-workflow:bundle_finalize'
      ],
      prompt_workflow: {
        task_type: 'agent_decision',
        profile_id: 'agent-decision-default',
        profile_version: '1',
        selected_step_keys: [
          'memory_projection',
          'node_working_set_filter',
          'summary_compaction',
          'token_budget_trim',
          'placement_resolution',
          'bundle_finalize'
        ],
        step_traces: expect.any(Array),
        placement_summary: {
          total_fragments: expect.any(Number),
          resolved_with_anchor: expect.any(Number),
          fallback_count: expect.any(Number)
        },
        section_summary: null
      }
    });

    const bundle = buildPromptBundleFromFragments(result.fragments, context);
    expect(bundle.metadata.workflow_task_type).toBe('agent_decision');
    expect(bundle.metadata.workflow_profile_id).toBe('agent-decision-default');
    expect(bundle.metadata.workflow_profile_version).toBe('1');
    expect(bundle.metadata.workflow_placement_summary).toMatchObject({
      total_fragments: expect.any(Number),
      resolved_with_anchor: expect.any(Number),
      fallback_count: expect.any(Number)
    });
    expect(
      context.context_run.diagnostics.orchestration &&
      typeof context.context_run.diagnostics.orchestration === 'object' &&
      (context.context_run.diagnostics.orchestration as Record<string, unknown>).prompt_workflow
    ).toBeTruthy();
    expect(bundle.metadata.workflow_step_keys).toEqual([
      'memory_projection',
      'node_working_set_filter',
      'summary_compaction',
      'token_budget_trim',
      'placement_resolution',
      'bundle_finalize'
    ]);
    expect(bundle.metadata.processing_trace?.workflow_task_type).toBe('agent_decision');
    expect(bundle.metadata.processing_trace?.workflow_profile_id).toBe('agent-decision-default');
  });

  it('selects task-aware workflow profiles when buildPromptBundle receives explicit task types', async () => {
    const contextSummaryContext = buildInferenceContext();
    const contextSummaryBundle = await buildPromptBundle(contextSummaryContext, { task_type: 'context_summary' });

    expect(contextSummaryBundle.metadata.workflow_task_type).toBe('context_summary');
    expect(contextSummaryBundle.metadata.workflow_profile_id).toBe('context-summary-default');
    expect(contextSummaryBundle.metadata.workflow_step_keys).toEqual([
      'memory_projection',
      'node_working_set_filter',
      'summary_compaction',
      'fragment_assembly',
      'token_budget_trim',
      'bundle_finalize'
    ]);
    expect(contextSummaryBundle.metadata.workflow_section_summary).toMatchObject({
      task_type: 'context_summary',
      section_policy: 'minimal',
      section_scores: expect.any(Array),
      section_policies: ['evidence_first'],
      sections_by_type: expect.any(Object)
    });
    expect(
      Array.isArray((contextSummaryBundle.metadata.workflow_section_summary as Record<string, unknown>).section_scores)
    ).toBe(true);

    const memoryCompactionContext = buildInferenceContext();
    const memoryCompactionBundle = await buildPromptBundle(memoryCompactionContext, { task_type: 'memory_compaction' });

    expect(memoryCompactionBundle.metadata.workflow_task_type).toBe('memory_compaction');
    expect(memoryCompactionBundle.metadata.workflow_profile_id).toBe('memory-compaction-default');
    expect(memoryCompactionBundle.metadata.workflow_step_keys).toEqual([
      'memory_projection',
      'node_working_set_filter',
      'node_grouping',
      'summary_compaction',
      'fragment_assembly',
      'token_budget_trim',
      'bundle_finalize'
    ]);
    expect(memoryCompactionBundle.metadata.workflow_section_summary).toMatchObject({
      task_type: 'memory_compaction',
      section_policy: 'minimal',
      section_scores: expect.any(Array),
      section_policies: ['memory_focused'],
      sections_by_type: expect.any(Object)
    });
    expect(
      Array.isArray((memoryCompactionBundle.metadata.workflow_section_summary as Record<string, unknown>).section_scores)
    ).toBe(true);
  });

  it('exposes variable resolution summaries through prompt bundle metadata when namespaced prompts are used', async () => {
    const context = buildInferenceContext();
    context.world_prompts = {
      global_prefix: 'World={{ pack.metadata.name }} / Tick={{ runtime.current_tick }}',
      agent_initial_context: '{{ actor.display_name }} / {{ request.strategy }}'
    };
    context.variable_context = {
      layers: [
        {
          namespace: 'pack',
          values: { metadata: { name: '死亡笔记' } },
          alias_values: {},
          metadata: { source_label: 'test-pack', trusted: true }
        },
        {
          namespace: 'runtime',
          values: { current_tick: '1000' },
          alias_values: {},
          metadata: { source_label: 'test-runtime', trusted: true }
        },
        {
          namespace: 'actor',
          values: { display_name: '夜神月' },
          alias_values: {},
          metadata: { source_label: 'test-actor', trusted: true }
        },
        {
          namespace: 'request',
          values: { strategy: 'rule_based' },
          alias_values: { strategy: 'rule_based' },
          metadata: { source_label: 'test-request', trusted: true }
        }
      ],
      alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
      strict_namespace: false
    };
    const bundle = await buildPromptBundle(context, { task_type: 'agent_decision' });

    expect(bundle.metadata.workflow_variable_summary).toMatchObject({
      namespaces: expect.arrayContaining(['pack', 'runtime', 'actor'])
    });
    expect(bundle.metadata.workflow_macro_summary?.traces.length).toBeGreaterThan(0);
  });

});
