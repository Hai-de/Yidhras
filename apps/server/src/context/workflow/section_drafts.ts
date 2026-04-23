import { randomUUID } from 'node:crypto';

import type { PromptFragment } from '../../inference/prompt_fragments.js';
import type { ContextNode } from '../types.js';
import type {
  PromptSectionDraft,
  PromptSectionDraftType,
  PromptWorkflowSectionBudgetSummary,
  PromptWorkflowSectionPolicy,
  PromptWorkflowTaskType
} from './types.js';

const PROTECTED_SECTION_TYPES: ReadonlySet<string> = new Set<string>([
  'system_instruction',
  'role_context',
  'world_context'
]);

interface OriginalFragmentMetadata {
  id: string;
  slot: PromptFragment['slot'];
  priority: number;
  source: string;
  removable: boolean;
  replaceable: boolean;
  metadata: Record<string, unknown> | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toSectionType = (fragment: PromptFragment): PromptSectionDraftType => {
  switch (fragment.slot) {
    case 'system_core':
    case 'system_policy':
      return 'system_instruction';
    case 'role_core':
      return 'role_context';
    case 'world_context':
      return 'world_context';
    case 'memory_short_term':
      return 'memory_short_term';
    case 'memory_long_term':
      return 'memory_long_term';
    case 'memory_summary':
      return 'memory_summary';
    case 'output_contract':
      return 'output_contract';
    case 'post_process':
      return 'context_snapshot';
    default:
      return 'recent_evidence';
  }
};

const toGroupingKey = (node: ContextNode): string => {
  if (node.placement_policy.preferred_slot) {
    return `slot:${node.placement_policy.preferred_slot}`;
  }

  if (node.source_kind === 'overlay') {
    return 'source:overlay';
  }

  if (node.source_kind === 'summary') {
    return 'summary';
  }

  return `source:${node.source_kind}`;
};

const resolveSourceNodeIds = (fragment: PromptFragment): string[] => {
  const candidateIds = [
    typeof fragment.metadata?.memory_entry_id === 'string' ? fragment.metadata.memory_entry_id : null,
    typeof fragment.metadata?.memory_block_id === 'string' ? fragment.metadata.memory_block_id : null,
    typeof fragment.metadata?.node_id === 'string' ? fragment.metadata.node_id : null
  ].filter((value): value is string => value !== null);

  return Array.from(new Set(candidateIds));
};

const toOriginalFragmentMetadata = (fragment: PromptFragment): OriginalFragmentMetadata => ({
  id: fragment.id,
  slot: fragment.slot,
  priority: fragment.priority,
  source: fragment.source,
  removable: fragment.removable !== false,
  replaceable: fragment.replaceable !== false,
  metadata: fragment.metadata ?? null
});

const toOriginalFragmentMetadataRecord = (value: unknown): OriginalFragmentMetadata | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { id, slot, priority, source } = value;
  if (
    typeof id !== 'string' ||
    typeof slot !== 'string' ||
    typeof priority !== 'number' ||
    typeof source !== 'string'
  ) {
    return null;
  }

  return {
    id,
    slot: slot as PromptFragment['slot'],
    priority,
    source,
    removable: value.removable !== false,
    replaceable: value.replaceable !== false,
    metadata: isRecord(value.metadata) ? value.metadata : null
  };
};

export const buildGroupedNodes = (nodes: ContextNode[]): Record<string, ContextNode[]> => {
  return nodes.reduce<Record<string, ContextNode[]>>((acc, node) => {
    const key = toGroupingKey(node);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(node);
    return acc;
  }, {});
};

type TaskPolicyName = 'standard' | 'evidence_first' | 'memory_focused';

const isTaskPolicyRecord = (value: unknown): value is Record<string, unknown> => {
  return isRecord(value);
};

const getTaskPolicyRankingScore = (draft: PromptSectionDraft): number => {
  return isTaskPolicyRecord(draft.metadata?.task_policy) && typeof draft.metadata.task_policy.ranking_score === 'number'
    ? draft.metadata.task_policy.ranking_score
    : 0;
};

