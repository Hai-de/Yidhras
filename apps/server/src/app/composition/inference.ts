import { createGatewayBackedInferenceProvider } from '../../ai/providers/gateway_backed.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { InferenceProvider } from '../../inference/provider.js';
import { createBehaviorTreeProvider } from '../../inference/providers/behavior_tree/provider.js';
import { TreeRegistry } from '../../inference/providers/behavior_tree/tree_registry.js';
import { createMockInferenceProvider } from '../../inference/providers/mock.js';
import { isRecord } from '../../utils/type_guards.js';
import type { DataContext } from '../context.js';
import { pluginRuntimeRegistry } from '../runtime/plugin_runtime_registry.js';

export interface CreateInferenceProvidersInput {
  context: DataContext;
  aiTaskService?: AiTaskService;
}

/**
 * 创建 inference provider 组合。
 * 集中所有 provider 的实例化与注入逻辑，作为 inference 子系统的组装根。
 */
export const createInferenceProviders = ({
  context,
  aiTaskService = createAiTaskService({ context })
}: CreateInferenceProvidersInput): InferenceProvider[] => {
  const registryCache = new Map<string, TreeRegistry>();

  const resolveTreeRegistry = (packId: string, rawTrees: unknown): TreeRegistry => {
    const cached = registryCache.get(packId);
    if (cached) return cached;

    const registry = new TreeRegistry(packId);
    if (isRecord(rawTrees)) {
      registry.register(rawTrees);
    }
    registryCache.set(packId, registry);
    return registry;
  };

  return [
    createMockInferenceProvider(),
    createGatewayBackedInferenceProvider({ aiTaskService }),
    createBehaviorTreeProvider({
      aiTaskService,
      callHandler: async (name: string, input: unknown) => {
        if (!isRecord(input)) return null;
        const blackboard = input['blackboard'];
        if (!isRecord(blackboard)) return null;
        const packId = blackboard['__pack_id'];
        if (typeof packId !== 'string') return null;

        const runtimes = pluginRuntimeRegistry.listRuntimes(packId);
        for (const runtime of runtimes) {
          if (runtime.handler_names.includes(name) && runtime.worker_client) {
            return runtime.worker_client.invoke('handler', name, input);
          }
        }
        return null;
      },
      resolveTreeRegistry: (inferenceContext) => {
        const packId = inferenceContext.world_pack.instance_id;
        return resolveTreeRegistry(packId, inferenceContext.world_pack.behavior_trees);
      }
    })
  ];
};
