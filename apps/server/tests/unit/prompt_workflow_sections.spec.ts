import { describe, expect, it } from 'vitest';

import type { ContextNode } from '../../src/context/types.js';
import {
  buildFragmentsFromSectionDrafts,
  buildGroupedNodes,
  buildSectionBudgetSummary,
  buildSectionDraftsFromFragments,
  buildSectionSummary
} from '../../src/context/workflow/section_drafts.js';
import { buildPromptBundle } from '../../src/inference/prompt_builder.js';
import type { PromptFragment } from '../../src/inference/prompt_fragments.js';
import type { InferenceContext } from '../../src/inference/types.js';

const buildNode = (input: Partial<ContextNode> & Pick<ContextNode, 'id' | 'node_type' | 'scope' | 'source_kind' | 'source_ref' | 'content' | 'tags' | 'importance' | 'salience' | 'created_at' | 'visibility' | 'mutability' | 'placement_policy' | 'provenance'>): ContextNode => ({
  ...input
});

const buildFragment = (input: Partial<PromptFragment> & Pick<PromptFragment, 'id' | 'slot' | 'priority' | 'content' | 'source'>): PromptFragment => ({
  removable: true,
  replaceable: true,
  ...input
});

const getTaskPolicyName = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const taskPolicy = 'task_policy' in metadata ? metadata.task_policy : null;
  const taskPolicyRecord = taskPolicy && typeof taskPolicy === 'object' && !Array.isArray(taskPolicy)
    ? (taskPolicy as Record<string, unknown>)
    : null;
  return typeof taskPolicyRecord?.policy_name === 'string' ? taskPolicyRecord.policy_name : null;
};

const getTaskPolicyRankingScore = (metadata: unknown): number | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const taskPolicy = 'task_policy' in metadata ? metadata.task_policy : null;
  const taskPolicyRecord = taskPolicy && typeof taskPolicy === 'object' && !Array.isArray(taskPolicy)
    ? (taskPolicy as Record<string, unknown>)
    : null;
  return typeof taskPolicyRecord?.ranking_score === 'number' ? taskPolicyRecord.ranking_score : null;
};

