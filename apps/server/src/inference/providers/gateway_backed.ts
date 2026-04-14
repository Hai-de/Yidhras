import { buildAiTaskRequestFromInferenceContext } from '../../ai/task_prompt_builder.js';
import { type AiTaskService, createAiTaskService } from '../../ai/task_service.js';
import type { InferenceProvider } from '../provider.js';
import type { InferenceContext, PromptBundle, ProviderDecisionRaw } from '../types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
      const request = await buildAiTaskRequestFromInferenceContext(context, {
        task_type: 'agent_decision',
        prompt_bundle: prompt
      });
      const result = await aiTaskService.runTask<Record<string, unknown>>(request, {
        packAiConfig: context.world_ai ?? null
      });

      const output = {
        ...(result.output ?? {}),
        meta: isRecord(result.output.meta)
          ? { ...result.output.meta, ai_invocation_id: result.invocation.invocation_id }
          : { ai_invocation_id: result.invocation.invocation_id }
      };
      return isRecord(output) ? output : {};
    }
  };
};
