import type { AppContext } from '../../app/context.js';
import { getMemoryTriggerEngineConfig } from '../../config/runtime_config.js';
import type { IdentityContext } from '../../identity/types.js';
import type { InferenceActorRef,InferencePackStateSnapshot  } from '../../inference/types.js';
import { buildMemoryEvaluationContext } from '../../memory/blocks/evaluation_context.js';
import { materializeMemoryBlockToContextNode } from '../../memory/blocks/materializer.js';
import {
  buildMemoryTriggerSourceEvaluateInput,
  createMemoryTriggerEngineProvider
} from '../../memory/blocks/provider.js';
import type { LongMemoryBlockStore, MemoryActivationEvaluation, MemoryTriggerEngineEvaluationMetadata } from '../../memory/blocks/types.js';
import type { ContextNode } from '../types.js';

export interface MemoryBlockSourceBuildResult {
  nodes: ContextNode[];
  evaluations: MemoryActivationEvaluation[];
  evaluation_metadata?: MemoryTriggerEngineEvaluationMetadata | null;
  ignored_feature_counts?: { trigger_rate_ignored_count: number } | null;
}

export const buildContextNodesFromMemoryBlocks = async (input: {
  context: AppContext;
  actor_ref: InferenceActorRef;
  identity: IdentityContext;
  resolved_agent_id: string | null;
  pack_id: string;
  tick: bigint;
  attributes: Record<string, unknown>;
  pack_state: InferencePackStateSnapshot;
  longMemoryBlockStore: LongMemoryBlockStore;
  limit?: number;
}): Promise<MemoryBlockSourceBuildResult> => {
  const agentId = input.resolved_agent_id;
  if (!agentId) {
    return {
      nodes: [],
      evaluations: []
    };
  }

  const evaluationContext = await buildMemoryEvaluationContext({
    context: input.context,
    actor_ref: input.actor_ref,
    identity: input.identity,
    resolved_agent_id: input.resolved_agent_id,
    pack_id: input.pack_id,
    tick: input.tick,
    attributes: input.attributes,
    pack_state: input.pack_state
  });

  const records = await input.longMemoryBlockStore.listCandidateBlocks({
    owner_agent_id: agentId,
    pack_id: input.pack_id,
    limit: input.limit ?? 20
  });

  const engineConfig = getMemoryTriggerEngineConfig();
  const provider = createMemoryTriggerEngineProvider({
    mode: engineConfig.mode,
    timeoutMs: engineConfig.timeout_ms,
    binaryPath: engineConfig.binary_path,
    autoRestart: engineConfig.auto_restart
  });

  const providerResult = await provider.evaluateWithMetadata(buildMemoryTriggerSourceEvaluateInput({
    evaluation_context: evaluationContext,
    candidates: records
  }));

  for (const recordResult of providerResult.result.records) {
    await input.longMemoryBlockStore.updateRuntimeState(recordResult.next_runtime_state);
  }

  const evaluations = providerResult.result.records.map(record => record.evaluation);
  const nodes = providerResult.result.records
    .filter(record => record.should_materialize)
    .map(record => {
      const candidate = records.find(item => item.block.id === record.memory_id);
      if (!candidate) {
        return null;
      }

      return materializeMemoryBlockToContextNode({
        block: candidate.block,
        behavior: candidate.behavior,
        evaluation: record.evaluation
      });
    })
    .filter((node): node is ContextNode => Boolean(node));

  return {
    nodes,
    evaluations,
    evaluation_metadata: providerResult.metadata,
    ignored_feature_counts: {
      trigger_rate_ignored_count: providerResult.result.diagnostics.ignored_features.trigger_rate_present_count
    }
  };
};
