import { getPromptSlotRegistry } from '../../ai/registry.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import { resolveConversationFormatConfig } from '../../conversation/format_config.js';
import { loadSlotBehaviorConfig, validateSlotBehaviorConfig } from '../../inference/slot_behavior.js';
import { resolveSlotPositions } from '../../inference/slot_position_resolver.js';
import type { InferenceContext } from '../../inference/types.js';
import { createBehaviorControlExecutor } from './executors/behavior_control.js';
import { createBundleFinalizeExecutor } from './executors/bundle_finalize.js';
import { createContentTransformExecutor } from './executors/content_transform.js';
import { createFragmentAssemblyExecutor } from './executors/fragment_assembly.js';
import { createPermissionFilterExecutor } from './executors/permission_filter.js';
import { createPlacementResolutionExecutor } from './executors/placement_resolution.js';
import { createTokenBudgetTrimExecutor } from './executors/token_budget_trim.js';
import { runPipeline } from './pipeline_runner.js';
import { selectPromptWorkflowProfile } from './profiles.js';
import { createPromptWorkflowStepRegistry } from './registry.js';
import { runConversationHistoryTrack } from './tracks/conversation_history_track.js';
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

  const { resolved_positions, diagnostics: posDiagnostics } =
    resolveSlotPositions(slotRegistry.slots);
  state.resolved_positions = resolved_positions;
  state.diagnostics.slot_position_diagnostics = posDiagnostics;

  const trackResults = [];
  const tracksEnabled = profile.tracks ?? { template: true, node: true, snapshot: true };

  if (tracksEnabled.template !== false) {
    const r = runTemplateTrack(slotRegistry.slots, resolved_positions, input.context);
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
  if (tracksEnabled.conversation_history && input.context.agent_conversation_memory) {
    const conversationProfile = profile.conversation_profile ?? input.context.conversation_profile;
    const formatConfig = resolveConversationFormatConfig(conversationProfile);
    const r = runConversationHistoryTrack({
      memory: input.context.agent_conversation_memory,
      slotRegistry: slotRegistry.slots,
      resolvedPositions: resolved_positions,
      formatConfig,
      currentAgentId: input.context.current_agent_id ?? 'unknown'
    });
    state.section_drafts.push(...r.result);
    trackResults.push(r.trace);
  }
  state.diagnostics.track_traces = trackResults;

  // Load slot behavior config and inject into state
  const slotBehaviorConfig = loadSlotBehaviorConfig(getRuntimeConfig());
  const slotIds = Object.keys(slotRegistry.slots);
  const behaviorProfiles = slotIds
    .map((id) => {
      // eslint-disable-next-line security/detect-object-injection
      return slotBehaviorConfig[id];
    })
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  if (behaviorProfiles.length > 0) {
    const validationErrors = validateSlotBehaviorConfig(slotBehaviorConfig);
    if (validationErrors.length > 0) {
      state.diagnostics.step_traces.push({
        key: 'behavior_config',
        kind: 'behavior_control' as const,
        status: 'failed',
        before: { section_drafts_count: 0, fragment_count: 0, total_estimated_tokens: 0, denied_fragment_count: 0, working_set_node_count: 0 },
        after: { section_drafts_count: 0, fragment_count: 0, total_estimated_tokens: 0, denied_fragment_count: 0, working_set_node_count: 0 },
        notes: { validation_errors: validationErrors }
      });
    }
    state.behavior_profiles = behaviorProfiles;
  }

  const stepRegistry = createPromptWorkflowStepRegistry([
    createPlacementResolutionExecutor(),
    createFragmentAssemblyExecutor(),
    createBehaviorControlExecutor(),
    createContentTransformExecutor(),
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
