import { createMemoryInjectorPromptProcessor } from '../../inference/processors/memory_injector.js';
import { createMemorySummaryPromptProcessor } from '../../inference/processors/memory_summary.js';
import { createPolicyFilterPromptProcessor } from '../../inference/processors/policy_filter.js';
import { createTokenBudgetTrimmerPromptProcessor } from '../../inference/processors/token_budget_trimmer.js';
import type { PromptFragment } from '../../inference/prompt_fragments.js';
import type { PromptProcessor } from '../../inference/prompt_processors.js';
import type { InferenceContext, PromptProcessingTrace } from '../../inference/types.js';
import type { ContextPromptAssemblySummary } from '../types.js';
import { resolvePromptFragmentPlacement, sortPromptFragmentsBase } from './placement_resolution.js';
import { selectPromptWorkflowProfile } from './profiles.js';
import { createPromptWorkflowStepRegistry, type PromptWorkflowStepExecutor } from './registry.js';
import {
  buildFragmentsFromSectionDrafts,
  buildGroupedNodes,
  buildSectionDraftsFromFragments,
  buildSectionSummary
} from './section_drafts.js';
import {
  createInitialPromptWorkflowState,
  type PromptWorkflowRunOptions,
  type PromptWorkflowSelectionInput,
  type PromptWorkflowState,
  type PromptWorkflowStepKind,
  type PromptWorkflowStepSpec,
  type PromptWorkflowStepTrace
} from './types.js';

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

const buildDefaultLegacySteps = (): ContextOrchestratorStep[] => {
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

const sortFragments = (fragments: PromptFragment[]): PromptFragment[] => {
  return sortPromptFragmentsBase(fragments);
};

const summarizeState = (state: PromptWorkflowState): Record<string, unknown> => {
  return {
    selected_node_count: state.selected_nodes.length,
    working_set_count: state.working_set.length,
    grouped_node_bucket_count: Object.keys(state.grouped_nodes).length,
    fragment_count: state.fragments.length,
    section_draft_count: state.section_drafts.length,
    compatibility_mode: state.compatibility.mode,
    profile_id: state.profile.id,
    profile_version: state.profile.version
  };
};

const appendWorkflowStepTrace = (
  state: PromptWorkflowState,
  trace: PromptWorkflowStepTrace
): PromptWorkflowState => {
  return {
    ...state,
    diagnostics: {
      ...state.diagnostics,
      step_traces: [...state.diagnostics.step_traces, trace]
    }
  };
};

const buildFragmentDiffStep = (input: {
  processor_name: string;
  workflow_step_key: string;
  workflow_step_kind: PromptWorkflowStepKind;
  before: PromptFragment[];
  after: PromptFragment[];
  notes?: Record<string, unknown>;
}): NonNullable<PromptProcessingTrace['steps']>[number] => {
  const beforeIds = new Set(input.before.map(fragment => fragment.id));
  const afterIds = new Set(input.after.map(fragment => fragment.id));
  const addedFragmentIds = input.after.filter(fragment => !beforeIds.has(fragment.id)).map(fragment => fragment.id);
  const removedFragmentIds = input.before.filter(fragment => !afterIds.has(fragment.id)).map(fragment => fragment.id);

  return {
    processor_name: input.processor_name,
    fragment_count_before: input.before.length,
    fragment_count_after: input.after.length,
    added_fragment_ids: addedFragmentIds,
    removed_fragment_ids: removedFragmentIds,
    notes: {
      context_orchestrator_step_key: input.workflow_step_key,
      prompt_workflow_step_kind: input.workflow_step_kind,
      ...(input.notes ?? {})
    }
  };
};

const buildProcessingTrace = (input: {
  initial_fragments: PromptFragment[];
  final_fragments: PromptFragment[];
  processor_names: string[];
  step_traces: NonNullable<PromptProcessingTrace['steps']>;
  workflow_state: PromptWorkflowState;
}): PromptProcessingTrace => {
  return {
    processor_names: input.processor_names,
    fragment_count_before: input.initial_fragments.length,
    fragment_count_after: input.final_fragments.length,
    prompt_workflow: {
      task_type: input.workflow_state.task_type,
      profile_id: input.workflow_state.profile.id,
      profile_version: input.workflow_state.profile.version,
      selected_step_keys: input.workflow_state.diagnostics.selected_step_keys,
      step_traces: input.workflow_state.diagnostics.step_traces,
      compatibility: input.workflow_state.diagnostics.compatibility ?? null,
      placement_summary: input.workflow_state.diagnostics.placement_summary ?? null,
      section_summary: input.workflow_state.diagnostics.section_summary ?? null
    },
    workflow_task_type: input.workflow_state.task_type,
    workflow_profile_id: input.workflow_state.profile.id,
    workflow_profile_version: input.workflow_state.profile.version,
    workflow_step_keys: input.workflow_state.diagnostics.selected_step_keys,
    workflow_compatibility_mode: input.workflow_state.compatibility.mode,
    workflow_step_traces: input.workflow_state.diagnostics.step_traces,
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

const syncDiagnosticsToContext = (context: InferenceContext, input: {
  processor_names: string[];
  processing_trace: PromptProcessingTrace;
  workflow_state: PromptWorkflowState;
}): void => {
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
        step_keys: input.workflow_state.diagnostics.selected_step_keys,
        stage_order: STAGE_ORDER,
        processor_names: input.processor_names
      },
      prompt_workflow: {
        task_type: input.workflow_state.task_type,
        profile_id: input.workflow_state.profile.id,
        profile_version: input.workflow_state.profile.version,
        selected_step_keys: input.workflow_state.diagnostics.selected_step_keys,
        compatibility: input.workflow_state.diagnostics.compatibility ?? null,
        placement_summary: input.workflow_state.diagnostics.placement_summary ?? null,
        section_summary: input.workflow_state.diagnostics.section_summary ?? null
      },
      ...input.processing_trace
    }
  };

  context.context_run.diagnostics.orchestration = {
    step_keys: input.workflow_state.diagnostics.selected_step_keys,
    processor_names: input.processor_names,
    processing_trace: input.processing_trace,
    prompt_workflow: {
      task_type: input.workflow_state.task_type,
      profile_id: input.workflow_state.profile.id,
      profile_version: input.workflow_state.profile.version,
      selected_step_keys: input.workflow_state.diagnostics.selected_step_keys,
      step_traces: input.workflow_state.diagnostics.step_traces,
      compatibility: input.workflow_state.diagnostics.compatibility ?? null,
      placement_summary: input.workflow_state.diagnostics.placement_summary ?? null,
      section_summary: input.workflow_state.diagnostics.section_summary ?? null
    }
  };
};

