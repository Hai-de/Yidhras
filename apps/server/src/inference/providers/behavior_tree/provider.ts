import type { AiTaskService } from '../../../ai/task_service.js';
import type { InferenceProvider } from '../../provider.js';
import type { InferenceContext, ProviderDecisionRaw } from '../../types.js';
import { evaluateTree } from './evaluator.js';
import { TreeRegistry } from './tree_registry.js';
import type { BTCooldownState,BTEvalContext } from './types.js';

export interface BehaviorTreeProviderDeps {
  treeRegistry?: TreeRegistry;
  resolveTreeRegistry?: (context: InferenceContext) => TreeRegistry;
  aiTaskService?: AiTaskService;
  callHandler?: (name: string, input: unknown) => Promise<unknown>;
}

export const createBehaviorTreeProvider = ({
  treeRegistry,
  resolveTreeRegistry,
  aiTaskService,
  callHandler
}: BehaviorTreeProviderDeps): InferenceProvider => {
  // Cooldown state persists across run() calls per agent per tree
  const cooldownStore = new Map<string, BTCooldownState>();

  const getTreeRegistry = (context: InferenceContext): TreeRegistry => {
    if (resolveTreeRegistry) return resolveTreeRegistry(context);
    if (treeRegistry) return treeRegistry;
    throw new Error('Behavior tree provider requires treeRegistry or resolveTreeRegistry');
  };

  return {
    name: 'behavior_tree',
    strategies: ['behavior_tree'],
    requiresPrompt: false,

    async run(context: InferenceContext, _prompt): Promise<ProviderDecisionRaw> {
      const treeName = resolveTreeName(context);
      if (!treeName) {
        return {
          action_type: 'idle',
          target_ref: null,
          payload: { reason: 'behavior_tree_no_tree_name' },
          confidence: 0,
          reasoning: 'No behavior tree name configured for this actor'
        };
      }

      const treeDef = getTreeRegistry(context).get(treeName);
      const agentId = context.actor_ref.agent_id ?? 'unknown';

// @ts-expect-error -- EOPT strict mode
      const evalCtx: BTEvalContext = {
        inferenceContext: context,
        blackboard: {
          __cooldown_store: cooldownStore,
          __agent_id: agentId,
          __tree_name: treeName,
          __pack_id: context.world_pack.instance_id
        },
        aiTaskService,
        callHandler
      };

      const result = await evaluateTree(treeDef.name, treeDef.root, evalCtx);

      if (!result.decision) {
        return {
          action_type: 'idle',
          target_ref: null,
          payload: { reason: 'behavior_tree_no_decision' },
          confidence: 0,
          reasoning: 'Behavior tree evaluated to no decision this tick'
        };
      }

      return result.decision;
    }
  };
};

const resolveTreeName = (context: InferenceContext): string | null => {
  // Check attributes first (for testing / operator override)
  if (context.attributes['behavior_tree'] && typeof context.attributes['behavior_tree'] === 'string') {
    return context.attributes['behavior_tree'];
  }

  // Phase 7: resolve from actor entity definition inference config
  // For now, return null — Phase 7 wires the proper resolution
  return null;
};
