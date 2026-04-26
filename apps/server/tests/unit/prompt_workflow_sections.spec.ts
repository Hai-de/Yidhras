import { describe, expect, it } from 'vitest';

import type { ContextNode } from '../../src/context/types.js';
import {
  buildFragmentsFromSectionDrafts,
  buildGroupedNodes,
  buildSectionBudgetSummary,
  buildSectionDraftsFromFragments,
  buildSectionSummary
} from '../../src/context/workflow/section_drafts.js';
import type { PromptFragment } from '../../src/inference/prompt_fragments.js';


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


  it('filters sections with include_only policy and include_sections list', () => {
    const fragments: PromptFragment[] = [
      buildFragment({ id: 'system', slot: 'system_core', priority: 100, content: 'System', source: 'system.core' }),
      buildFragment({ id: 'role', slot: 'role_core', priority: 90, content: 'Role', source: 'world_prompts.agent_initial_context' }),
      buildFragment({ id: 'world', slot: 'world_context', priority: 80, content: 'World', source: 'world_prompts.global_prefix' }),
      buildFragment({ id: 'memory_summary', slot: 'memory_summary', priority: 70, content: 'Summary', source: 'memory.summary' }),
      buildFragment({ id: 'memory_short', slot: 'memory_short_term', priority: 60, content: 'Short', source: 'memory.short_term' }),
      buildFragment({ id: 'output', slot: 'output_contract', priority: 50, content: 'Output', source: 'output.contract' }),
      buildFragment({ id: 'snapshot', slot: 'post_process', priority: 40, content: 'Snapshot', source: 'context.snapshot' })
    ];

    const drafts = buildSectionDraftsFromFragments(fragments, {
      task_type: 'agent_decision',
      section_policy: 'include_only',
      include_sections: ['memory_summary', 'output_contract']
    });

    const sectionTypes = drafts.map(draft => draft.section_type);

    expect(sectionTypes).toContain('system_instruction');
    expect(sectionTypes).toContain('role_context');
    expect(sectionTypes).toContain('world_context');
    expect(sectionTypes).toContain('memory_summary');
    expect(sectionTypes).toContain('output_contract');

    expect(sectionTypes).not.toContain('memory_short_term');
    expect(sectionTypes).not.toContain('context_snapshot');
  });

  it('include_only with empty include_sections keeps all sections', () => {
    const fragments: PromptFragment[] = [
      buildFragment({ id: 'system', slot: 'system_core', priority: 100, content: 'System', source: 'system.core' }),
      buildFragment({ id: 'memory', slot: 'memory_summary', priority: 70, content: 'Summary', source: 'memory.summary' }),
      buildFragment({ id: 'output', slot: 'output_contract', priority: 50, content: 'Output', source: 'output.contract' })
    ];

    const drafts = buildSectionDraftsFromFragments(fragments, {
      task_type: 'agent_decision',
      section_policy: 'include_only',
      include_sections: []
    });

    expect(drafts).toHaveLength(3);
    expect(drafts.map(draft => draft.section_type)).toEqual(expect.arrayContaining(['system_instruction', 'memory_summary', 'output_contract']));
  });

  it('include_only with context_summary task type filters correctly', () => {
    const fragments: PromptFragment[] = [
      buildFragment({ id: 'system', slot: 'system_core', priority: 100, content: 'System', source: 'system.core' }),
      buildFragment({ id: 'role', slot: 'role_core', priority: 90, content: 'Role', source: 'world_prompts.agent_initial_context' }),
      buildFragment({ id: 'world', slot: 'world_context', priority: 80, content: 'World', source: 'world_prompts.global_prefix' }),
      buildFragment({ id: 'evidence', slot: 'memory_short_term', priority: 60, content: 'Short', source: 'memory.short_term' }),
      buildFragment({ id: 'output', slot: 'output_contract', priority: 50, content: 'Output', source: 'output.contract' })
    ];

    const drafts = buildSectionDraftsFromFragments(fragments, {
      task_type: 'context_summary',
      section_policy: 'include_only',
      include_sections: ['memory_short_term']
    });

    const sectionTypes = drafts.map(draft => draft.section_type);

    expect(sectionTypes).toContain('system_instruction');
    expect(sectionTypes).toContain('role_context');
    expect(sectionTypes).toContain('world_context');
    expect(sectionTypes).toContain('memory_short_term');

    expect(sectionTypes).not.toContain('output_contract');
  });

  it('protected sections are always included even when not in include_sections', () => {
    const fragments: PromptFragment[] = [
      buildFragment({ id: 'system', slot: 'system_core', priority: 100, content: 'System', source: 'system.core' }),
      buildFragment({ id: 'role', slot: 'role_core', priority: 90, content: 'Role', source: 'world_prompts.agent_initial_context' }),
      buildFragment({ id: 'world', slot: 'world_context', priority: 80, content: 'World', source: 'world_prompts.global_prefix' }),
      buildFragment({ id: 'memory', slot: 'memory_summary', priority: 70, content: 'Summary', source: 'memory.summary' })
    ];

    const drafts = buildSectionDraftsFromFragments(fragments, {
      task_type: 'agent_decision',
      section_policy: 'include_only',
      include_sections: ['memory_summary']
    });

    const sectionTypes = drafts.map(draft => draft.section_type);

    expect(sectionTypes).toContain('system_instruction');
    expect(sectionTypes).toContain('role_context');
    expect(sectionTypes).toContain('world_context');
    expect(sectionTypes).toContain('memory_summary');
  });
});
