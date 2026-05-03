import type { InferenceContext } from '../../inference/types.js';
import type { PromptWorkflowStepExecutor, PromptWorkflowStepRegistry } from './registry.js';
import type {
  PromptWorkflowProfile,
  PromptWorkflowState,
  PromptWorkflowStepTrace,
  StepSnapshotSummary
} from './types.js';

export interface RunPipelineInput {
  context: InferenceContext;
  profile: PromptWorkflowProfile;
  state: PromptWorkflowState;
  registry: PromptWorkflowStepRegistry;
}

export interface RunPipelineResult {
  state: PromptWorkflowState;
}

const emptySummary = (): StepSnapshotSummary => ({
  section_drafts_count: 0,
  fragment_count: 0,
  total_estimated_tokens: 0,
  denied_fragment_count: 0,
  working_set_node_count: 0
});

const buildStepSummary = (state: PromptWorkflowState): StepSnapshotSummary => {
  const tree = state.tree;
  if (!tree) {
    return emptySummary();
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

export const runPipeline = async (input: RunPipelineInput): Promise<RunPipelineResult> => {
  const { context, profile, state, registry } = input;
  const enabledSteps = profile.steps.filter((s) => s.enabled !== false);

  for (const spec of enabledSteps) {
    const executor: PromptWorkflowStepExecutor | null = registry.get(spec.kind);

    if (!executor) {
      throw new Error(`Unknown step kind "${spec.kind}" for step "${spec.key}"`);
    }

    const beforeSnapshot = buildStepSummary(state);

    try {
      await executor.execute({ context, profile, spec, state });
      // Executor is responsible for pushing its own completed step trace.
      // Runner only records failed traces for unexpected executor errors.
    } catch (error) {
      const trace: PromptWorkflowStepTrace = {
        key: spec.key,
        kind: spec.kind,
        status: 'failed',
        before: beforeSnapshot,
        after: emptySummary(),
        notes: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
      state.diagnostics.step_traces.push(trace);
      throw error;
    }
  }

  return { state };
};
