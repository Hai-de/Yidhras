import { describe, expect, it } from 'vitest';

import { createBundleFinalizeExecutor } from '../../src/context/workflow/executors/bundle_finalize.js';
import { createFragmentAssemblyExecutor } from '../../src/context/workflow/executors/fragment_assembly.js';
import { createPermissionFilterExecutor } from '../../src/context/workflow/executors/permission_filter.js';
import { createPlacementResolutionExecutor } from '../../src/context/workflow/executors/placement_resolution.js';
import type {
  PromptSectionDraft,
  PromptWorkflowProfile,
  PromptWorkflowState,
  PromptWorkflowStepSpec
} from '../../src/context/workflow/types.js';
import type { PromptFragmentV2 } from '../../src/inference/prompt_fragment_v2.js';
import type { PromptSlotConfig } from '../../src/inference/prompt_slot_config.js';
import type { PromptTree } from '../../src/inference/prompt_tree.js';
import { expectArrayElement, expectDefined } from '../helpers/assertions.js';

const SLOT_SYSTEM: PromptSlotConfig = {
  id: 'system_core',
  default_priority: 100,
  enabled: true,
  include_in_combined: true,
  display_name: 'Test'
};

const buildFragment = (overrides: Partial<PromptFragmentV2> = {}): PromptFragmentV2 => ({
  id: overrides.id ?? 'frag-1',
  slot_id: overrides.slot_id ?? 'system_core',
  priority: overrides.priority ?? 100,
  source: overrides.source ?? 'test',
  removable: overrides.removable ?? true,
  replaceable: false,
  children: overrides.children ?? [],
  estimated_tokens: overrides.estimated_tokens,
  permission_denied: false,
  metadata: overrides.metadata
});

const buildTree = (fragmentsBySlot: Record<string, PromptFragmentV2[]> = {
  system_core: [buildFragment({ id: 'f1', estimated_tokens: 100 })]
}): PromptTree => ({
  inference_id: 'test-id',
  task_type: 'agent_decision',
  fragments_by_slot: fragmentsBySlot,
  slot_registry: { system_core: SLOT_SYSTEM },
  resolved_positions: [],
  metadata: {
    prompt_version: '2',
    profile_id: 'test-profile',
    profile_version: '1',
    source_prompt_keys: ['slot_config:system_core']
  }
});

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
  tree: overrides.tree,
  diagnostics: {
    profile_id: 'test-profile',
    profile_version: '1',
    selected_step_keys: ['test_step'],
    step_traces: []
  },
  ...overrides
});

const buildSpec = (kind: string): PromptWorkflowStepSpec => ({
  key: `test_${kind}`,
  kind: kind as PromptWorkflowStepSpec['kind']
});

const latestTrace = (state: PromptWorkflowState) => expectArrayElement(state.diagnostics.step_traces, 0, 'step traces');

const placementSummaryOf = (state: PromptWorkflowState) => expectDefined(state.diagnostics.placement_summary, 'placement summary');

const treeOf = (state: PromptWorkflowState) => expectDefined(state.tree, 'prompt tree');

const bundleOf = (state: PromptWorkflowState) => expectDefined(state.bundle, 'prompt bundle');

// ── placement_resolution ──

