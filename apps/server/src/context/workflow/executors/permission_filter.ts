import { getRuntimeConfig } from '../../../config/runtime_config.js';
import { applyPermissionFilter } from '../../../inference/prompt_permissions.js';
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

export const createPermissionFilterExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'permission_filter',
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute({ context, state, spec }) {
    const beforeSummary = buildSummary(state);

    const featureEnabled = getRuntimeConfig().features?.experimental?.prompt_slot_permissions;
    if (!featureEnabled || !state.tree) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: 'permission_filter',
        status: 'completed',
        before: beforeSummary,
        after: state.tree ? buildSummary(state) : beforeSummary,
        notes: { skipped: true, reason: featureEnabled ? 'no tree to filter' : 'feature flag disabled' }
      };
      state.diagnostics.step_traces.push(trace);
      return state;
    }

    applyPermissionFilter(state.tree, context);

    const trace: PromptWorkflowStepTrace = {
      key: spec.key,
      kind: 'permission_filter',
      status: 'completed',
      before: beforeSummary,
      after: buildSummary(state),
      notes: { feature_enabled: true }
    };
    state.diagnostics.step_traces.push(trace);

    return state;
  }
});
