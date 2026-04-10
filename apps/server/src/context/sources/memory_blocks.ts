import type { AppContext } from '../../app/context.js';
import type { IdentityContext } from '../../identity/types.js';
import type { InferenceActorRef,InferencePackStateSnapshot  } from '../../inference/types.js';
import { buildMemoryEvaluationContext } from '../../memory/blocks/evaluation_context.js';
import { materializeMemoryBlockToContextNode } from '../../memory/blocks/materializer.js';
import { applyMemoryActivationToRuntimeState, evaluateMemoryBlockActivation } from '../../memory/blocks/trigger_engine.js';
import type { LongMemoryBlockStore, MemoryActivationEvaluation } from '../../memory/blocks/types.js';
import type { ContextNode } from '../types.js';

export interface MemoryBlockSourceBuildResult {
  nodes: ContextNode[];
  evaluations: MemoryActivationEvaluation[];
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

  const evaluations: MemoryActivationEvaluation[] = [];
  const nodes: ContextNode[] = [];

  for (const record of records) {
    const evaluation = evaluateMemoryBlockActivation({
      block: record.block,
      behavior: record.behavior,
      state: record.state,
      context: evaluationContext
    });

    const nextState = applyMemoryActivationToRuntimeState({
      behavior: record.behavior,
      evaluation,
      previousState: record.state,
      currentTick: input.tick.toString()
    });

    await input.longMemoryBlockStore.updateRuntimeState(nextState);
    evaluations.push(evaluation);

    if (evaluation.status === 'active' || evaluation.status === 'retained') {
      nodes.push(materializeMemoryBlockToContextNode({
        block: record.block,
        behavior: record.behavior,
        evaluation
      }));
    }
  }

  return {
    nodes,
    evaluations
  };
};
