import type { PromptWorkflowTaskType } from '../context/workflow/types.js';
import { buildPromptBundleV2, buildPromptTree } from '../inference/prompt_builder_v2.js';
import type { PromptBundleV2 } from '../inference/prompt_bundle_v2.js';
import type { InferenceContext } from '../inference/types.js';
import { getPromptSlotRegistry } from './registry.js';
import type { AiTaskRequest, AiTaskRequestMetadata, AiTaskType } from './types.js';

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
  prompt_bundle?: PromptBundle;
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

// --- V2 functions ---

const buildRequestMetadataV2 = (
  context: InferenceContext,
  v2: PromptBundleV2,
  taskType: AiTaskType
): AiTaskRequestMetadata => ({
  inference_id: context.inference_id,
  binding_ref: context.binding_ref,
  prompt_version: v2.metadata.prompt_version,
  source_prompt_keys: v2.metadata.source_prompt_keys ?? [],
  workflow_task_type: v2.metadata.workflow_task_type ?? taskType,
  workflow_profile_id: v2.metadata.workflow_profile_id ?? null,
  workflow_profile_version: v2.metadata.workflow_profile_version ?? null,
  workflow_step_keys: v2.metadata.workflow_step_keys ?? [],
  processing_trace: v2.metadata.processing_trace
});

/**
 * V2 版本：使用 PromptBundleV2 树结构构建 AiTaskRequest。
 * prompt_context.prompt_bundle 仍填充（向后兼容），
 * prompt_context.prompt_bundle_v2 携带完整 V2 bundle。
 */
export const buildAiTaskRequestFromInferenceContextV2 = async (
  context: InferenceContext,
  options: BuildAiTaskRequestFromInferenceOptions
): Promise<AiTaskRequest> => {
  const registry = getPromptSlotRegistry();
  const tree = buildPromptTree(context, registry.slots);
  const v2 = buildPromptBundleV2(tree, context);
  const taskMetadata = buildRequestMetadataV2(context, v2, options.task_type);

  return {
    task_id: options.task_id ?? context.inference_id,
    task_type: options.task_type,
    pack_id: options.pack_id ?? context.world_pack.id,
    actor_ref: options.actor_ref ?? buildDefaultActorRef(context),
    input: options.input ?? buildDefaultTaskInput(context),
    prompt_context: {
      prompt_bundle: {
        system_prompt: v2.slots['system_core'] ?? '',
        role_prompt: v2.slots['role_core'] ?? '',
        world_prompt: v2.slots['world_context'] ?? '',
        context_prompt: v2.slots['post_process'] ?? '',
        output_contract_prompt: v2.slots['output_contract'] ?? '',
        combined_prompt: v2.combined_prompt,
        metadata: {
          ...v2.metadata,
          workflow_task_type: v2.metadata.workflow_task_type ?? options.task_type
        }
      },
      prompt_bundle_v2: v2
    },
    output_contract: options.output_contract,
    route_hints: options.route_hints,
    metadata: {
      ...taskMetadata,
      ...(options.metadata ?? {})
    } as AiTaskRequestMetadata
  };
};
