import { describe, expect, it } from 'vitest';

import { createPlacementResolutionExecutor } from '../../src/context/workflow/executors/placement_resolution.js';
import type {
  PromptSectionDraft,
  PromptWorkflowProfile,
  PromptWorkflowState,
  PromptWorkflowStepSpec
} from '../../src/context/workflow/types.js';
import type { PromptFragmentAnchor } from '../../src/inference/prompt_fragment_v2.js';
import { expectArrayElement, expectDefined } from '../helpers/assertions.js';

const executor = createPlacementResolutionExecutor();

const buildProfile = (): PromptWorkflowProfile => ({
  id: 'test-profile',
  version: '1',
  applies_to: { task_types: ['agent_decision'] },
  defaults: { token_budget: 2200, safety_margin_tokens: 80 },
  steps: []
});

const buildState = (overrides: Partial<PromptWorkflowState> = {}): PromptWorkflowState => ({
  context_run: null,
  actor_ref: { identity_id: 'a1', identity_type: 'agent', role: 'active', agent_id: 'a1', atmosphere_node_id: null },
  task_type: 'agent_decision',
  strategy: 'mock',
  pack_id: 'test_pack',
  profile: buildProfile(),
  selected_nodes: [],
  working_set: [],
  grouped_nodes: {},
  section_drafts: overrides.section_drafts ?? [],
  diagnostics: {
    profile_id: 'test-profile',
    profile_version: '1',
    selected_step_keys: ['placement_resolution'],
    step_traces: []
  },
  ...overrides
});

const buildSpec = (): PromptWorkflowStepSpec => ({
  key: 'placement_resolution',
  kind: 'placement_resolution'
});

const makeDraft = (
  id: string,
  overrides: Partial<PromptSectionDraft> = {}
): PromptSectionDraft => ({
  id,
  track: 'template',
  section_type: 'system_instruction',
  slot: 'system_core',
  priority: 0,
  source_node_ids: [],
  content_blocks: [],
  removable: true,
  ...overrides
});

const anchor = (
  kind: PromptFragmentAnchor['kind'],
  value: string
): PromptFragmentAnchor => ({ kind, value });