interface TaskAwareDraftPolicy {
  policy_name: TaskPolicyName;
  priority_by_section_type: Partial<Record<PromptSectionDraftType, number>>;
  should_keep: (draft: PromptSectionDraft) => boolean;
  score_draft: (draft: PromptSectionDraft) => {
    ranking_score: number;
    score_components: Record<string, number>;
    score_reasons: string[];
  };
}

const hasAnySectionType = (drafts: PromptSectionDraft[], sectionTypes: PromptSectionDraftType[]): boolean => {
  return drafts.some(draft => sectionTypes.includes(draft.section_type));
};

const buildDraftScore = (input: {
  draft: PromptSectionDraft;
  policy_name: TaskPolicyName;
  priority_by_section_type: Partial<Record<PromptSectionDraftType, number>>;
  has_context_snapshot: boolean;
  has_memory_sections: boolean;
}): {
  ranking_score: number;
  score_components: Record<string, number>;
  score_reasons: string[];
} => {
  const base_priority = input.priority_by_section_type[input.draft.section_type] ?? 0;
  const source_node_boost = Math.min(input.draft.source_node_ids.length, 3) * 20;
  const content_block_boost = Math.min(input.draft.content_blocks.length, 3) * 5;
  const metadataBonus = (() => {
    const fragmentMetadata = input.draft.content_blocks
      .map(block => block.metadata)
      .filter((value): value is Record<string, unknown> => isRecord(value));
    return fragmentMetadata.some(metadata => typeof metadata.source === 'string' && metadata.source.includes('memory.summary')) ? 15 : 0;
  })();

  let policy_bonus = 0;
  let fallback_bonus = 0;
  let noise_penalty = 0;
  const score_reasons: string[] = [`policy:${input.policy_name}`, `section:${input.draft.section_type}`];

  if (input.policy_name === 'evidence_first') {
    if (
      input.draft.section_type === 'recent_evidence' ||
      input.draft.section_type === 'memory_summary' ||
      input.draft.section_type === 'memory_short_term'
    ) {
      policy_bonus += 60;
      score_reasons.push('evidence_emphasis');
    }
    if (input.draft.section_type === 'context_snapshot' && !input.has_memory_sections) {
      fallback_bonus += 35;
      score_reasons.push('snapshot_fallback');
    }
    if (input.draft.section_type === 'world_context' || input.draft.section_type === 'role_context') {
      noise_penalty -= 45;
      score_reasons.push('context_noise_penalty');
    }
  }

  if (input.policy_name === 'memory_focused') {
    if (
      input.draft.section_type === 'memory_long_term' ||
      input.draft.section_type === 'memory_summary' ||
      input.draft.section_type === 'memory_short_term'
    ) {
      policy_bonus += 70;
      score_reasons.push('memory_emphasis');
    }
    if (input.draft.section_type === 'recent_evidence') {
      policy_bonus += 20;
      score_reasons.push('supporting_evidence');
    }
    if (input.draft.section_type === 'context_snapshot' && !input.has_context_snapshot) {
      fallback_bonus += 25;
      score_reasons.push('snapshot_fallback');
    }
    if (input.draft.section_type === 'world_context' || input.draft.section_type === 'role_context') {
      noise_penalty -= 55;
      score_reasons.push('non_memory_noise_penalty');
    }
  }

  const ranking_score = base_priority + source_node_boost + content_block_boost + metadataBonus + policy_bonus + fallback_bonus + noise_penalty;

  return {
    ranking_score,
    score_components: {
      base_priority,
      source_node_boost,
      content_block_boost,
      metadata_bonus: metadataBonus,
      policy_bonus,
      fallback_bonus,
      noise_penalty
    },
    score_reasons
  };
};