const buildProcessorExecutor = (input: {
  kind: PromptWorkflowStepKind;
  processor: PromptProcessor;
}): PromptWorkflowStepExecutor => {
  return {
    kind: input.kind,
    async execute({ state, context }) {
      const nextFragments = sortFragments(
        await input.processor.process({
          context,
          fragments: state.fragments,
          workflow: {
            task_type: state.task_type,
            profile_id: state.profile.id,
            profile_version: state.profile.version,
            selected_step_keys: state.diagnostics.selected_step_keys,
            prompt_workflow: context.context_run.diagnostics.orchestration?.prompt_workflow as PromptProcessingTrace['prompt_workflow'] ?? null,
            section_drafts: state.section_drafts.map(draft => ({
              id: draft.id,
              slot: draft.slot,
              section_type: draft.section_type,
              ranking_score:
                typeof (draft.metadata?.task_policy as Record<string, unknown> | undefined)?.ranking_score === 'number'
                  ? ((draft.metadata?.task_policy as Record<string, unknown>).ranking_score as number)
                  : 0
            })),
            section_summary: state.diagnostics.section_summary ?? null
          }
        })
      );

      return {
        ...state,
        fragments: nextFragments
      };
    }
  };
};

const buildNoopExecutor = (
  kind: PromptWorkflowStepKind,
  apply?: (state: PromptWorkflowState) => PromptWorkflowState
): PromptWorkflowStepExecutor => {
  return {
    kind,
    async execute({ state }) {
      return apply ? apply(state) : state;
    }
  };
};

