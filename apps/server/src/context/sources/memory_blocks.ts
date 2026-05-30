import { randomUUID } from 'node:crypto';

import { buildPromptBundleFromAiMessages } from '../../ai/prompt_bundle_from_messages.js';
import { createAiTaskService } from '../../ai/task_service.js';
import type { AiTaskRequest } from '../../ai/types.js';
import type { AppInfrastructure } from '../../app/context.js';
import { getMemoryTriggerEngineConfig } from '../../config/runtime_config.js';
import type { IdentityContext } from '../../identity/types.js';
import type { InferenceActorRef,InferencePackStateSnapshot  } from '../../inference/types.js';
import { buildMemoryEvaluationContext } from '../../memory/blocks/evaluation_context.js';
import { materializeMemoryBlockToContextNode } from '../../memory/blocks/materializer.js';
import {
  buildMemoryTriggerSourceEvaluateInput,
  createMemoryTriggerEngineProvider
} from '../../memory/blocks/provider.js';
import type { LongMemoryBlockStore, MemoryActivationEvaluation } from '../../memory/blocks/types.js';
import { createLogger } from '../../utils/logger.js';
import type { ContextNode } from '../types.js';

const logger = createLogger('context-memory-blocks');

const collectSemanticQueryTemplates = (
  records: Array<{ behavior: { activation: { triggers: Array<{ type: string; query_template?: string | undefined }> } } }>
): string[] => {
  const templates: string[] = [];
  for (const record of records) {
    for (const trigger of record.behavior.activation.triggers) {
      if (trigger.type === 'semantic' && trigger.query_template && trigger.query_template.trim().length > 0) {
        templates.push(trigger.query_template.trim());
      }
    }
  }
  return templates;
};

const buildSemanticQueryText = (
  templates: string[],
  evaluationContext: { recent?: { trace?: Array<{ payload: Record<string, unknown> }>; event?: Array<{ payload: Record<string, unknown> }> } }
): string => {
  const template = templates[0];
  const contextLines: string[] = [];

  const recentTraces = evaluationContext.recent?.trace ?? [];
  for (const trace of recentTraces.slice(0, 3)) {
    const reasoning = typeof trace.payload['reasoning'] === 'string' ? trace.payload['reasoning'] : null;
    if (reasoning && reasoning.trim().length > 0) {
      contextLines.push(`[Trace] ${reasoning}`);
    }
  }

  const recentEvents = evaluationContext.recent?.event ?? [];
  for (const event of recentEvents.slice(0, 3)) {
    const title = typeof event.payload['title'] === 'string' ? event.payload['title'] : null;
    if (title && title.trim().length > 0) {
      contextLines.push(`[Event] ${title}`);
    }
  }

  const contextBlock = contextLines.length > 0 ? `\nRecent context:\n${contextLines.join('\n')}` : '';
  return `${template}${contextBlock}`;
};

const generateQueryEmbedding = async (
  context: AppInfrastructure,
  queryText: string
): Promise<number[] | null> => {
  const taskService = createAiTaskService({ context });

  const messages = [
    {
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: queryText }]
    }
  ];
  const taskId = randomUUID();
  const request: AiTaskRequest = {
    task_id: taskId,
    task_type: 'embedding',
    input: {},
    prompt_context: {
      prompt_bundle_v2: buildPromptBundleFromAiMessages({ taskId, taskType: 'embedding', messages })
    }
  };

  const result = await taskService.runTask<number[]>(request);
  return result.output;
};

export interface MemoryBlockSourceBuildResult {
  nodes: ContextNode[];
  evaluations: MemoryActivationEvaluation[];
  trigger_rate_summary?: {
    present_count: number;
    applied_count: number;
    blocked_count: number;
  } | null;
}

export const buildContextNodesFromMemoryBlocks = async (input: {
  context: AppInfrastructure;
  actor_ref: InferenceActorRef;
  identity: IdentityContext;
  resolved_agent_id: string | null;
  pack_id: string;
  tick: bigint;
  attributes: Record<string, unknown>;
  pack_state: InferencePackStateSnapshot;
  longMemoryBlockStore: LongMemoryBlockStore;
  query_embedding?: number[];
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

  if (input.query_embedding && input.query_embedding.length > 0) {
    evaluationContext.query_embedding = input.query_embedding;
  }

  const records = await input.longMemoryBlockStore.listCandidateBlocks({
    owner_agent_id: agentId,
    pack_id: input.pack_id,
    limit: input.limit ?? 20
  });

  if (records.length === 0) {
    return {
      nodes: [],
      evaluations: [],
      trigger_rate_summary: null
    };
  }

  if (!evaluationContext.query_embedding) {
    const templates = collectSemanticQueryTemplates(records);
    if (templates.length > 0) {
// @ts-expect-error -- EOPT strict mode
      const queryText = buildSemanticQueryText(templates, evaluationContext);
      try {
        const embedding = await generateQueryEmbedding(input.context, queryText);
        if (embedding && embedding.length > 0) {
          evaluationContext.query_embedding = embedding;
        }
      } catch (error) {
        logger.warn(
          `Failed to generate semantic query embedding: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const engineConfig = getMemoryTriggerEngineConfig();
  const provider = createMemoryTriggerEngineProvider({
    timeoutMs: engineConfig.timeout_ms,
    binaryPath: engineConfig.binary_path,
    autoRestart: engineConfig.auto_restart
  });

  let providerResult;
  try {
    providerResult = await provider.evaluateWithMetadata(buildMemoryTriggerSourceEvaluateInput({
      evaluation_context: evaluationContext,
      candidates: records
    }));
  } catch (error) {
    logger.warn(
      `Rust sidecar unavailable, skipping memory block evaluation: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      nodes: [],
      evaluations: [],
      trigger_rate_summary: null
    };
  }

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
    trigger_rate_summary: {
      ...providerResult.result.diagnostics.trigger_rate
    }
  };
};
