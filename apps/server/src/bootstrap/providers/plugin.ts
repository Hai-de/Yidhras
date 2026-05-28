/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import { buildPromptBundleFromAiMessages } from '../../ai/prompt_bundle_from_messages.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import { createMemoryBehaviorStateStore, setBehaviorStateStore } from '../../app/behavior_state_store.js';
import type { AppContext } from '../../app/context.js';
import { pluginRuntimeRegistry, syncPackPluginRuntime } from '../../plugins/runtime.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const behaviorStateStoreInitProvider: ServiceProvider = {
  provide: TOKENS.behaviorStateStoreInit,
  useFactory: () => {
    setBehaviorStateStore(createMemoryBehaviorStateStore());
    return { initialized: true };
  }
};

export const pluginRuntimeControlProvider: ServiceProvider = {
  provide: TOKENS.pluginRuntimeControl,
  deps: [TOKENS.appContext],
  useFactory: (deps) => {
     
    const { appContext } = deps as unknown as { appContext: AppContext };
    return {
      reload: async (packId: string) => {
        await syncPackPluginRuntime(appContext, packId);
        const runtimeCount = pluginRuntimeRegistry.listRuntimes(packId).length;
        return { pack_id: packId, runtime_count: runtimeCount };
      }
    };
  }
};

export const pluginAiTaskServiceProvider: ServiceProvider = {
  provide: TOKENS.pluginAiTaskService,
  deps: [TOKENS.appContext],
  useFactory: (deps) => {
     
    const { appContext } = deps as unknown as { appContext: AppContext };
    return createAiTaskService({ context: appContext });
  }
};

export const requestPluginInferenceProvider: ServiceProvider = {
  provide: TOKENS.requestPluginInference,
  deps: [TOKENS.pluginAiTaskService],
  useFactory: (deps) => {
     
    const { pluginAiTaskService } = deps as unknown as { pluginAiTaskService: AiTaskService };
    return async (input: Record<string, unknown>) => {
      const messages = [
        { role: 'system' as const, parts: [{ type: 'text' as const, text: input.systemPrompt as string }] },
        { role: 'user' as const, parts: [{ type: 'text' as const, text: input.userPrompt as string }] }
      ];
      const taskId = `plugin:${String(input.purpose)}`;
      const result = await pluginAiTaskService.runTask({
        task_id: taskId,
        task_type: 'agent_decision',
        input: {},
        prompt_context: {
          prompt_bundle_v2: buildPromptBundleFromAiMessages({ taskId, taskType: 'agent_decision', messages })
        },
        output_contract: { mode: 'free_text' },
        route_hints: input.maxTokens
          ? { determinism_tier: 'balanced' }
          : undefined
      });
      return {
        content: result.invocation.output.text ?? '',
        usage: {
          inputTokens: result.invocation.usage?.input_tokens ?? 0,
          outputTokens: result.invocation.usage?.output_tokens ?? 0
        }
      };
    };
  }
};
