import { getRuntimeConfig } from '../../config/runtime_config.js';
import type { InferenceStrategy } from '../../inference/types.js';
import type {
  PromptWorkflowProfile,
  PromptWorkflowSelectionInput,
  PromptWorkflowTaskType
} from './types.js';

const buildBuiltInWorkflowProfiles = (): PromptWorkflowProfile[] => {
  const config = getRuntimeConfig();

  return [
    {
      id: 'agent-decision-default',
      version: '1',
      description: '默认 agent decision prompt workflow。汇合后 pipeline：placement → assembly → permission → budget_trim → finalize。',
      applies_to: {
        task_types: ['agent_decision'],
        strategies: ['mock', 'rule_based', 'model_routed']
      },
      defaults: { ...config.prompt_workflow.profiles.agent_decision_default },
      tracks: { template: true, node: true, snapshot: true },
      steps: [
        { key: 'placement', kind: 'placement_resolution' },
        { key: 'assembly', kind: 'fragment_assembly' },
        { key: 'behavior', kind: 'behavior_control' },
        { key: 'transform', kind: 'content_transform' },
        { key: 'permission', kind: 'permission_filter' },
        { key: 'budget_trim', kind: 'token_budget_trim' },
        { key: 'finalize', kind: 'bundle_finalize' }
      ]
    },
    {
      id: 'context-summary-default',
      version: '1',
      description: 'Context summary 任务 profile。汇合后 pipeline。',
      applies_to: {
        task_types: ['context_summary']
      },
      defaults: { ...config.prompt_workflow.profiles.context_summary_default },
      tracks: { template: true, node: true, snapshot: true },
      steps: [
        { key: 'placement', kind: 'placement_resolution' },
        { key: 'assembly', kind: 'fragment_assembly' },
        { key: 'behavior', kind: 'behavior_control' },
        { key: 'transform', kind: 'content_transform' },
        { key: 'permission', kind: 'permission_filter' },
        { key: 'budget_trim', kind: 'token_budget_trim' },
        { key: 'finalize', kind: 'bundle_finalize' }
      ]
    },
    {
      id: 'memory-compaction-default',
      version: '1',
      description: 'Memory compaction 任务 profile。汇合后 pipeline。',
      applies_to: {
        task_types: ['memory_compaction']
      },
      defaults: { ...config.prompt_workflow.profiles.memory_compaction_default },
      tracks: { template: true, node: true, snapshot: true },
      steps: [
        { key: 'placement', kind: 'placement_resolution' },
        { key: 'assembly', kind: 'fragment_assembly' },
        { key: 'behavior', kind: 'behavior_control' },
        { key: 'transform', kind: 'content_transform' },
        { key: 'permission', kind: 'permission_filter' },
        { key: 'budget_trim', kind: 'token_budget_trim' },
        { key: 'finalize', kind: 'bundle_finalize' }
      ]
    },
    {
      id: 'chat-first-turn',
      version: '1',
      description: '多轮对话首轮 profile。完整上下文（全部 4 条轨道）。',
      applies_to: {
        task_types: ['agent_decision']
      },
      defaults: { ...config.prompt_workflow.profiles.agent_decision_default },
      tracks: {
        template: true,
        node: true,
        snapshot: true,
        conversation_history: true
      },
      conversation_profile: 'chat-first-turn',
      steps: [
        { key: 'placement', kind: 'placement_resolution' },
        { key: 'assembly', kind: 'fragment_assembly' },
        { key: 'behavior', kind: 'behavior_control' },
        { key: 'transform', kind: 'content_transform' },
        { key: 'permission', kind: 'permission_filter' },
        { key: 'budget_trim', kind: 'token_budget_trim' },
        { key: 'finalize', kind: 'bundle_finalize' }
      ]
    },
    {
      id: 'chat-follow-up',
      version: '1',
      description: '多轮对话后续轮次 profile。轻量路径（template + conversation_history 轨道）。',
      applies_to: {
        task_types: ['agent_decision']
      },
      defaults: { ...config.prompt_workflow.profiles.agent_decision_default },
      tracks: {
        template: true,
        node: false,
        snapshot: false,
        conversation_history: true
      },
      conversation_profile: 'chat-follow-up',
      steps: [
        { key: 'placement', kind: 'placement_resolution' },
        { key: 'assembly', kind: 'fragment_assembly' },
        { key: 'behavior', kind: 'behavior_control' },
        { key: 'transform', kind: 'content_transform' },
        { key: 'permission', kind: 'permission_filter' },
        { key: 'budget_trim', kind: 'token_budget_trim' },
        { key: 'finalize', kind: 'bundle_finalize' }
      ]
    }
  ];
};

const getBuiltInWorkflowProfiles = (): PromptWorkflowProfile[] => buildBuiltInWorkflowProfiles();

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
  return getBuiltInWorkflowProfiles().map(profile => ({
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

  return matching[0] ?? listBuiltInPromptWorkflowProfiles()[0] ?? getBuiltInWorkflowProfiles()[0];
};
