import { buildPromptBundleV2 } from '../../../inference/prompt_builder_v2.js';
import type { PromptWorkflowStepExecutor } from '../registry.js';
import type {
  PromptWorkflowState,
  PromptWorkflowStepTrace,
  StepSnapshotSummary
} from '../types.js';

const buildSummary = (state: PromptWorkflowState): StepSnapshotSummary => {
  const tree = state.tree;
  if (!tree) {
    return { section_drafts_count: 0, fragment_count: 0, total_estimated_tokens: 0, denied_fragment_count: 0, working_set_node_count: 0 };
  }

  let fragmentCount = 0;
  let totalEstimatedTokens = 0;
  let deniedFragmentCount = 0;
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      fragmentCount++;
      if (fragment.permission_denied) {
        deniedFragmentCount++;
      } else {
        totalEstimatedTokens += fragment.estimated_tokens ?? 0;
      }
    }
  }

  return {
    section_drafts_count: state.section_drafts.length,
    fragment_count: fragmentCount,
    total_estimated_tokens: totalEstimatedTokens,
    denied_fragment_count: deniedFragmentCount,
    working_set_node_count: state.working_set.length
  };
};

export const createBundleFinalizeExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'bundle_finalize',
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute({ context, state, spec }) {
    const beforeSummary = buildSummary(state);

    if (!state.tree) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'bundle_finalize',
        status: 'completed',
        before: beforeSummary,
        after: beforeSummary,
        notes: { skipped: true, reason: 'no tree' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    // Backfill workflow metadata into tree
    if (!state.tree.metadata.workflow) {
      state.tree.metadata.workflow = {};
    }
    state.tree.metadata.workflow.workflow_task_type = state.task_type;
    state.tree.metadata.workflow.workflow_profile_id = state.profile.id;
    state.tree.metadata.workflow.workflow_profile_version = state.profile.version;
    state.tree.metadata.workflow.workflow_step_keys = state.diagnostics.selected_step_keys;

    if (state.diagnostics.section_summary) {
      state.tree.metadata.workflow.workflow_section_summary = state.diagnostics.section_summary;
    }
    if (state.diagnostics.placement_summary) {
      state.tree.metadata.workflow.workflow_placement_summary =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- context data assembly
        state.diagnostics.placement_summary as unknown as Record<string, unknown>;
    }

    const bundle = buildPromptBundleV2(state.tree, context);
    state.bundle = bundle;

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'bundle_finalize',
      status: 'completed',
      before: beforeSummary,
      after: buildSummary(state),
      notes: { prompt_version: bundle.metadata.prompt_version }
    };
    state.diagnostics.step_traces.push(trace);

    return state;
  }
});