const buildExecutorRegistry = (legacySteps: ContextOrchestratorStep[]) => {
  const processorByStage = new Map(legacySteps.map(step => [step.stage, step.processor]));

  const memoryInjector = processorByStage.get('memory_injection') ?? createMemoryInjectorPromptProcessor();
  const policyFilter = processorByStage.get('policy_filter') ?? createPolicyFilterPromptProcessor();
  const memorySummary = processorByStage.get('summary_compaction') ?? createMemorySummaryPromptProcessor();
  const tokenBudgetTrimmer = processorByStage.get('token_budget_trim') ?? createTokenBudgetTrimmerPromptProcessor();

  return createPromptWorkflowStepRegistry([
    buildProcessorExecutor({ kind: 'legacy_memory_projection', processor: memoryInjector }),
    buildProcessorExecutor({ kind: 'node_working_set_filter', processor: policyFilter }),
    buildNoopExecutor('node_grouping', state => {
      const groupedNodes = buildGroupedNodes(state.working_set);
      const sectionPolicy = state.profile.defaults?.section_policy ?? 'standard';
      return {
        ...state,
        grouped_nodes: groupedNodes,
        diagnostics: {
          ...state.diagnostics,
          working_set_counts: Object.fromEntries(
            Object.entries(groupedNodes).map(([key, nodes]) => [key, nodes.length])
          ),
          section_summary: {
            ...(state.diagnostics.section_summary ?? {}),
            grouping_policy: { task_type: state.task_type, section_policy: sectionPolicy }
          }
        }
      };
    }),
    buildProcessorExecutor({ kind: 'summary_compaction', processor: memorySummary }),
    buildProcessorExecutor({ kind: 'token_budget_trim', processor: tokenBudgetTrimmer }),
    buildNoopExecutor('placement_resolution', state => {
      const placement = resolvePromptFragmentPlacement({
        fragments: state.fragments
      });
      return {
        ...state,
        fragments: placement.fragments,
        diagnostics: {
          ...state.diagnostics,
          placement_summary: placement.summary
        }
      };
    }),
    buildNoopExecutor('fragment_assembly', state => {
      const sectionPolicy = state.profile.defaults?.section_policy ?? 'standard';
      const sectionDrafts = buildSectionDraftsFromFragments(state.fragments, {
        task_type: state.task_type,
        section_policy: sectionPolicy
      });
      const sectionSummary = buildSectionSummary(sectionDrafts);
      return {
        ...state,
        section_drafts: sectionDrafts,
        fragments: buildFragmentsFromSectionDrafts(sectionDrafts),
        diagnostics: {
          ...state.diagnostics,
          section_summary: {
            ...(state.diagnostics.section_summary ?? {}),
            ...sectionSummary,
            task_type: state.task_type,
            section_policy: sectionPolicy,
            grouped_node_bucket_count: Object.keys(state.grouped_nodes).length,
            grouped_node_keys: Object.keys(state.grouped_nodes)
          }
        }
      };
    }),
    buildNoopExecutor('bundle_finalize'),
    buildNoopExecutor('ai_message_projection')
  ]);
};

const toLegacyStageNote = (kind: PromptWorkflowStepKind): Record<string, unknown> => {
  switch (kind) {
    case 'legacy_memory_projection':
      return {
        context_orchestrator_stage: 'memory_injection'
      };
    case 'node_working_set_filter':
      return {
        context_orchestrator_stage: 'policy_filter'
      };
    case 'summary_compaction':
      return {
        context_orchestrator_stage: 'summary_compaction'
      };
    case 'token_budget_trim':
      return {
        context_orchestrator_stage: 'token_budget_trim'
      };
    default:
      return {};
  }
};

const inferProcessorName = (kind: PromptWorkflowStepKind, specKey: string): string => {
  switch (kind) {
    case 'legacy_memory_projection':
      return 'memory-injector';
    case 'node_working_set_filter':
      return 'policy-filter';
    case 'summary_compaction':
      return 'memory-summary';
    case 'token_budget_trim':
      return 'token-budget-trimmer';
    default:
      return `prompt-workflow:${specKey}`;
  }
};

