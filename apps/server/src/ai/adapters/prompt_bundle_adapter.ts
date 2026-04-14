import type { PromptBundle, PromptWorkflowSnapshot } from '../../inference/types.js';
import type { AiMessage, AiResolvedTaskConfig } from '../types.js';

type PromptBundleLike = Pick<
  PromptBundle,
  'system_prompt' | 'role_prompt' | 'world_prompt' | 'context_prompt' | 'output_contract_prompt' | 'combined_prompt'
> & {
  metadata?: PromptBundle['metadata'] | Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const toPlacementSummary = (value: unknown): PromptWorkflowSnapshot['placement_summary'] => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    total_fragments: typeof value.total_fragments === 'number' ? value.total_fragments : 0,
    resolved_with_anchor: typeof value.resolved_with_anchor === 'number' ? value.resolved_with_anchor : 0,
    fallback_count: typeof value.fallback_count === 'number' ? value.fallback_count : 0
  };
};

const toWorkflowSnapshot = (value: unknown): PromptWorkflowSnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    task_type: typeof value.task_type === 'string' ? value.task_type : null,
    profile_id: typeof value.profile_id === 'string' ? value.profile_id : null,
    profile_version: typeof value.profile_version === 'string' ? value.profile_version : null,
    selected_step_keys: toStringArray(value.selected_step_keys),
    step_traces: Array.isArray(value.step_traces) ? (value.step_traces as PromptWorkflowSnapshot['step_traces']) : [],
    compatibility: isRecord(value.compatibility) ? value.compatibility : null,
    placement_summary: toPlacementSummary(value.placement_summary),
    section_summary: isRecord(value.section_summary) ? value.section_summary : null
  };
};

const buildTextMessage = (
  role: AiMessage['role'],
  text: string,
  metadata?: Record<string, unknown>
): AiMessage | null => {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return null;
  }

  return {
    role,
    parts: [{ type: 'text', text: normalized }],
    metadata
  };
};

const joinSections = (sections: Array<{ title: string; content?: string | null }>): string => {
  return sections
    .map(section => ({
      title: section.title,
      content: typeof section.content === 'string' ? section.content.trim() : ''
    }))
    .filter(section => section.content.length > 0)
    .map(section => `## ${section.title}\n${section.content}`)
    .join('\n\n');
};

const buildExamplesBlock = (examples: Array<Record<string, unknown>> | undefined): string => {
  if (!examples || examples.length === 0) {
    return '';
  }

  const serialized = examples
    .map((example, index) => `### Example ${String(index + 1)}\n${JSON.stringify(example, null, 2)}`)
    .join('\n\n');

  return `## Few-shot Examples\n${serialized}`;
};

const getWorkflowMetadata = (promptBundle: PromptBundleLike): Record<string, unknown> => {
  const workflowStepKeys = toStringArray(promptBundle.metadata?.workflow_step_keys);
  const processingTrace =
    isRecord(promptBundle.metadata) && 'processing_trace' in promptBundle.metadata
      ? promptBundle.metadata.processing_trace ?? null
      : null;
  const promptWorkflow = isRecord(processingTrace) ? toWorkflowSnapshot(processingTrace.prompt_workflow) : null;

  return {
    workflow_task_type:
      typeof promptBundle.metadata?.workflow_task_type === 'string' ? promptBundle.metadata.workflow_task_type : null,
    workflow_profile_id:
      typeof promptBundle.metadata?.workflow_profile_id === 'string' ? promptBundle.metadata.workflow_profile_id : null,
    workflow_profile_version:
      typeof promptBundle.metadata?.workflow_profile_version === 'string' ? promptBundle.metadata.workflow_profile_version : null,
    workflow_step_keys: workflowStepKeys.length > 0 ? workflowStepKeys : promptWorkflow?.selected_step_keys ?? [],
    workflow_section_summary: promptWorkflow?.section_summary ?? null,
    workflow_placement_summary: promptWorkflow?.placement_summary ?? null
  };
};

export interface PromptBundleAdapterInput {
  promptBundle: PromptBundleLike;
  taskConfig: AiResolvedTaskConfig;
}

export const adaptPromptBundleToAiMessages = (input: PromptBundleAdapterInput): AiMessage[] => {
  const { promptBundle, taskConfig } = input;
  const preset = taskConfig.prompt.preset ?? taskConfig.definition.default_prompt_preset;
  const sourcePromptKeys = Array.isArray(promptBundle.metadata?.source_prompt_keys) ? promptBundle.metadata.source_prompt_keys : [];
  const includeSections = taskConfig.prompt.include_sections ?? [];
  const examplesBlock = buildExamplesBlock(taskConfig.prompt.examples);
  const workflowMetadata = getWorkflowMetadata(promptBundle);

  const systemMessage = buildTextMessage(
    'system',
    joinSections([
      { title: 'Prompt Preset', content: preset },
      { title: 'System Prompt', content: promptBundle.system_prompt },
      { title: 'World Prompt', content: promptBundle.world_prompt },
      { title: 'System Append', content: taskConfig.prompt.system_append }
    ]),
    {
      prompt_preset: preset,
      source_prompt_keys: sourcePromptKeys,
      ...workflowMetadata
    }
  );

  const developerMessage = buildTextMessage(
    'developer',
    joinSections([
      { title: 'Role Prompt', content: promptBundle.role_prompt },
      {
        title: 'Included Context Sections Hint',
        content: includeSections.length > 0 ? includeSections.join(', ') : ''
      },
      { title: 'Developer Append', content: taskConfig.prompt.developer_append },
      { title: 'Examples', content: examplesBlock }
    ]),
    {
      prompt_preset: preset,
      include_sections: includeSections,
      ...workflowMetadata
    }
  );

  const userMessage = buildTextMessage(
    'user',
    joinSections([
      { title: 'User Prefix', content: taskConfig.prompt.user_prefix },
      { title: 'Context Prompt', content: promptBundle.context_prompt },
      { title: 'Output Contract Prompt', content: promptBundle.output_contract_prompt }
    ]),
    {
      prompt_preset: preset,
      combined_prompt_length: promptBundle.combined_prompt.length,
      ...workflowMetadata
    }
  );

  return [systemMessage, developerMessage, userMessage].filter((message): message is AiMessage => message !== null);
};