const resolveTaskAwareDraftPolicy = (input: {
  drafts: PromptSectionDraft[];
  task_type: PromptWorkflowTaskType;
  section_policy: PromptWorkflowSectionPolicy;
  include_sections?: string[];
}): TaskAwareDraftPolicy => {
  const minimal = input.section_policy === 'minimal';
  const includeOnly = input.section_policy === 'include_only' && (input.include_sections?.length ?? 0) > 0;
  const includeSet = includeOnly ? new Set<string>(input.include_sections!) : null;
  const hasContextSnapshot = hasAnySectionType(input.drafts, ['context_snapshot']);
  const hasMemorySections = hasAnySectionType(input.drafts, ['memory_summary', 'memory_short_term', 'memory_long_term']);

  switch (input.task_type) {
    case 'context_summary':
      return {
        policy_name: 'evidence_first',
        priority_by_section_type: {
          recent_evidence: 1000,
          memory_summary: 950,
          memory_short_term: 900,
          memory_long_term: 850,
          context_snapshot: minimal ? 700 : 760,
          system_instruction: 320,
          role_context: 180,
          world_context: 140,
          output_contract: 80
        },
        should_keep: draft => {
          if (includeOnly) {
            return PROTECTED_SECTION_TYPES.has(draft.section_type) || (includeSet?.has(draft.section_type) ?? false);
          }

          if (!minimal) {
            return true;
          }

          if (draft.section_type === 'output_contract') {
            return false;
          }

          if ((draft.section_type === 'role_context' || draft.section_type === 'world_context') && (hasContextSnapshot || hasMemorySections)) {
            return false;
          }

          return true;
        }
        , score_draft: draft => buildDraftScore({ draft,
          policy_name: 'evidence_first',
          priority_by_section_type: {
            recent_evidence: 1000,
            memory_summary: 950,
            memory_short_term: 900,
            memory_long_term: 850,
            context_snapshot: minimal ? 700 : 760,
            system_instruction: 320,
            role_context: 180,
            world_context: 140,
            output_contract: 80
          },
          has_context_snapshot: hasContextSnapshot,
          has_memory_sections: hasMemorySections
        })
      };
    case 'memory_compaction':
      return {
        policy_name: 'memory_focused',
        priority_by_section_type: {
          memory_long_term: 1000,
          memory_summary: 950,
          memory_short_term: 900,
          recent_evidence: 720,
          context_snapshot: minimal ? 260 : 640,
          system_instruction: 220,
          role_context: 120,
          world_context: 80,
          output_contract: 60
        },
        should_keep: draft => {
          if (includeOnly) {
            return PROTECTED_SECTION_TYPES.has(draft.section_type) || (includeSet?.has(draft.section_type) ?? false);
          }

          if (!minimal) {
            return true;
          }

          if (draft.section_type === 'output_contract' || draft.section_type === 'role_context' || draft.section_type === 'world_context') {
            return false;
          }

          if (draft.section_type === 'context_snapshot' && hasMemorySections) {
            return false;
          }

          return true;
        }
        , score_draft: draft => buildDraftScore({ draft,
          policy_name: 'memory_focused',
          priority_by_section_type: {
            memory_long_term: 1000,
            memory_summary: 950,
            memory_short_term: 900,
            recent_evidence: 720,
            context_snapshot: minimal ? 260 : 640,
            system_instruction: 220,
            role_context: 120,
            world_context: 80,
            output_contract: 60
          },
          has_context_snapshot: hasContextSnapshot,
          has_memory_sections: hasMemorySections
        })
      };
    default:
      return {
        policy_name: 'standard',
        priority_by_section_type: {
          system_instruction: 1000,
          role_context: 950,
          world_context: 900,
          memory_summary: 850,
          memory_short_term: 800,
          memory_long_term: 750,
          recent_evidence: 700,
          output_contract: 650,
          context_snapshot: minimal ? 400 : 600
        },
        should_keep: draft => {
          if (includeOnly) {
            return PROTECTED_SECTION_TYPES.has(draft.section_type) || (includeSet?.has(draft.section_type) ?? false);
          }

          return true;
        },
        score_draft: draft => buildDraftScore({
          draft,
          policy_name: 'standard',
          priority_by_section_type: {
            system_instruction: 1000,
            role_context: 950,
            world_context: 900,
            memory_summary: 850,
            memory_short_term: 800,
            memory_long_term: 750,
            recent_evidence: 700,
            output_contract: 650,
            context_snapshot: minimal ? 400 : 600
          },
          has_context_snapshot: hasContextSnapshot,
          has_memory_sections: hasMemorySections
        })
      };
  }
};

