import type { PromptFragment, PromptFragmentSlot } from '../prompt_fragments.js';
import type { PromptProcessor } from '../prompt_processors.js';
import type { PromptProcessingTrace } from '../types.js';

const DEFAULT_BUDGET = 2200;

type SectionBudgetAllocation = NonNullable<NonNullable<PromptProcessingTrace['token_budget_trimming']>['section_budget']>['allocations'][number];

const createBaseTrace = (): PromptProcessingTrace => ({
  processor_names: [],
  fragment_count_before: 0,
  fragment_count_after: 0,
  fragments: []
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const BASE_SLOT_PRIORITY: Record<PromptFragmentSlot, number> = {
  system_core: 1000,
  system_policy: 950,
  role_core: 900,
  world_context: 850,
  output_contract: 800,
  post_process: 700,
  memory_summary: 600,
  memory_short_term: 500,
  memory_long_term: 400
};

const buildSlotPriority = (taskType: unknown): Record<PromptFragmentSlot, number> => {
  if (taskType === 'context_summary') {
    return {
      ...BASE_SLOT_PRIORITY,
      post_process: 250,
      memory_summary: 900,
      memory_short_term: 850,
      memory_long_term: 800,
      world_context: 300,
      role_core: 250,
      output_contract: 200
    };
  }

  if (taskType === 'memory_compaction') {
    return {
      ...BASE_SLOT_PRIORITY,
      memory_long_term: 950,
      memory_summary: 900,
      memory_short_term: 850,
      post_process: 260,
      world_context: 220,
      role_core: 200,
      output_contract: 180
    };
  }

  return BASE_SLOT_PRIORITY;
};

const estimateCost = (fragment: PromptFragment): number => {
  return fragment.content.length;
};

const scoreFragment = (fragment: PromptFragment, slotPriority: Record<PromptFragmentSlot, number>): number => {
  const importance = typeof fragment.metadata?.importance === 'number' ? fragment.metadata.importance : 0;
  const salience = typeof fragment.metadata?.salience === 'number' ? fragment.metadata.salience : 0;
  return slotPriority[fragment.slot] + fragment.priority + importance * 100 + salience * 50;
};

const getSectionIdForFragment = (fragment: PromptFragment, workflow?: {
  section_drafts?: Array<{ id: string; slot: string; section_type: string; ranking_score: number }>;
}): string | null => {
  if (!workflow?.section_drafts || workflow.section_drafts.length === 0) {
    return null;
  }

  const source = fragment.source;
  const slot = fragment.slot;
  const matchingDraft = workflow.section_drafts.find(draft => draft.slot === slot && (
    (source.includes('memory.summary') && draft.section_type === 'memory_summary') ||
    (source.includes('memory.long_term') && draft.section_type === 'memory_long_term') ||
    (source.includes('memory.short_term') && draft.section_type === 'memory_short_term') ||
    (source.includes('context.snapshot') && draft.section_type === 'context_snapshot') ||
    (source.includes('output.contract') && draft.section_type === 'output_contract')
  ));

  return matchingDraft?.id ?? workflow.section_drafts.find(draft => draft.slot === slot)?.id ?? null;
};

const getSectionBudgetForFragment = (fragment: PromptFragment, workflow: Parameters<typeof getSectionIdForFragment>[1], sectionBudget: NonNullable<NonNullable<PromptProcessingTrace['token_budget_trimming']>['section_budget']>): number | null => {
  const sectionId = getSectionIdForFragment(fragment, workflow);
  if (!sectionId) {
    return null;
  }
  return sectionBudget.allocations.find(allocation => allocation.section_id === sectionId)?.budget_tokens ?? null;
};

const groupFragmentIdsBySlot = (fragments: PromptFragment[]): Partial<Record<PromptFragmentSlot, string[]>> => {
  return fragments.reduce<Partial<Record<PromptFragmentSlot, string[]>>>((acc, fragment) => {
    const existing = acc[fragment.slot] ?? [];
    acc[fragment.slot] = [...existing, fragment.id];
    return acc;
  }, {});
};

const toSectionBudgetAllocations = (sectionSummary: Record<string, unknown> | null | undefined): SectionBudgetAllocation[] => {
  if (!sectionSummary || !Array.isArray(sectionSummary.section_scores)) {
    return [];
  }

  return sectionSummary.section_scores.flatMap(scoreEntry => {
    if (!isRecord(scoreEntry)) {
      return [];
    }

    const section_id = typeof scoreEntry.id === 'string' ? scoreEntry.id : null;
    const section_type = typeof scoreEntry.section_type === 'string' ? scoreEntry.section_type : null;
    const slot = typeof scoreEntry.slot === 'string' ? (scoreEntry.slot as PromptFragment['slot']) : null;
    const ranking_score = typeof scoreEntry.ranking_score === 'number' ? scoreEntry.ranking_score : null;
    if (!section_id || !section_type || !slot || ranking_score === null) {
      return [];
    }

    return [{
      section_id,
      section_type,
      slot,
      budget_share: 0,
      budget_tokens: 0,
      ranking_score,
      kept: true
    } satisfies SectionBudgetAllocation];
  });
};

const allocateSectionBudget = (input: {
  sectionSummary?: Record<string, unknown> | null;
  totalBudget: number;
}): NonNullable<NonNullable<PromptProcessingTrace['token_budget_trimming']>['section_budget']> => {
  const allocations = toSectionBudgetAllocations(input.sectionSummary);
  if (allocations.length === 0) {
    return {
      mode: 'fragment_only',
      total_budget: input.totalBudget,
      allocated_budget: 0,
      allocations: [],
      kept_section_ids: [],
      dropped_section_ids: []
    };
  }

  const totalScore = allocations.reduce((sum, allocation) => sum + Math.max(allocation.ranking_score, 0), 0);
  const normalizedAllocations = allocations.map(allocation => {
    const budget_share = totalScore > 0 ? allocation.ranking_score / totalScore : 0;
    return {
      ...allocation,
      budget_share,
      budget_tokens: Math.round(input.totalBudget * budget_share)
    };
  });

  return {
    mode: 'section_level',
    total_budget: input.totalBudget,
    allocated_budget: normalizedAllocations.reduce((sum, allocation) => sum + allocation.budget_tokens, 0),
    allocations: normalizedAllocations,
    kept_section_ids: normalizedAllocations.map(allocation => allocation.section_id),
    dropped_section_ids: []
  };
};

const pickWorkflowTaskType = (input: { workflowTaskType?: string | null; legacyTrace?: PromptProcessingTrace | null }): string | null => {
  if (typeof input.workflowTaskType === 'string' && input.workflowTaskType.length > 0) {
    return input.workflowTaskType;
  }

  return input.legacyTrace?.workflow_task_type ?? null;
};

const shouldAlwaysKeep = (fragment: PromptFragment): boolean => {
  return (
    fragment.slot === 'system_core' ||
    fragment.slot === 'role_core' ||
    fragment.slot === 'world_context' ||
    fragment.slot === 'output_contract'
  );
};

export const createTokenBudgetTrimmerPromptProcessor = (
  budget = DEFAULT_BUDGET
): PromptProcessor => {
  return {
    name: 'token-budget-trimmer',
    async process({ context, fragments, workflow }) {
      const legacyTrace = isRecord(context.memory_context.diagnostics.prompt_processing_trace)
        ? ({ ...createBaseTrace(), ...(context.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>) } as PromptProcessingTrace)
        : createBaseTrace();
      const workflowTaskType = pickWorkflowTaskType({
        workflowTaskType: workflow?.task_type ?? null,
        legacyTrace
      });
      const slotPriority = buildSlotPriority(workflowTaskType);
      const kept: PromptFragment[] = [];
      const alwaysKept: PromptFragment[] = [];
      const keptOptional: PromptFragment[] = [];
      const optional: PromptFragment[] = [];

      for (const fragment of fragments) {
        if (shouldAlwaysKeep(fragment)) {
          kept.push(fragment);
          alwaysKept.push(fragment);
        } else {
          optional.push(fragment);
        }
      }

      let used = kept.reduce((sum, fragment) => sum + estimateCost(fragment), 0);
      const sortedOptional = [...optional].sort((left, right) => scoreFragment(right, slotPriority) - scoreFragment(left, slotPriority));
      const sectionBudget = allocateSectionBudget({
        sectionSummary: workflow?.section_summary ?? null,
        totalBudget: budget
      });
      const sectionUsage = new Map<string, number>();
      const droppedSectionIds = new Set<string>();
      const keptSectionIds = new Set(sectionBudget.kept_section_ids);
      const optionalFragmentScores = sortedOptional.map(fragment => {
        const score = scoreFragment(fragment, slotPriority);
        return {
          fragment_id: fragment.id,
          slot: fragment.slot,
          score,
          estimated_cost: estimateCost(fragment),
          kept: false
        };
      });
      const trimmedFragmentIds: string[] = [];
      const trimmedFragments: PromptFragment[] = [];

      for (const fragment of sortedOptional) {
        const nextCost = estimateCost(fragment);
        const sectionId = getSectionIdForFragment(fragment, workflow);
        const sectionBudgetTokens = getSectionBudgetForFragment(fragment, workflow, sectionBudget);
        const currentSectionUsage = sectionId ? (sectionUsage.get(sectionId) ?? 0) : 0;
        const sectionHasBudget = sectionBudgetTokens === null || currentSectionUsage + nextCost <= sectionBudgetTokens;
        const withinTotalBudget = used + nextCost <= budget;

        if (withinTotalBudget && sectionHasBudget) {
          kept.push(fragment);
          keptOptional.push(fragment);
          used += nextCost;
          if (sectionId) {
            sectionUsage.set(sectionId, currentSectionUsage + nextCost);
          }
          const scoreEntry = optionalFragmentScores.find(entry => entry.fragment_id === fragment.id);
          if (scoreEntry) scoreEntry.kept = true;
        } else {
          trimmedFragmentIds.push(fragment.id);
          trimmedFragments.push(fragment);
          if (sectionId) {
            droppedSectionIds.add(sectionId);
            keptSectionIds.delete(sectionId);
          }
        }
      }

      const finalizedSectionBudget = {
        ...sectionBudget,
        allocations: sectionBudget.allocations.map(allocation => ({
          ...allocation,
          kept: keptSectionIds.has(allocation.section_id) && !droppedSectionIds.has(allocation.section_id)
        })),
        kept_section_ids: Array.from(keptSectionIds),
        dropped_section_ids: Array.from(droppedSectionIds)
      };

      const nextTrace: PromptProcessingTrace = {
        ...legacyTrace,
        workflow_task_type: workflowTaskType,
        prompt_workflow: workflow?.prompt_workflow ?? legacyTrace?.prompt_workflow ?? null,
        token_budget_trimming: {
          task_type: workflowTaskType,
          budget,
          used,
          trimmed_fragment_ids: trimmedFragmentIds,
          kept_fragment_ids: kept.map(fragment => fragment.id),
          always_kept_fragment_ids: alwaysKept.map(fragment => fragment.id),
          kept_optional_fragment_ids: keptOptional.map(fragment => fragment.id),
          slot_priority: slotPriority,
          optional_fragment_scores: optionalFragmentScores,
          section_budget: finalizedSectionBudget,
          trimmed_by_slot: groupFragmentIdsBySlot(trimmedFragments),
          trimmed_sources: trimmedFragments.map(fragment => fragment.source),
          section_summary: workflow?.section_summary ?? null
        }
      };

      context.memory_context.diagnostics = {
        ...context.memory_context.diagnostics,
        token_budget: budget,
        prompt_processing_trace: nextTrace
      };

      return kept;
    }
  };
};
