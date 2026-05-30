import type { PromptBundleV2 } from '../../inference/prompt_bundle_v2.js';
import type { InferenceProvider } from '../../inference/provider.js';
import type { InferenceContext, ProviderDecisionRaw } from '../../inference/types.js';
import { isRecord } from '../../utils/type_guards.js';
import { buildAiTaskRequestFromInferenceContextV2 } from '../task_prompt_builder.js';
import type { AiTaskService } from '../task_service.js';

const FALLBACK_DECISION: ProviderDecisionRaw = {
  action_type: 'idle',
  target_ref: null,
  payload: { reason: 'ai_provider_unavailable' },
  confidence: 0,
  reasoning: 'AI provider unavailable, falling back to idle action'
};

export interface CreateGatewayBackedInferenceProviderOptions {
  aiTaskService: AiTaskService;
}

export const createGatewayBackedInferenceProvider = ({
  aiTaskService
}: CreateGatewayBackedInferenceProviderOptions): InferenceProvider => {
  return {
    name: 'gateway_backed',
    strategies: ['model_routed'],
    requiresPrompt: true,
    async run(context: InferenceContext, prompt: PromptBundleV2): Promise<ProviderDecisionRaw> {
      const request = await buildAiTaskRequestFromInferenceContextV2(context, {
        task_type: 'agent_decision',
        prompt_bundle: prompt
      });

      try {
        const result = await aiTaskService.runTask<Record<string, unknown>>(request, {
          packAiConfig: context.world_ai ?? null
        });

        const output = {
          ...(result.output ?? {}),
          meta: isRecord(result.output['meta'])
            ? { ...result.output['meta'], ai_invocation_id: result.invocation.invocation_id }
            : { ai_invocation_id: result.invocation.invocation_id }
        };
        return isRecord(output) ? output : {};
      } catch {
        return FALLBACK_DECISION;
      }
    }
  };
};
