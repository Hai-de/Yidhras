import { getPromptSlotRegistry } from '../../ai/registry.js';
import type { InferenceContext } from '../../inference/types.js';
import { createBundleFinalizeExecutor } from './executors/bundle_finalize.js';
import { createFragmentAssemblyExecutor } from './executors/fragment_assembly.js';
import { createPermissionFilterExecutor } from './executors/permission_filter.js';
import { createPlacementResolutionExecutor } from './executors/placement_resolution.js';
import { createTokenBudgetTrimExecutor } from './executors/token_budget_trim.js';
import { runPipeline } from './pipeline_runner.js';
import { selectPromptWorkflowProfile } from './profiles.js';
import { createPromptWorkflowStepRegistry } from './registry.js';
import { runNodeTrack } from './tracks/node_track.js';
import { runSnapshotTrack } from './tracks/snapshot_track.js';
import { runTemplateTrack } from './tracks/template_track.js';
import type { PromptWorkflowTaskType } from './types.js';
import { createInitialPromptWorkflowState } from './types.js';

export interface BuildWorkflowPromptBundleResult {
  bundle: NonNullable<ReturnType<typeof createInitialPromptWorkflowState>['bundle']>;
}

export const buildWorkflowPromptBundle = async (input: {
  context: InferenceContext;
  taskType: PromptWorkflowTaskType;
  profileId?: string | null;
}): Promise<BuildWorkflowPromptBundleResult> => {
  const slotRegistry = getPromptSlotRegistry();
  const profile = selectPromptWorkflowProfile({
    task_type: input.taskType,
    strategy: input.context.strategy,
    pack_id: input.context.world_pack.id,
    profile_id: input.profileId ?? null
  });

  const state = createInitialPromptWorkflowState({
    context_run: input.context.context_run,
    actor_ref: input.context.actor_ref,
    task_type: input.taskType,
    strategy: input.context.strategy,
    pack_id: input.context.world_pack.id,
    profile
  });
  state.slot_registry = slotRegistry.slots;

  const trackResults = [];
  const tracksEnabled = profile.tracks ?? { template: true, node: true, snapshot: true };

  if (tracksEnabled.template !== false) {
    const r = runTemplateTrack(slotRegistry.slots, input.context);
    state.section_drafts.push(...r.result);
    trackResults.push(r.trace);
  }
  if (tracksEnabled.node !== false) {
    const r = runNodeTrack(state.context_run?.nodes ?? [], state.task_type);
    state.section_drafts.push(...r.result);
    trackResults.push(r.trace);
  }
  if (tracksEnabled.snapshot !== false) {
    const r = runSnapshotTrack(input.context, slotRegistry.slots);
    state.section_drafts.push(...r.result);
    trackResults.push(r.trace);
  }
  state.diagnostics.track_traces = trackResults;

  const stepRegistry = createPromptWorkflowStepRegistry([
    createPlacementResolutionExecutor(),
    createFragmentAssemblyExecutor(),
    createPermissionFilterExecutor(),
    createTokenBudgetTrimExecutor(),
    createBundleFinalizeExecutor()
  ]);

  const { state: finalState } = await runPipeline({
    context: input.context,
    profile,
    state,
    registry: stepRegistry
  });

  return { bundle: finalState.bundle! };
};