const buildTaskAwareDraftOrder = (input: {
  drafts: PromptSectionDraft[];
  task_type: PromptWorkflowTaskType;
  section_policy: PromptWorkflowSectionPolicy;
  include_sections?: string[];
}): PromptSectionDraft[] => {
  const taskPolicy = resolveTaskAwareDraftPolicy(input);
  const originalIndexById = new Map(input.drafts.map((draft, index) => [draft.id, index]));

  return [...input.drafts]
    .filter(draft => taskPolicy.should_keep(draft))
    .map(draft => {
      const score = taskPolicy.score_draft(draft);
      return {
        ...draft,
        metadata: {
          ...(draft.metadata ?? {}),
          task_policy: {
            task_type: input.task_type,
            section_policy: input.section_policy,
            policy_name: taskPolicy.policy_name,
            priority: taskPolicy.priority_by_section_type[draft.section_type] ?? 0,
            ranking_score: score.ranking_score,
            score_components: score.score_components,
            score_reasons: score.score_reasons
          }
        }
      };
    })
    .sort((left, right) => {
      const leftTaskPolicy = isRecord(left.metadata?.task_policy) ? left.metadata.task_policy : null;
      const rightTaskPolicy = isRecord(right.metadata?.task_policy) ? right.metadata.task_policy : null;
      const leftPriority = typeof leftTaskPolicy?.ranking_score === 'number' ? leftTaskPolicy.ranking_score : taskPolicy.priority_by_section_type[left.section_type] ?? 0;
      const rightPriority = typeof rightTaskPolicy?.ranking_score === 'number' ? rightTaskPolicy.ranking_score : taskPolicy.priority_by_section_type[right.section_type] ?? 0;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }

      return (originalIndexById.get(left.id) ?? 0) - (originalIndexById.get(right.id) ?? 0);
    });
};

export const buildSectionDraftsFromFragments = (
  fragments: PromptFragment[],
  options: {
    task_type?: PromptWorkflowTaskType;
    section_policy?: PromptWorkflowSectionPolicy;
    include_sections?: string[];
  } = {}
): PromptSectionDraft[] => {
  const drafts: PromptSectionDraft[] = fragments.map(fragment => ({
    id: randomUUID(),
    section_type: toSectionType(fragment),
    title: null,
    slot: fragment.slot,
    source_node_ids: resolveSourceNodeIds(fragment),
    content_blocks: [
      {
        kind: 'text' as const,
        text: fragment.content,
        metadata: {
          fragment_id: fragment.id,
          source: fragment.source
        }
      }
    ],
    placement: {
      anchor: fragment.anchor ?? null,
      placement_mode: fragment.placement_mode ?? null,
      depth: fragment.depth ?? null,
      order: fragment.order ?? null
    },
    metadata: {
      original_fragment: toOriginalFragmentMetadata(fragment)
    }
  }));

  return buildTaskAwareDraftOrder({
    drafts,
    task_type: options.task_type ?? 'agent_decision',
    section_policy: options.section_policy ?? 'standard',
    include_sections: options.include_sections
  });
};

