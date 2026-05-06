import { randomUUID } from 'crypto';

import type { PromptBlock } from '../../../inference/prompt_block.js';
import type { PromptFragmentV2 } from '../../../inference/prompt_fragment_v2.js';
import type { PromptTree } from '../../../inference/prompt_tree.js';
import type { PromptWorkflowStepExecutor } from '../registry.js';
import type {
  PromptSectionDraft,
  PromptWorkflowState,
  PromptWorkflowStepTrace,
  StepSnapshotSummary
} from '../types.js';

const PROMPT_VERSION = '2';

const emptySummary = (state: PromptWorkflowState): StepSnapshotSummary => ({
  section_drafts_count: state.section_drafts.length,
  fragment_count: 0,
  total_estimated_tokens: 0,
  denied_fragment_count: 0,
  working_set_node_count: state.working_set.length
});

const sectionToFragment = (section: PromptSectionDraft): PromptFragmentV2 => {
  const children: PromptBlock[] = section.content_blocks.map((block) => {
    if (block.kind === 'text') {
      return {
        id: randomUUID(),
        kind: 'text',
        content: { kind: 'text', text: block.text },
        rendered: block.text,
        estimated_tokens: undefined,
        metadata: block.metadata
      };
    }
    return {
      id: randomUUID(),
      kind: 'json',
      content: { kind: 'json', value: block.json },
      rendered: JSON.stringify(block.json),
      estimated_tokens: undefined,
      metadata: block.metadata
    };
  });

  return {
    id: randomUUID(),
    slot_id: section.slot,
    priority: section.placement?.order ?? 0,
    source: `section:${section.id}`,
    removable: true,
    replaceable: false,
    children,
    anchor: section.placement?.anchor ?? null,
    placement_mode: section.placement?.placement_mode ?? null,
    depth: section.placement?.depth ?? null,
    order: section.placement?.order ?? null,
    permissions: null,
    estimated_tokens: undefined,
    metadata: section.metadata
  };
};

const buildSummary = (state: PromptWorkflowState, tree: PromptTree): StepSnapshotSummary => {
  let fragmentCount = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    fragmentCount += fragments.length;
  }
  return {
    section_drafts_count: state.section_drafts.length,
    fragment_count: fragmentCount,
    total_estimated_tokens: 0,
    denied_fragment_count: 0,
    working_set_node_count: state.working_set.length
  };
};

export const createFragmentAssemblyExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'fragment_assembly',
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute({ context, state, spec }) {
    const beforeSummary = emptySummary(state);

    // Phase 2 compatibility: if no section_drafts, preserve existing tree
    if (state.section_drafts.length === 0) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'fragment_assembly',
        status: 'completed',
        before: beforeSummary,
        after: state.tree ? buildSummary(state, state.tree) : emptySummary(state),
        notes: { skipped: true, reason: 'no section_drafts, preserving existing tree' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    const fragmentsBySlot: Record<string, PromptFragmentV2[]> = {};
    const sourceKeys: string[] = [];

    for (const section of state.section_drafts) {
      const fragment = sectionToFragment(section);
      if (!fragmentsBySlot[section.slot]) {
        fragmentsBySlot[section.slot] = [];
      }
      fragmentsBySlot[section.slot].push(fragment);
      sourceKeys.push(fragment.source);
    }

    const tree: PromptTree = {
      inference_id: (context as unknown as Record<string, string>).inference_id ?? '',
      task_type: state.task_type,
      fragments_by_slot: fragmentsBySlot,
      slot_registry: state.slot_registry ?? state.tree?.slot_registry ?? {},
      resolved_positions: state.resolved_positions ?? [],
      metadata: {
        prompt_version: PROMPT_VERSION,
        profile_id: state.profile.id,
        profile_version: state.profile.version,
        source_prompt_keys: sourceKeys
      }
    };

    state.tree = tree;

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'fragment_assembly',
      status: 'completed',
      before: beforeSummary,
      after: buildSummary(state, tree),
      notes: { sections_assembled: state.section_drafts.length }
    };
    state.diagnostics.step_traces.push(trace);

    return state;
  }
});
