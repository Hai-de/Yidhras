import { createGatewayBackedInferenceProvider } from '../../ai/providers/gateway_backed.js';
import type { AiTaskService } from '../../ai/task_service.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { InferenceProvider } from '../../inference/provider.js';
import { createBehaviorTreeProvider } from '../../inference/providers/behavior_tree/provider.js';
import { TreeRegistry } from '../../inference/providers/behavior_tree/tree_registry.js';
import { createMockInferenceProvider } from '../../inference/providers/mock.js';
import type { AppContext } from '../context.js';

export interface CreateInferenceProvidersInput {
  context: AppContext;
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
  // TreeRegistry is populated by pack loading (Phase 8 integration)
  const treeRegistry = new TreeRegistry('global');

  return [
    createMockInferenceProvider(),
    createGatewayBackedInferenceProvider({ aiTaskService }),
    createBehaviorTreeProvider({ treeRegistry })
  ];
};
