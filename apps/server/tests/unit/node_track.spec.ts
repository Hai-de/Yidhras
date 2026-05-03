import { describe, expect, it } from 'vitest';

import type { ContextNode } from '../../src/context/types.js';
import { runNodeTrack } from '../../src/context/workflow/tracks/node_track.js';

const buildNode = (overrides: Partial<ContextNode> = {}): ContextNode => ({
  id: overrides.id ?? 'n1',
  node_type: overrides.node_type ?? 'recent_trace',
  scope: 'agent',
  source_kind: 'trace',
  source_ref: null,
  content: { text: overrides.content?.text ?? 'test content' },
  tags: overrides.tags ?? ['test'],
  importance: overrides.importance ?? 0.5,
  salience: overrides.salience ?? 0.5,
  created_at: '1000',
  visibility: {
    level: 'visible_flexible',
    read_access: 'visible',
    policy_gate: null,
    blocked: false,
    ...overrides.visibility
  },
  mutability: {
    level: 'flexible',
    can_summarize: true,
    can_reorder: true,
    can_hide: true
  },
  placement_policy: {
    preferred_slot: overrides.placement_policy?.preferred_slot ?? null,
    locked: false,
    tier: 'memory'
  },
  provenance: {
    created_by: 'system',
    created_at_tick: '1000'
  }
});

describe('runNodeTrack', () => {
  it('returns empty result for empty nodes', () => {
    const { result, trace } = runNodeTrack([], 'agent_decision');
    expect(result).toHaveLength(0);
    expect(trace.track).toBe('node');
    expect(trace.input_summary.total_nodes).toBe(0);
  });

  it('maps visible node to section_draft', () => {
    const node = buildNode({ id: 'n1', node_type: 'recent_trace', importance: 0.8 });
    const { result } = runNodeTrack([node], 'agent_decision');

    expect(result).toHaveLength(1);
    const section = result[0];
    expect(section.track).toBe('node');
    expect(section.section_type).toBe('recent_evidence');
    expect(section.slot).toBe('memory_short_term');
    expect(section.priority).toBe(80);
    expect(section.source_node_ids).toEqual(['n1']);
    expect(section.removable).toBe(true);
    expect(section.content_blocks[0]).toMatchObject({ kind: 'text', text: 'test content' });
  });

  it('filters out blocked nodes', () => {
    const blocked = buildNode({ id: 'b1', visibility: { blocked: true, level: 'hidden_mandatory', read_access: 'hidden' } });
    const { result, trace } = runNodeTrack([blocked], 'agent_decision');

    expect(result).toHaveLength(0);
    expect(trace.input_summary.filtered_out).toBe(1);
    expect(trace.decisions[0]).toMatchObject({ decision: 'filtered', reason: 'blocked' });
  });

  it('filters out policy_gate deny nodes', () => {
    const denied = buildNode({ id: 'd1', visibility: { blocked: false, policy_gate: 'deny', level: 'visible_flexible', read_access: 'visible' } });
    const { result, trace } = runNodeTrack([denied], 'agent_decision');

    expect(result).toHaveLength(0);
    expect(trace.decisions[0]).toMatchObject({ reason: 'policy_gate_deny' });
  });

  it('filters out read_access hidden nodes', () => {
    const hidden = buildNode({ id: 'h1', visibility: { blocked: false, policy_gate: null, level: 'hidden_mandatory', read_access: 'hidden' } });
    const { result, trace } = runNodeTrack([hidden], 'agent_decision');

    expect(result).toHaveLength(0);
    expect(trace.decisions[0]).toMatchObject({ reason: 'read_access_hidden' });
  });

  it('maps memory_summary node_type to memory_summary section_type', () => {
    const node = buildNode({ id: 'ms1', node_type: 'memory_summary', source_kind: 'summary' });
    node.placement_policy.preferred_slot = 'memory_summary';
    const { result } = runNodeTrack([node], 'agent_decision');

    expect(result[0].section_type).toBe('memory_summary');
    expect(result[0].slot).toBe('memory_summary');
  });

  it('maps recent_trace node_type to recent_evidence section_type', () => {
    const node = buildNode({ id: 'rt1', node_type: 'recent_trace' });
    const { result } = runNodeTrack([node], 'agent_decision');

    expect(result[0].section_type).toBe('recent_evidence');
  });

  it('uses placement_policy.preferred_slot when set', () => {
    const node = buildNode({ id: 'p1', node_type: 'recent_trace' });
    node.placement_policy.preferred_slot = 'memory_long_term';
    const { result } = runNodeTrack([node], 'agent_decision');

    expect(result[0].slot).toBe('memory_long_term');
  });

  it('compacts summaries for agent_decision when short_term exceeds threshold', () => {
    const nodes = Array.from({ length: 7 }, (_, i) =>
      buildNode({ id: `st${i}`, node_type: 'recent_trace', importance: 0.9 - i * 0.1 })
    );
    const { result, trace } = runNodeTrack(nodes, 'agent_decision');

    const shortTermSections = result.filter((s) => s.slot === 'memory_short_term');
    const summarySections = result.filter((s) => s.slot === 'memory_summary');
    expect(shortTermSections.length).toBeLessThan(7);
    expect(summarySections.length).toBeGreaterThan(0);
    expect(trace.decisions.some((d) => d.decision === 'compacted')).toBe(true);
  });

  it('skips compaction for context_summary task_type', () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      buildNode({ id: `cs${i}`, node_type: 'recent_trace' })
    );
    const { result, trace } = runNodeTrack(nodes, 'context_summary');

    // All nodes should be present (no compaction)
    expect(result.length).toBe(10);
    expect(trace.decisions.some((d) => d.decision === 'compaction_skipped')).toBe(true);
  });

  it('groups nodes for memory_compaction task_type', () => {
    const nodes = [
      buildNode({ id: 'g1', node_type: 'recent_trace' }),
      buildNode({ id: 'g2', node_type: 'recent_trace' }),
      buildNode({ id: 'g3', node_type: 'memory_summary' })
    ];
    const { result, trace } = runNodeTrack(nodes, 'memory_compaction');

    // recent_trace nodes should be grouped together
    expect(result.length).toBeLessThan(3);
    expect(trace.decisions.some((d) => d.decision === 'grouped')).toBe(true);
  });

  it('records correct TrackTrace with slot distribution', () => {
    const nodes = [
      buildNode({ id: 't1', node_type: 'recent_trace' }),
      buildNode({ id: 't2', node_type: 'memory_summary' })
    ];
    nodes[1].placement_policy.preferred_slot = 'memory_summary';
    const { trace } = runNodeTrack(nodes, 'agent_decision');

    expect(trace.track).toBe('node');
    expect(trace.input_summary.total_nodes).toBe(2);
    expect(trace.input_summary.working_set_size).toBe(2);
    expect(trace.output_summary.by_slot).toBeDefined();
  });
});
