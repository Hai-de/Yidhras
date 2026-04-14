import type { InferenceStrategy } from '../../inference/types.js';
import type {
  PromptWorkflowProfile,
  PromptWorkflowSelectionInput,
  PromptWorkflowTaskType
} from './types.js';

const DEFAULT_AGENT_DECISION_PROFILE: PromptWorkflowProfile = {
  id: 'agent-decision-default',
  version: '1',
  description: '默认 agent decision prompt workflow，兼容现有 Orchestrator Lite 并为后续正式化阶段预留显式 step 边界。',
  applies_to: {
    task_types: ['agent_decision'],
    strategies: ['mock', 'rule_based', 'model_routed']
  },
  defaults: {
    token_budget: 2200,
    section_policy: 'standard',
    compatibility_mode: 'full'
  },
  steps: [
    {
      key: 'legacy_memory_projection',
      kind: 'legacy_memory_projection',
      produces: ['compatibility.legacy_memory_context']
    },
    {
      key: 'node_working_set_filter',
      kind: 'node_working_set_filter',
      requires: ['selected_nodes'],
      produces: ['working_set']
    },
    {
      key: 'summary_compaction',
      kind: 'summary_compaction',
      requires: ['working_set', 'fragments'],
      produces: ['fragments']
    },
    {
      key: 'token_budget_trim',
      kind: 'token_budget_trim',
      requires: ['fragments'],
      produces: ['fragments']
    },
    {
      key: 'placement_resolution',
      kind: 'placement_resolution',
      requires: ['fragments'],
      produces: ['fragments', 'diagnostics.placement_summary']
    },
    {
      key: 'bundle_finalize',
      kind: 'bundle_finalize',
      requires: ['fragments'],
      produces: ['prompt_bundle']
    }
  ]
};

const DEFAULT_CONTEXT_SUMMARY_PROFILE: PromptWorkflowProfile = {
  id: 'context-summary-default',
  version: '1',
  description: '为 context summary 任务保留的默认 profile，目前先提供稳定 selector 落点。',
  applies_to: {
    task_types: ['context_summary']
  },
  defaults: {
    token_budget: 1600,
    section_policy: 'minimal',
    compatibility_mode: 'bridge_only'
  },
  steps: [
    {
      key: 'legacy_memory_projection',
      kind: 'legacy_memory_projection'
    },
    {
      key: 'node_working_set_filter',
      kind: 'node_working_set_filter'
    },
    {
      key: 'summary_compaction',
      kind: 'summary_compaction'
    },
    {
      key: 'fragment_assembly',
      kind: 'fragment_assembly'
    },
    {
      key: 'token_budget_trim',
      kind: 'token_budget_trim'
    },
    {
      key: 'bundle_finalize',
      kind: 'bundle_finalize'
    }
  ]
};

const DEFAULT_MEMORY_COMPACTION_PROFILE: PromptWorkflowProfile = {
  id: 'memory-compaction-default',
  version: '1',
  description: '为 memory compaction 任务保留的默认 profile，目前先提供稳定 selector 落点。',
  applies_to: {
    task_types: ['memory_compaction']
  },
  defaults: {
    token_budget: 1800,
    section_policy: 'minimal',
    compatibility_mode: 'bridge_only'
  },
  steps: [
    {
      key: 'legacy_memory_projection',
      kind: 'legacy_memory_projection'
    },
    {
      key: 'node_working_set_filter',
      kind: 'node_working_set_filter'
    },
    {
      key: 'node_grouping',
      kind: 'node_grouping'
    },
    {
      key: 'summary_compaction',
      kind: 'summary_compaction'
    },
    {
      key: 'fragment_assembly',
      kind: 'fragment_assembly'
    },
    {
      key: 'token_budget_trim',
      kind: 'token_budget_trim'
    },
    {
      key: 'bundle_finalize',
      kind: 'bundle_finalize'
    }
  ]
};

const BUILTIN_WORKFLOW_PROFILES: PromptWorkflowProfile[] = [
  DEFAULT_AGENT_DECISION_PROFILE,
  DEFAULT_CONTEXT_SUMMARY_PROFILE,
  DEFAULT_MEMORY_COMPACTION_PROFILE
];

const matchesTaskType = (profile: PromptWorkflowProfile, taskType: PromptWorkflowTaskType): boolean => {
  const taskTypes = profile.applies_to.task_types;
  return !taskTypes || taskTypes.length === 0 || taskTypes.includes(taskType);
};

const matchesStrategy = (profile: PromptWorkflowProfile, strategy: InferenceStrategy): boolean => {
  const strategies = profile.applies_to.strategies;
  return !strategies || strategies.length === 0 || strategies.includes(strategy);
};

const matchesPackId = (profile: PromptWorkflowProfile, packId: string): boolean => {
  const packIds = profile.applies_to.pack_ids;
  return !packIds || packIds.length === 0 || packIds.includes(packId);
};

const calculateSpecificity = (profile: PromptWorkflowProfile): number => {
  let score = 0;
  if (profile.applies_to.task_types?.length) {
    score += 4;
  }
  if (profile.applies_to.strategies?.length) {
    score += 2;
  }
  if (profile.applies_to.pack_ids?.length) {
    score += 1;
  }
  return score;
};

export const listBuiltInPromptWorkflowProfiles = (): PromptWorkflowProfile[] => {
  return BUILTIN_WORKFLOW_PROFILES.map(profile => ({
    ...profile,
    applies_to: {
      task_types: profile.applies_to.task_types ? [...profile.applies_to.task_types] : undefined,
      strategies: profile.applies_to.strategies ? [...profile.applies_to.strategies] : undefined,
      pack_ids: profile.applies_to.pack_ids ? [...profile.applies_to.pack_ids] : undefined
    },
    defaults: profile.defaults ? { ...profile.defaults } : undefined,
    steps: profile.steps.map(step => ({
      ...step,
      config: step.config ? { ...step.config } : undefined,
      requires: step.requires ? [...step.requires] : undefined,
      produces: step.produces ? [...step.produces] : undefined
    }))
  }));
};

export const getBuiltInPromptWorkflowProfile = (profileId: string): PromptWorkflowProfile | null => {
  return listBuiltInPromptWorkflowProfiles().find(profile => profile.id === profileId) ?? null;
};

export const selectPromptWorkflowProfile = (input: PromptWorkflowSelectionInput): PromptWorkflowProfile => {
  if (input.profile_id) {
    const explicit = getBuiltInPromptWorkflowProfile(input.profile_id);
    if (explicit) {
      return explicit;
    }
  }

  const matching = listBuiltInPromptWorkflowProfiles()
    .filter(profile => matchesTaskType(profile, input.task_type))
    .filter(profile => matchesStrategy(profile, input.strategy))
    .filter(profile => matchesPackId(profile, input.pack_id))
    .sort((left, right) => {
      const specificityDiff = calculateSpecificity(right) - calculateSpecificity(left);
      if (specificityDiff !== 0) {
        return specificityDiff;
      }

      return left.id.localeCompare(right.id);
    });

  return matching[0] ?? listBuiltInPromptWorkflowProfiles()[0] ?? DEFAULT_AGENT_DECISION_PROFILE;
};