const executeWorkflowStep = async (input: {
  context: InferenceContext;
  state: PromptWorkflowState;
  spec: PromptWorkflowStepSpec;
  executor: PromptWorkflowStepExecutor | null;
}): Promise<{
  state: PromptWorkflowState;
  processor_name: string;
  fragment_trace: NonNullable<PromptProcessingTrace['steps']>[number];
}> => {
  const processorName = inferProcessorName(input.spec.kind, input.spec.key);
  const beforeFragments = input.state.fragments;
  const beforeStateSummary = summarizeState(input.state);

  if (!input.executor || input.spec.enabled === false) {
    const skippedTrace: PromptWorkflowStepTrace = {
      key: input.spec.key,
      kind: input.spec.kind,
      status: 'skipped',
      before: beforeStateSummary,
      after: beforeStateSummary,
      notes: {
        reason: input.spec.enabled === false ? 'disabled' : 'executor_missing'
      }
    };
    const skippedState = appendWorkflowStepTrace(input.state, skippedTrace);

    return {
      state: skippedState,
      processor_name: processorName,
      fragment_trace: buildFragmentDiffStep({
        processor_name: processorName,
        workflow_step_key: input.spec.key,
        workflow_step_kind: input.spec.kind,
        before: beforeFragments,
        after: beforeFragments,
        notes: {
          ...toLegacyStageNote(input.spec.kind),
          prompt_workflow_step_status: 'skipped'
        }
      })
    };
  }

  const executedState = await input.executor.execute({
    context: input.context,
    profile: input.state.profile,
    spec: input.spec,
    state: input.state
  });
  const normalizedState = {
    ...executedState,
    fragments: sortFragments(executedState.fragments)
  } satisfies PromptWorkflowState;

  const completedTrace: PromptWorkflowStepTrace = {
    key: input.spec.key,
    kind: input.spec.kind,
    status: 'completed',
    before: beforeStateSummary,
    after: summarizeState(normalizedState),
    notes: {
      processor_name: processorName,
      ...toLegacyStageNote(input.spec.kind)
    }
  };
  const tracedState = appendWorkflowStepTrace(normalizedState, completedTrace);

  return {
    state: tracedState,
    processor_name: processorName,
    fragment_trace: buildFragmentDiffStep({
      processor_name: processorName,
      workflow_step_key: input.spec.key,
      workflow_step_kind: input.spec.kind,
      before: beforeFragments,
      after: tracedState.fragments,
      notes: {
        ...toLegacyStageNote(input.spec.kind),
        prompt_workflow_step_status: 'completed'
      }
    })
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

export const runPromptWorkflow = async (
  context: InferenceContext,
  fragments: PromptFragment[],
  options: PromptWorkflowRunOptions = {},
  legacySteps: ContextOrchestratorStep[] = buildDefaultLegacySteps()
): Promise<ContextOrchestratorRunResult> => {
  const selectionInput: PromptWorkflowSelectionInput = {
    task_type: options.task_type ?? 'agent_decision',
    strategy: context.strategy,
    pack_id: context.world_pack.id,
    profile_id: options.profile_id ?? null
  };
  const profile = selectPromptWorkflowProfile(selectionInput);
  let state = createInitialPromptWorkflowState({
    context_run: context.context_run,
    actor_ref: context.actor_ref,
    task_type: selectionInput.task_type,
    strategy: context.strategy,
    pack_id: context.world_pack.id,
    profile,
    fragments: sortFragments(fragments),
    compatibility: {
      mode: profile.defaults?.compatibility_mode ?? 'full',
      legacy_memory_context: context.memory_context
    }
  });

  const registry = buildExecutorRegistry(legacySteps);
  const initialFragments = state.fragments;
  const fragmentStepTraces: NonNullable<PromptProcessingTrace['steps']> = [];
  const processorNames: string[] = [];

  for (const spec of profile.steps) {
    const result = await executeWorkflowStep({
      context,
      state,
      spec,
      executor: registry.get(spec.kind)
    });
    state = result.state;
    fragmentStepTraces.push(result.fragment_trace);
    processorNames.push(result.processor_name);
  }

  if (state.diagnostics.compatibility) {
    state.diagnostics.compatibility.legacy_memory_context_used = state.compatibility.mode !== 'off' && context.memory_context !== null;
    state.diagnostics.compatibility.legacy_processors_used = Array.from(new Set(processorNames.filter(name => !name.startsWith('prompt-workflow:'))));
  }

  const processingTrace = buildProcessingTrace({
    initial_fragments: initialFragments,
    final_fragments: state.fragments,
    processor_names: processorNames,
    step_traces: fragmentStepTraces,
    workflow_state: state
  });

  syncDiagnosticsToContext(context, {
    processor_names: processorNames,
    processing_trace: processingTrace,
    workflow_state: state
  });

  return {
    fragments: state.fragments,
    processing_trace: processingTrace
  };
};