describe('prompt workflow section drafts', () => {
  it('groups nodes by preferred slot or source fallback', () => {
    const nodes: ContextNode[] = [
      buildNode({
        id: 'node-system',
        node_type: 'policy_summary',
        scope: 'system',
        source_kind: 'policy_summary',
        source_ref: null,
        content: { text: 'policy' },
        tags: ['policy'],
        importance: 1,
        salience: 1,
        created_at: '1',
        visibility: { level: 'visible_fixed', read_access: 'visible' },
        mutability: { level: 'fixed', can_summarize: false, can_reorder: false, can_hide: false },
        placement_policy: { preferred_slot: 'system_policy', locked: true, tier: 'system' },
        provenance: { created_by: 'system', created_at_tick: '1' }
      }),
      buildNode({
        id: 'node-memory',
        node_type: 'memory_block_reflection',
        scope: 'agent',
        source_kind: 'manual',
        source_ref: null,
        content: { text: 'memory' },
        tags: ['memory'],
        importance: 0.7,
        salience: 0.8,
        created_at: '2',
        visibility: { level: 'visible_flexible', read_access: 'visible' },
        mutability: { level: 'flexible', can_summarize: true, can_reorder: true, can_hide: true },
        placement_policy: { preferred_slot: 'memory_long_term', locked: false, tier: 'memory' },
        provenance: { created_by: 'system', created_at_tick: '2' }
      }),
      buildNode({
        id: 'node-overlay',
        node_type: 'overlay_self_note',
        scope: 'agent',
        source_kind: 'overlay',
        source_ref: null,
        content: { text: 'overlay' },
        tags: ['overlay'],
        importance: 0.5,
        salience: 0.5,
        created_at: '3',
        visibility: { level: 'writable_overlay', read_access: 'visible' },
        mutability: { level: 'overlay', can_summarize: true, can_reorder: true, can_hide: true },
        placement_policy: { preferred_slot: null, locked: false, tier: 'other' },
        provenance: { created_by: 'agent', created_at_tick: '3' }
      })
    ];

    const grouped = buildGroupedNodes(nodes);
    expect(Object.keys(grouped)).toEqual(expect.arrayContaining(['slot:system_policy', 'slot:memory_long_term', 'source:overlay']));
    expect(grouped['slot:memory_long_term']?.map(node => node.id)).toEqual(['node-memory']);
  });

  it('builds section drafts from fragments and can re-materialize fragments', () => {
    const fragments: PromptFragment[] = [
      buildFragment({
        id: 'fragment-memory',
        slot: 'memory_long_term',
        priority: 80,
        content: 'Long memory fragment',
        source: 'memory.long_term.manual',
        metadata: {
          memory_entry_id: 'memory-entry-1',
          tags: ['memory', 'manual']
        },
        anchor: {
          kind: 'source',
          value: 'memory.long_term.manual'
        },
        placement_mode: 'after_anchor',
        depth: 10,
        order: 2
      }),
      buildFragment({
        id: 'fragment-post',
        slot: 'post_process',
        priority: 40,
        content: '{"snapshot":true}',
        source: 'context.snapshot'
      })
    ];

    const drafts = buildSectionDraftsFromFragments(fragments, { task_type: 'agent_decision', section_policy: 'standard' });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      section_type: 'memory_long_term',
      slot: 'memory_long_term',
      source_node_ids: ['memory-entry-1']
    });

    const rematerialized = buildFragmentsFromSectionDrafts(drafts);
    expect(rematerialized).toHaveLength(2);
    expect(rematerialized[0]).toMatchObject({
      id: 'fragment-memory',
      slot: 'memory_long_term',
      content: 'Long memory fragment',
      source: 'memory.long_term.manual'
    });

    const summary = buildSectionSummary(drafts);
    expect(summary).toMatchObject({
      total_sections: 2,
      sections_by_slot: {
        memory_long_term: 1,
        post_process: 1
      },
      section_types: ['memory_long_term', 'context_snapshot'],
      section_order: [
        {
          slot: 'memory_long_term',
          section_type: 'memory_long_term'
        },
        {
          slot: 'post_process',
          section_type: 'context_snapshot'
        }
      ]
    });
  });

  it('reorders and prunes drafts for context_summary and memory_compaction task policies', () => {
    const fragments: PromptFragment[] = [
      buildFragment({ id: 'output', slot: 'output_contract', priority: 100, content: 'Output', source: 'output.contract' }),
      buildFragment({ id: 'snapshot', slot: 'post_process', priority: 90, content: '{"snapshot":true}', source: 'context.snapshot' }),
      buildFragment({ id: 'summary', slot: 'memory_summary', priority: 80, content: 'Summary', source: 'memory.summary.compaction' }),
      buildFragment({ id: 'memory', slot: 'memory_long_term', priority: 70, content: 'Memory', source: 'memory.long_term.manual' })
    ];

    const summaryDrafts = buildSectionDraftsFromFragments(fragments, {
      task_type: 'context_summary',
      section_policy: 'minimal'
    });
    expect(summaryDrafts.map(draft => draft.section_type)).toEqual([
      'memory_summary',
      'memory_long_term',
      'context_snapshot'
    ]);
    expect(summaryDrafts.every(draft => draft.metadata?.task_policy)).toBe(true);
    expect(summaryDrafts.map(draft => getTaskPolicyName(draft.metadata))).toEqual([
      'evidence_first',
      'evidence_first',
      'evidence_first'
    ]);
    expect(summaryDrafts.map(draft => getTaskPolicyRankingScore(draft.metadata))).toEqual([1030, 855, 705]);

    const compactionDrafts = buildSectionDraftsFromFragments(fragments, {
      task_type: 'memory_compaction',
      section_policy: 'minimal'
    });
    expect(compactionDrafts.map(draft => draft.section_type)).toEqual([
      'memory_long_term',
      'memory_summary'
    ]);
    expect(compactionDrafts.map(draft => getTaskPolicyName(draft.metadata))).toEqual([
      'memory_focused',
      'memory_focused'
    ]);
    expect(compactionDrafts.map(draft => getTaskPolicyRankingScore(draft.metadata))).toEqual([1075, 1040]);
  });

  it('builds section-level budget allocations from ranked drafts', () => {
    const drafts = buildSectionDraftsFromFragments([
      buildFragment({ id: 'summary', slot: 'memory_summary', priority: 80, content: 'Summary', source: 'memory.summary.compaction' }),
      buildFragment({ id: 'memory', slot: 'memory_long_term', priority: 70, content: 'Memory', source: 'memory.long_term.manual' })
    ], {
      task_type: 'memory_compaction',
      section_policy: 'minimal'
    });

    const budgetSummary = buildSectionBudgetSummary({ drafts, total_budget: 1800, mode: 'section_level' });
    expect(budgetSummary.mode).toBe('section_level');
    expect(budgetSummary.total_budget).toBe(1800);
    expect(budgetSummary.allocations).toHaveLength(2);
    expect(budgetSummary.allocations[0]?.budget_tokens).toBeGreaterThan(0);
    expect(budgetSummary.kept_section_ids).toHaveLength(2);
    expect(budgetSummary.dropped_section_ids).toEqual([]);
    expect(budgetSummary.allocations[0]?.ranking_score).toBeGreaterThan(budgetSummary.allocations[1]?.ranking_score ?? 0);
  });

  it('records task-aware section summaries in prompt bundle metadata', async () => {
    const context = {
      inference_id: 'ctx-section-aware-001',
      actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
      actor_display_name: '夜神月',
      identity: { id: 'agent-001', type: 'agent', name: '夜神月', provider: null, status: null, claims: null },
      binding_ref: null,
      resolved_agent_id: 'agent-001',
      agent_snapshot: null,
      tick: 1000n,
      strategy: 'mock',
      attributes: {},
      world_pack: { id: 'world-death-note', name: '死亡笔记', version: '0.4.0' },
      world_prompts: {},
      world_ai: null,
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
      transmission_profile: { policy: 'reliable', drop_reason: null, delay_ticks: '1', drop_chance: 0, derived_from: ['test'] },
      context_run: {
        id: 'context-run-sections-1',
        created_at_tick: '1000',
        selected_node_ids: [],
        nodes: [],
        diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] }
      },
      memory_context: {
        short_term: [],
        long_term: [],
        summaries: [],
        diagnostics: {
          selected_count: 0,
          skipped_count: 0,
          memory_selection: { selected_entry_ids: [], dropped: [] }
        }
      },
      pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null },
      pack_runtime: { invocation_rules: [] }
    } satisfies InferenceContext;

    const summaryBundle = await buildPromptBundle(context, { task_type: 'context_summary' });
    const summaryPromptWorkflow = summaryBundle.metadata.processing_trace as Record<string, unknown> | undefined;
    expect(summaryBundle.metadata.workflow_task_type).toBe('context_summary');
    expect(summaryPromptWorkflow?.workflow_task_type).toBe('context_summary');
    expect(Array.isArray(summaryBundle.metadata.processing_trace?.workflow_step_keys)).toBe(true);
    expect(summaryBundle.metadata.processing_trace?.workflow_step_keys).toEqual(expect.arrayContaining(['fragment_assembly', 'token_budget_trim']));
    expect(summaryBundle.metadata.workflow_section_summary).toMatchObject({
      task_type: 'context_summary',
      section_policy: 'minimal',
      section_scores: expect.any(Array),
      section_policies: ['evidence_first']
    });

    const memoryBundle = await buildPromptBundle(context, { task_type: 'memory_compaction' });
    const promptWorkflow = (memoryBundle.metadata.processing_trace as Record<string, unknown> | undefined);
    expect(memoryBundle.metadata.workflow_task_type).toBe('memory_compaction');
    expect(promptWorkflow?.workflow_task_type).toBe('memory_compaction');
    expect(Array.isArray(memoryBundle.metadata.processing_trace?.workflow_step_keys)).toBe(true);
    expect(memoryBundle.metadata.processing_trace?.workflow_step_keys).toEqual(expect.arrayContaining(['fragment_assembly', 'token_budget_trim']));
    expect(memoryBundle.metadata.workflow_section_summary).toMatchObject({
      task_type: 'memory_compaction',
      section_policy: 'minimal',
      section_scores: expect.any(Array),
      section_policies: ['memory_focused']
    });
  });
});
