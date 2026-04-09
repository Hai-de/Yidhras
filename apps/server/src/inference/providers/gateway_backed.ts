import { type AiTaskService,createAiTaskService } from '../../ai/task_service.js';
import type { AiTaskRequest } from '../../ai/types.js';
import type { InferenceProvider } from '../provider.js';
import type { InferenceContext, PromptBundle, ProviderDecisionRaw } from '../types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const buildAiTaskRequest = (context: InferenceContext, prompt: PromptBundle): AiTaskRequest => {
  return {
    task_id: context.inference_id,
    task_type: 'agent_decision',
    pack_id: context.world_pack.id,
    actor_ref: {
      ...context.actor_ref,
      actor_display_name: context.actor_display_name,
      world_pack_id: context.world_pack.id,
      inference_id: context.inference_id
    },
    input: {
      actor_display_name: context.actor_display_name,
      world_name: context.world_pack.name,
      attributes: context.attributes,
      pack_state: context.pack_state,
      actor_ref: context.actor_ref,
      strategy: context.strategy,
      inference_id: context.inference_id
    },
    prompt_context: {
      prompt_bundle: {
        system_prompt: prompt.system_prompt,
        role_prompt: prompt.role_prompt,
        world_prompt: prompt.world_prompt,
        context_prompt: prompt.context_prompt,
        output_contract_prompt: prompt.output_contract_prompt,
        combined_prompt: prompt.combined_prompt,
        metadata: {
          prompt_version: prompt.metadata.prompt_version,
          source_prompt_keys: prompt.metadata.source_prompt_keys,
          processing_trace: prompt.metadata.processing_trace ?? null
        }
      }
    },
    metadata: {
      inference_id: context.inference_id,
      binding_ref: context.binding_ref,
      prompt_version: prompt.metadata.prompt_version,
      source_prompt_keys: prompt.metadata.source_prompt_keys,
      processing_trace: prompt.metadata.processing_trace ?? null
    }
  };
};

export interface CreateGatewayBackedInferenceProviderOptions {
  aiTaskService?: AiTaskService;
}

export const createGatewayBackedInferenceProvider = ({
  aiTaskService = createAiTaskService()
}: CreateGatewayBackedInferenceProviderOptions = {}): InferenceProvider => {
  return {
    name: 'gateway_backed',
    strategies: ['model_routed'],
    async run(context: InferenceContext, prompt: PromptBundle): Promise<ProviderDecisionRaw> {
      const result = await aiTaskService.runTask<Record<string, unknown>>(buildAiTaskRequest(context, prompt), {
        packAiConfig: context.world_ai ?? null
      });

      const output = {
        ...(result.output ?? {}),
        meta: isRecord(result.output.meta) ? { ...result.output.meta, ai_invocation_id: result.invocation.invocation_id } : { ai_invocation_id: result.invocation.invocation_id }
      };
      return isRecord(output) ? output : {};
    }
  };
};
