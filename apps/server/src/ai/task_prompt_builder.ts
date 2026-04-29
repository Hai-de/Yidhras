import type { PromptWorkflowTaskType } from '../context/workflow/types.js';
import { buildPromptBundleV2, buildPromptTree } from '../inference/prompt_builder_v2.js';
import type { PromptBundleV2 } from '../inference/prompt_bundle_v2.js';
import type { InferenceContext } from '../inference/types.js';
import { getPromptSlotRegistry } from './registry.js';
import type { AiTaskRequest, AiTaskType } from './types.js';

const PROMPT_WORKFLOW_TASK_TYPES: ReadonlySet<AiTaskType> = new Set([
  'agent_decision',
  'context_summary',
  'memory_compaction',
  'intent_grounding_assist'
]);

const buildDefaultActorRef = (context: InferenceContext): NonNullable<AiTaskRequest['actor_ref']> => ({
  ...context.actor_ref,
  actor_display_name: context.actor_display_name,
  world_pack_id: context.world_pack.id,
  inference_id: context.inference_id
});

const buildDefaultTaskInput = (context: InferenceContext): Record<string, unknown> => ({
  actor_display_name: context.actor_display_name,
  world_name: context.world_pack.name,
  attributes: context.attributes,
  pack_state: context.pack_state,
  actor_ref: context.actor_ref,
  strategy: context.strategy,
  inference_id: context.inference_id
});



export interface BuildAiTaskRequestFromInferenceOptions {
  task_type: AiTaskType;
  task_id?: string;
  pack_id?: string | null;
  actor_ref?: AiTaskRequest['actor_ref'];
  input?: Record<string, unknown>;
  prompt_bundle?: PromptBundleV2;
  output_contract?: AiTaskRequest['output_contract'];
  route_hints?: AiTaskRequest['route_hints'];
  metadata?: Record<string, unknown>;
  profile_id?: string | null;
}

export const resolvePromptWorkflowTaskTypeForAiTask = (taskType: AiTaskType): PromptWorkflowTaskType => {
  if (PROMPT_WORKFLOW_TASK_TYPES.has(taskType)) {
    return taskType as PromptWorkflowTaskType;
  }

  return 'agent_decision';
};

export const buildAiTaskRequestFromInferenceContext = async (
  context: InferenceContext,
  options: BuildAiTaskRequestFromInferenceOptions
): Promise<AiTaskRequest> => {
  return buildAiTaskRequestFromInferenceContextV2(context, options);
};

export const buildAiTaskRequest = async (input: {
  context: InferenceContext;
  options: BuildAiTaskRequestFromInferenceOptions;
}): Promise<AiTaskRequest> => {
  return buildAiTaskRequestFromInferenceContext(input.context, input.options);
};

export const buildAiTaskRequestFromInferenceContextV2 = (
  context: InferenceContext,
  options: BuildAiTaskRequestFromInferenceOptions
): Promise<AiTaskRequest> => {
  const registry = getPromptSlotRegistry();
  const tree = buildPromptTree(context, registry.slots);
  const v2 = buildPromptBundleV2(tree, context);

  return Promise.resolve({
    task_id: options.task_id ?? context.inference_id,
    task_type: options.task_type,
    pack_id: options.pack_id ?? context.world_pack.id,
    actor_ref: options.actor_ref ?? buildDefaultActorRef(context),
    input: options.input ?? buildDefaultTaskInput(context),
    prompt_context: {
      prompt_bundle_v2: v2
    },
    output_contract: options.output_contract,
    route_hints: options.route_hints,
    metadata: {
      inference_id: context.inference_id,
      binding_ref: context.binding_ref,
      prompt_version: v2.metadata.prompt_version,
      source_prompt_keys: v2.metadata.source_prompt_keys ?? [],
      workflow_task_type: v2.metadata.workflow_task_type ?? options.task_type,
      workflow_profile_id: v2.metadata.workflow_profile_id ?? null,
      workflow_profile_version: v2.metadata.workflow_profile_version ?? null,
      workflow_step_keys: v2.metadata.workflow_step_keys ?? [],
      processing_trace: v2.metadata.processing_trace,
      ...(options.metadata ?? {})
    }
  });
};
