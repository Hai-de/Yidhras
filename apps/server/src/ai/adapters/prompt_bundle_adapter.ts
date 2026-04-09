import type { PromptBundle } from '../../inference/types.js';
import type { AiMessage, AiResolvedTaskConfig } from '../types.js';

type PromptBundleLike = Pick<
  PromptBundle,
  'system_prompt' | 'role_prompt' | 'world_prompt' | 'context_prompt' | 'output_contract_prompt' | 'combined_prompt'
> & {
  metadata?: PromptBundle['metadata'] | Record<string, unknown>;
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
      source_prompt_keys: sourcePromptKeys
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
      include_sections: includeSections
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
      combined_prompt_length: promptBundle.combined_prompt.length
    }
  );

  return [systemMessage, developerMessage, userMessage].filter((message): message is AiMessage => message !== null);
};