describe('createPlacementResolutionExecutor', () => {
  const executor = createPlacementResolutionExecutor();

  it('no-ops on empty section_drafts', async () => {
    const state = buildState({ section_drafts: [] });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('placement_resolution'), state });
    expect(state.section_drafts).toHaveLength(0);
    expect(state.diagnostics.step_traces).toHaveLength(1);
    expect(latestTrace(state).notes).toMatchObject({ skipped: true });
  });

  it('preserves slot grouping and orders prepend before append', async () => {
    const draft: PromptSectionDraft = {
      id: 'd1',
      track: 'template',
      section_type: 'system_instruction',
      slot: 'system_core',
      priority: 1,
      source_node_ids: [],
      content_blocks: [],
      placement: { placement_mode: 'prepend', order: 1 },
      removable: true
    };
    const draft2: PromptSectionDraft = {
      ...draft, id: 'd2',
      priority: 2,
      placement: { placement_mode: 'append', order: 2 }
    };
    const state = buildState({ section_drafts: [draft2, draft] });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('placement_resolution'), state });
    // prepend (d1) should come before append (d2)
    expect(state.section_drafts[0].id).toBe('d1');
    expect(state.section_drafts[1].id).toBe('d2');
  });

  it('records placement_summary in diagnostics', async () => {
    const target: PromptSectionDraft = {
      id: 'target',
      track: 'template',
      section_type: 'system_instruction',
      slot: 'system_core',
      priority: 0,
      source_node_ids: [],
      content_blocks: [],
      removable: true
    };
    const anchored: PromptSectionDraft = {
      id: 'd1',
      track: 'template',
      section_type: 'system_instruction',
      slot: 'system_core',
      priority: 0,
      source_node_ids: [],
      content_blocks: [],
      placement: { placement_mode: 'after_anchor', anchor: { kind: 'fragment_id', value: 'target' } },
      removable: true
    };
    const state = buildState({ section_drafts: [target, anchored] });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('placement_resolution'), state });
    const placementSummary = placementSummaryOf(state);
    expect(placementSummary.total_fragments).toBe(2);
    expect(placementSummary.resolved_with_anchor).toBe(1);
  });
});

// ── fragment_assembly ──

describe('createFragmentAssemblyExecutor', () => {
  const executor = createFragmentAssemblyExecutor();

  it('preserves existing tree when section_drafts is empty', async () => {
    const tree = buildTree();
    const state = buildState({ section_drafts: [], tree });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('fragment_assembly'), state });
    expect(state.tree).toBe(tree);
    expect(latestTrace(state).notes).toMatchObject({ skipped: true });
  });

  it('builds tree from section_drafts', async () => {
    const draft: PromptSectionDraft = {
      id: 'd1',
      track: 'template',
      section_type: 'system_instruction',
      slot: 'system_core',
      priority: 0,
      source_node_ids: [],
      content_blocks: [{ kind: 'text', text: 'hello' }],
      removable: true
    };
    const tree = buildTree();
    const state = buildState({ section_drafts: [draft], tree });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('fragment_assembly'), state });
    expect(state.tree).not.toBe(tree);
    const fragments = expectDefined(treeOf(state).fragments_by_slot['system_core'], 'system core fragments');
    expect(fragments).toHaveLength(1);
    const fragment = expectArrayElement(fragments, 0, 'system core fragments');
    expect(fragment.slot_id).toBe('system_core');
    expect(expectArrayElement(fragment.children, 0, 'fragment children')).toMatchObject({ kind: 'text' });
  });
});

// ── permission_filter ──

describe('createPermissionFilterExecutor', () => {
  const executor = createPermissionFilterExecutor();

  it('no-ops when feature flag is disabled', async () => {
    const tree = buildTree();
    const state = buildState({ tree });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('permission_filter'), state });
    expect(latestTrace(state).notes).toMatchObject({ skipped: true, reason: 'feature flag disabled' });
  });

  it('no-ops when tree is missing', async () => {
    const state = buildState({ tree: undefined });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('permission_filter'), state });
    expect(latestTrace(state).notes).toMatchObject({ skipped: true });
  });
});

// ── bundle_finalize ──

describe('createBundleFinalizeExecutor', () => {
  const executor = createBundleFinalizeExecutor();

  it('generates PromptBundleV2 from tree', async () => {
    const tree = buildTree();
    const state = buildState({ tree });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('bundle_finalize'), state });
    const bundle = bundleOf(state);
    expect(bundle.metadata.prompt_version).toBe('2');
    expect(bundle.tree).toBe(tree);
  });

  it('backfills workflow metadata into tree', async () => {
    const tree = buildTree();
    const state = buildState({ tree });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('bundle_finalize'), state });
    const workflow = expectDefined(treeOf(state).metadata.workflow, 'workflow metadata');
    expect(workflow.workflow_task_type).toBe('agent_decision');
    expect(workflow.workflow_profile_id).toBe('test-profile');
  });

  it('no-ops when tree is missing', async () => {
    const state = buildState({ tree: undefined });
    await executor.execute({ context: state as never, profile: state.profile, spec: buildSpec('bundle_finalize'), state });
    expect(state.bundle).toBeUndefined();
    expect(latestTrace(state).notes).toMatchObject({ skipped: true });
  });
});