export const buildFragmentsFromSectionDrafts = (drafts: PromptSectionDraft[]): PromptFragment[] => {
  return drafts.flatMap(draft => {
    const original = toOriginalFragmentMetadataRecord(draft.metadata?.original_fragment);
    if (!original) {
      return [];
    }

    const content = draft.content_blocks
      .map(block => {
        if (block.kind === 'text') {
          return block.text;
        }
        return JSON.stringify(block.json, null, 2);
      })
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n');

    return [{
      id: original.id,
      slot: original.slot,
      priority: original.priority,
      content,
      source: original.source,
      removable: original.removable,
      replaceable: original.replaceable,
      anchor: draft.placement?.anchor ?? null,
      placement_mode: draft.placement?.placement_mode ?? null,
      depth: draft.placement?.depth ?? null,
      order: draft.placement?.order ?? null,
      metadata: original.metadata ?? undefined
    } satisfies PromptFragment];
  });
};

export const buildSectionSummary = (drafts: PromptSectionDraft[]): Record<string, unknown> => {
  return {
    total_sections: drafts.length,
    sections_by_slot: drafts.reduce<Record<string, number>>((acc, draft) => {
      acc[draft.slot] = (acc[draft.slot] ?? 0) + 1;
      return acc;
    }, {}),
    sections_by_type: drafts.reduce<Record<string, number>>((acc, draft) => {
      acc[draft.section_type] = (acc[draft.section_type] ?? 0) + 1;
      return acc;
    }, {}),
    section_policies: Array.from(
      new Set(
        drafts
          .map(draft => (isRecord(draft.metadata?.task_policy) ? draft.metadata.task_policy.policy_name : null))
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    ),
    section_types: Array.from(new Set(drafts.map(draft => draft.section_type))),
    section_scores: drafts.map(draft => ({
      id: draft.id,
      slot: draft.slot,
      section_type: draft.section_type,
      policy_name: isRecord(draft.metadata?.task_policy) ? draft.metadata.task_policy.policy_name ?? null : null,
      ranking_score: isRecord(draft.metadata?.task_policy) ? draft.metadata.task_policy.ranking_score ?? null : null,
      score_components: isRecord(draft.metadata?.task_policy) && isRecord(draft.metadata.task_policy.score_components)
        ? draft.metadata.task_policy.score_components
        : null,
      score_reasons: isRecord(draft.metadata?.task_policy) && Array.isArray(draft.metadata.task_policy.score_reasons) ? draft.metadata.task_policy.score_reasons : []
    })),
    section_order: drafts.map(draft => ({
      id: draft.id,
      slot: draft.slot,
      section_type: draft.section_type,
      source_node_ids: draft.source_node_ids,
      source_fragments: draft.content_blocks
        .map(block => block.metadata)
        .filter((value): value is Record<string, unknown> => isRecord(value))
        .map(metadata => ({
          fragment_id: typeof metadata.fragment_id === 'string' ? metadata.fragment_id : null,
          source: typeof metadata.source === 'string' ? metadata.source : null
        }))
    }))
  };
};

export const buildSectionBudgetSummary = (input: {
  drafts: PromptSectionDraft[];
  total_budget: number;
  mode?: 'fragment_only' | 'section_level';
}): PromptWorkflowSectionBudgetSummary => {
  const totalScore = input.drafts.reduce((sum, draft) => sum + Math.max(getTaskPolicyRankingScore(draft), 0), 0);
  const allocations = input.drafts.map(draft => {
    const rankingScore = Math.max(getTaskPolicyRankingScore(draft), 0);
    const budgetShare = totalScore > 0 ? rankingScore / totalScore : 0;
    return {
      section_id: draft.id,
      section_type: draft.section_type,
      slot: draft.slot,
      budget_share: budgetShare,
      budget_tokens: Math.round(input.total_budget * budgetShare),
      ranking_score: rankingScore,
      kept: true
    };
  });

  return {
    mode: input.mode ?? 'section_level',
    total_budget: input.total_budget,
    allocated_budget: allocations.reduce((sum, allocation) => sum + allocation.budget_tokens, 0),
    allocations,
    kept_section_ids: allocations.map(allocation => allocation.section_id),
    dropped_section_ids: []
  };
};