describe('Placement Resolution — Anchor Resolution', () => {
  it('resolves slot_start anchor — draft placed at beginning of slot', async () => {
    const slotEnd = makeDraft('slot-end', {
      placement: { placement_mode: 'before_anchor', anchor: anchor('slot_start', ''), order: 1 }
    });
    const existing = makeDraft('existing', { priority: 100 });

    const state = buildState({ section_drafts: [existing, slotEnd] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    // slot_start anchor → slotEnd should be first in the slot
    expect(state.section_drafts[0].id).toBe('slot-end');
    expect(state.section_drafts[1].id).toBe('existing');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(1);
    expect(placementSummary.fallback_count).toBe(0);
  });

  it('resolves slot_end anchor — draft placed at end of slot', async () => {
    const slotEnd = makeDraft('slot-end', {
      placement: { placement_mode: 'after_anchor', anchor: anchor('slot_end', ''), order: 1 }
    });
    const existing = makeDraft('existing', { priority: 100 });

    const state = buildState({ section_drafts: [slotEnd, existing] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    // slot_end anchor → slotEnd should be last
    expect(state.section_drafts[0].id).toBe('existing');
    expect(state.section_drafts[1].id).toBe('slot-end');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(1);
    expect(placementSummary.fallback_count).toBe(0);
  });

  it('resolves fragment_id anchor (before) — draft placed before target', async () => {
    const target = makeDraft('target-draft', { priority: 100 });
    const anchored = makeDraft('anchored', {
      placement: {
        placement_mode: 'before_anchor',
        anchor: anchor('fragment_id', 'target-draft'),
        order: 1
      }
    });

    const state = buildState({ section_drafts: [target, anchored] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    expect(state.section_drafts[0].id).toBe('anchored');
    expect(state.section_drafts[1].id).toBe('target-draft');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(1);
  });

  it('resolves fragment_id anchor (after) — draft placed after target', async () => {
    const target = makeDraft('target-draft', { priority: 100 });
    const anchored = makeDraft('anchored', {
      placement: {
        placement_mode: 'after_anchor',
        anchor: anchor('fragment_id', 'target-draft'),
        order: 1
      }
    });

    const state = buildState({ section_drafts: [anchored, target] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    expect(state.section_drafts[0].id).toBe('target-draft');
    expect(state.section_drafts[1].id).toBe('anchored');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(1);
  });

  it('resolves source anchor — draft placed before matching source', async () => {
    const target = makeDraft('target-draft', {
      priority: 100,
      source_node_ids: ['node_memory_001']
    });
    const anchored = makeDraft('anchored', {
      placement: {
        placement_mode: 'before_anchor',
        anchor: anchor('source', 'node_memory_001'),
        order: 1
      }
    });

    const state = buildState({ section_drafts: [target, anchored] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    expect(state.section_drafts[0].id).toBe('anchored');
    expect(state.section_drafts[1].id).toBe('target-draft');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(1);
  });

  it('fallback: anchor target not found — degraded to middle sorted by order', async () => {
    const existing = makeDraft('existing', { priority: 100 });
    const anchored = makeDraft('anchored', {
      priority: 50,
      placement: {
        placement_mode: 'before_anchor',
        anchor: anchor('fragment_id', 'nonexistent'),
        order: 50
      }
    });
    const other = makeDraft('other', { priority: 75 });

    const state = buildState({ section_drafts: [existing, anchored, other] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    // The anchored draft falls back to middle group, sorted by order
    // other (75) → anchored (50) → existing (prepend/append only? No, existing has no placement_mode)
    // Actually existing and other are middle (no placement_mode), anchored is middle_fallback
    // Sorted by order: other(no order) → 0, anchored → 50, existing → 0
    // Wait, middle + fallback are sorted by placement.order descending
    // With no order field, it's 0 for existing and other, 50 for anchored
    // So anchored should come before existing and other (desc: 50 > 0)
    // But the relative order of existing vs other within the same order=0 is undefined (stable sort preserves input order)
    expect(state.section_drafts[0].id).toBe('anchored');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(0);
    expect(placementSummary.fallback_count).toBe(1);
    const diagnostic = expectArrayElement(expectDefined(placementSummary.anchor_diagnostics, 'anchor diagnostics'), 0, 'anchor diagnostics');
    expect(diagnostic.code).toBe('target_not_found');
  });

  it('tag anchor — scaffold only, degrades with tag_not_implemented diagnostic', async () => {
    const existing = makeDraft('existing', { priority: 100 });
    const tagged = makeDraft('tagged', {
      priority: 80,
      placement: {
        placement_mode: 'after_anchor',
        anchor: anchor('tag', 'some_tag'),
        order: 80
      }
    });

    const state = buildState({ section_drafts: [existing, tagged] });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    // tagged should be in middle group, sorted by order desc (80 > 0)
    expect(state.section_drafts[0].id).toBe('tagged');
    expect(state.section_drafts[1].id).toBe('existing');

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.fallback_count).toBe(1);
    const diagnostics = expectDefined(placementSummary.anchor_diagnostics, 'anchor diagnostics');
    const diag = expectDefined(diagnostics.find((d) => d.draft_id === 'tagged'), 'tagged diagnostic');
    expect(diag.code).toBe('tag_not_implemented');
  });

  it('mixed: prepend + anchored(before) + middle + anchored(after) + append — correct final order', async () => {
    const target = makeDraft('target', {
      priority: 100,
      placement: { placement_mode: undefined, order: null }
    });
    const beforeDraft = makeDraft('before-target', {
      priority: 90,
      placement: {
        placement_mode: 'before_anchor',
        anchor: anchor('fragment_id', 'target'),
        order: 90
      }
    });
    const afterDraft = makeDraft('after-target', {
      priority: 85,
      placement: {
        placement_mode: 'after_anchor',
        anchor: anchor('fragment_id', 'target'),
        order: 85
      }
    });
    const prependDraft = makeDraft('prepend', {
      priority: 200,
      placement: { placement_mode: 'prepend', order: 200 }
    });
    const appendDraft = makeDraft('append', {
      priority: 10,
      placement: { placement_mode: 'append', order: 10 }
    });
    const middleDraft = makeDraft('middle', {
      priority: 50,
      placement: { placement_mode: undefined, order: 50 }
    });

    const state = buildState({
      section_drafts: [target, beforeDraft, afterDraft, prependDraft, appendDraft, middleDraft]
    });
    await executor.execute({
      context: state as never,
      profile: state.profile,
      spec: buildSpec(),
      state
    });

    const ids = state.section_drafts.map((d) => d.id);
    // prepend → middle(order=50) → before-target(anchored) → target → after-target(anchored) → append
    // Anchored drafts are spliced relative to their anchor target, not sorted by order against middle.
    expect(ids).toEqual([
      'prepend',
      'middle',
      'before-target',
      'target',
      'after-target',
      'append'
    ]);

    const summary = state.diagnostics.placement_summary;
    const placementSummary = expectDefined(summary, 'placement summary');
    expect(placementSummary.resolved_with_anchor).toBe(2); // before-target, after-target
    expect(placementSummary.fallback_count).toBe(0);
  });
});
