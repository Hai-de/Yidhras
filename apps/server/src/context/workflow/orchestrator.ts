import { createMemoryInjectorPromptProcessor } from '../../inference/processors/memory_injector.js';
import { createMemorySummaryPromptProcessor } from '../../inference/processors/memory_summary.js';
import { createPolicyFilterPromptProcessor } from '../../inference/processors/policy_filter.js';
import { createTokenBudgetTrimmerPromptProcessor } from '../../inference/processors/token_budget_trimmer.js';
import type { PromptFragment } from '../../inference/prompt_fragments.js';
import type { PromptProcessor } from '../../inference/prompt_processors.js';
import type { InferenceContext, PromptProcessingTrace } from '../../inference/types.js';
import type { ContextPromptAssemblySummary } from '../types.js';

export interface ContextOrchestratorStep {
  key: string;
  stage: 'memory_injection' | 'policy_filter' | 'summary_compaction' | 'token_budget_trim';
  processor: PromptProcessor;
}

export interface ContextOrchestratorRunResult {
  fragments: PromptFragment[];
  processing_trace: PromptProcessingTrace;
}

const STAGE_ORDER: Array<ContextOrchestratorStep['stage']> = [
  'memory_injection',
  'policy_filter',
  'summary_compaction',
  'token_budget_trim'
];

const buildDefaultSteps = (): ContextOrchestratorStep[] => {
  return [
    {
      key: 'memory_injection',
      stage: 'memory_injection',
      processor: createMemoryInjectorPromptProcessor()
    },
    {
      key: 'policy_filter',
      stage: 'policy_filter',
      processor: createPolicyFilterPromptProcessor()
    },
    {
      key: 'summary_compaction',
      stage: 'summary_compaction',
      processor: createMemorySummaryPromptProcessor()
    },
    {
      key: 'token_budget_trim',
      stage: 'token_budget_trim',
      processor: createTokenBudgetTrimmerPromptProcessor()
    }
  ];
};

const getAnchorKey = (fragment: PromptFragment): string => {
  if (!fragment.anchor || typeof fragment.anchor !== 'object') {
    return '';
  }

  return `${fragment.anchor.kind}:${fragment.anchor.value}`;
};

const getDepth = (fragment: PromptFragment): number => {
  return typeof fragment.depth === 'number' && Number.isFinite(fragment.depth) ? fragment.depth : 0;
};

const getOrder = (fragment: PromptFragment): number => {
  return typeof fragment.order === 'number' && Number.isFinite(fragment.order) ? fragment.order : 0;
};

const sortFragments = (fragments: PromptFragment[]): PromptFragment[] => {
  return [...fragments].sort((left, right) => {
    if (left.slot !== right.slot) {
      return left.slot.localeCompare(right.slot);
    }

    const leftAnchor = getAnchorKey(left);
    const rightAnchor = getAnchorKey(right);
    if (leftAnchor !== rightAnchor) {
      return leftAnchor.localeCompare(rightAnchor);
    }

    const depthDiff = getDepth(left) - getDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }

    const orderDiff = getOrder(left) - getOrder(right);
    if (orderDiff !== 0) {
      return orderDiff;
    }

    const priorityDiff = right.priority - left.priority;
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.id.localeCompare(right.id);
  });
};

const buildFragmentDiffStep = (
  step: ContextOrchestratorStep,
  before: PromptFragment[],
  after: PromptFragment[]
): NonNullable<PromptProcessingTrace['steps']>[number] => {
  const beforeIds = new Set(before.map(fragment => fragment.id));
  const afterIds = new Set(after.map(fragment => fragment.id));
  const addedFragmentIds = after.filter(fragment => !beforeIds.has(fragment.id)).map(fragment => fragment.id);
  const removedFragmentIds = before.filter(fragment => !afterIds.has(fragment.id)).map(fragment => fragment.id);

  return {
    processor_name: step.processor.name,
    fragment_count_before: before.length,
    fragment_count_after: after.length,
    added_fragment_ids: addedFragmentIds,
    removed_fragment_ids: removedFragmentIds,
    notes: {
      context_orchestrator_stage: step.stage,
      context_orchestrator_step_key: step.key
    }
  };
};

const buildProcessingTrace = (input: {
  initial_fragments: PromptFragment[];
  final_fragments: PromptFragment[];
  steps: ContextOrchestratorStep[];
  step_traces: NonNullable<PromptProcessingTrace['steps']>;
}): PromptProcessingTrace => {
  return {
    processor_names: input.steps.map(step => step.processor.name),
    fragment_count_before: input.initial_fragments.length,
    fragment_count_after: input.final_fragments.length,
    steps: input.step_traces,
    fragments: input.final_fragments.map(fragment => ({
      id: fragment.id,
      slot: fragment.slot,
      source: fragment.source,
      priority: fragment.priority,
      metadata: fragment.metadata
    }))
  };
};

export const buildContextPromptAssemblySummary = (fragments: PromptFragment[]): ContextPromptAssemblySummary => {
  return {
    total_fragments: fragments.length,
    fragments_by_slot: fragments.reduce<Record<string, number>>((acc, fragment) => {
      acc[fragment.slot] = (acc[fragment.slot] ?? 0) + 1;
      return acc;
    }, {}),
    fragment_sources: Array.from(new Set(fragments.map(fragment => fragment.source)))
  };
};

export const runContextOrchestrator = async (
  context: InferenceContext,
  fragments: PromptFragment[],
  steps: ContextOrchestratorStep[] = buildDefaultSteps()
): Promise<ContextOrchestratorRunResult> => {
  let current = sortFragments(fragments);
  const initialFragments = current;
  const stepTraces: NonNullable<PromptProcessingTrace['steps']> = [];

  for (const step of steps) {
    const before = current;
    const after = sortFragments(
      await step.processor.process({
        context,
        fragments: before
      })
    );
    stepTraces.push(buildFragmentDiffStep(step, before, after));
    current = after;
  }

  const processingTrace = buildProcessingTrace({
    initial_fragments: initialFragments,
    final_fragments: current,
    steps,
    step_traces: stepTraces
  });

  context.memory_context.diagnostics = {
    ...context.memory_context.diagnostics,
    prompt_processing_trace: {
      ...(typeof context.memory_context.diagnostics.prompt_processing_trace === 'object' &&
      context.memory_context.diagnostics.prompt_processing_trace !== null
        ? (context.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>)
        : {}),
      context_run_id: context.context_run.id,
      selected_node_ids: context.context_run.selected_node_ids,
      selected_node_summaries: context.context_run.diagnostics.selected_node_summaries ?? [],
      dropped_nodes: context.context_run.diagnostics.dropped_nodes,
      node_counts_by_type: context.context_run.diagnostics.node_counts_by_type,
      context_orchestrator: {
        step_keys: steps.map(step => step.key),
        stage_order: STAGE_ORDER,
        processor_names: steps.map(step => step.processor.name)
      },
      ...processingTrace
    }
  };
  context.context_run.diagnostics.orchestration = {
    step_keys: steps.map(step => step.key),
    processor_names: steps.map(step => step.processor.name),
    processing_trace: processingTrace
  };

  return {
    fragments: current,
    processing_trace: processingTrace
  };
};
