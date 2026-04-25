import { buildAiTaskRequestFromInferenceContext, buildAiTaskRequestFromInferenceContextV2 } from '../../ai/task_prompt_builder.js';
import { type AiTaskService, createAiTaskService } from '../../ai/task_service.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import type { InferenceProvider } from '../provider.js';
import type { InferenceContext, PromptBundle, ProviderDecisionRaw } from '../types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const FALLBACK_DECISION: ProviderDecisionRaw = {
  action_type: 'idle',
  target_ref: null,
  payload: { reason: 'ai_provider_unavailable' },
  confidence: 0,
  reasoning: 'AI provider unavailable, falling back to idle action'
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
      const config = getRuntimeConfig();
      const useV2 = config.features?.experimental?.prompt_bundle_v2 === true;

      const request = useV2
        ? await buildAiTaskRequestFromInferenceContextV2(context, {
            task_type: 'agent_decision'
          })
        : await buildAiTaskRequestFromInferenceContext(context, {
            task_type: 'agent_decision',
            prompt_bundle: prompt
          });

      try {
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
      } catch {
        return FALLBACK_DECISION;
      }
    }
  };
};
