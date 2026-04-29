import type { PromptBundleV2 } from '../../inference/prompt_bundle_v2.js';
import type { AiMessage , AiResolvedTaskConfig } from '../types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

type SlotRole = 'system' | 'developer' | 'user';

interface SlotEntry {
  id: string;
  priority: number;
  heading: string | null;
  text: string;
}

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

const buildExamplesBlock = (examples: Array<Record<string, unknown>> | undefined): string => {
  if (!examples || examples.length === 0) {
    return '';
  }
  const serialized = examples
    .map((example, index) => `### Example ${String(index + 1)}\n${JSON.stringify(example, null, 2)}`)
    .join('\n\n');
  return `## Few-shot Examples\n${serialized}`;
};

const buildJoinText = (entries: SlotEntry[]): string => {
  return entries
    .map(entry => {
      if (entry.heading) {
        return `## ${entry.heading}\n${entry.text}`;
      }
      return entry.text;
    })
    .filter(text => text.trim().length > 0)
    .join('\n\n');
};

export const adaptPromptTreeToAiMessages = (
  bundle: PromptBundleV2,
  taskConfig: AiResolvedTaskConfig
): AiMessage[] => {
  const registry = bundle.tree?.slot_registry;
  if (!registry || !isRecord(registry)) {
    return [];
  }

  const slots: SlotEntry[] = [];
  for (const slotId of Object.keys(registry)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    const config = registry[slotId];
    if (!isRecord(config)) {
      continue;
    }
    const enabled = config.enabled !== false;
    if (!enabled) {
      continue;
    }
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    const text = bundle.slots[slotId];
    if (typeof text !== 'string' || text.trim().length === 0) {
      continue;
    }
    slots.push({
      id: slotId,
      priority: typeof config.default_priority === 'number' ? config.default_priority : 0,
      heading: config.combined_heading != null && typeof config.combined_heading === 'string' ? config.combined_heading : null,
      text
    });
  }

  const groups: Record<SlotRole, SlotEntry[]> = {
    system: [],
    developer: [],
    user: []
  };

  for (const slot of slots) {
    const config = registry[slot.id];
    const messageRole = (isRecord(config) && config.message_role && typeof config.message_role === 'string'
      ? (config.message_role as SlotRole)
      : 'user');
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    if (groups[messageRole]) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      groups[messageRole].push(slot);
    }
  }

  const preset = taskConfig.prompt?.preset ?? taskConfig.definition.default_prompt_preset;
  const sourcePromptKeys = Array.isArray(bundle.metadata?.source_prompt_keys) ? bundle.metadata.source_prompt_keys : [];
  const includeSections = taskConfig.prompt?.include_sections ?? [];
  const examplesBlock = buildExamplesBlock(taskConfig.prompt?.examples);

  const workflowMetadata: Record<string, unknown> = {
    prompt_preset: preset,
    source_prompt_keys: sourcePromptKeys,
    ...(bundle.metadata?.workflow_task_type ? { workflow_task_type: bundle.metadata.workflow_task_type } : {}),
    ...(bundle.metadata?.workflow_profile_id ? { workflow_profile_id: bundle.metadata.workflow_profile_id } : {}),
    ...(bundle.metadata?.workflow_profile_version ? { workflow_profile_version: bundle.metadata.workflow_profile_version } : {}),
    ...(bundle.metadata?.workflow_step_keys ? { workflow_step_keys: bundle.metadata.workflow_step_keys } : {}),
    ...(bundle.metadata?.workflow_section_summary ? { workflow_section_summary: bundle.metadata.workflow_section_summary } : {}),
    ...(bundle.metadata?.workflow_placement_summary ? { workflow_placement_summary: bundle.metadata.workflow_placement_summary } : {}),
    ...(bundle.metadata?.workflow_variable_summary ? { workflow_variable_summary: bundle.metadata.workflow_variable_summary } : {}),
    ...(bundle.metadata?.workflow_macro_summary ? { workflow_macro_summary: bundle.metadata.workflow_macro_summary } : {})
  };

  const sortByPriority = (entries: SlotEntry[]): SlotEntry[] => {
    return [...entries].sort((a, b) => b.priority - a.priority);
  };

  const messages: AiMessage[] = [];

  // System message: preset + slots + system_append
  const systemParts: string[] = [];
  systemParts.push(`## Prompt Preset\n${preset}`);
  const systemSlotText = buildJoinText(sortByPriority(groups.system));
  if (systemSlotText.trim().length > 0) {
    systemParts.push(systemSlotText);
  }
  if (taskConfig.prompt?.system_append) {
    systemParts.push(`## System Append\n${taskConfig.prompt.system_append}`);
  }
  const systemMsg = buildTextMessage('system', systemParts.join('\n\n'), {
    ...workflowMetadata,
    prompt_preset: preset,
    source_prompt_keys: sourcePromptKeys
  });
  if (systemMsg) {
    messages.push(systemMsg);
  }

  // Developer message: slots + developer_append + examples
  const developerParts: string[] = [];
  const devSlotText = buildJoinText(sortByPriority(groups.developer));
  if (devSlotText.trim().length > 0) {
    developerParts.push(devSlotText);
  }
  if (includeSections.length > 0) {
    developerParts.push(`## Included Context Sections Hint\n${includeSections.join(', ')}`);
  }
  if (taskConfig.prompt?.developer_append) {
    developerParts.push(`## Developer Append\n${taskConfig.prompt.developer_append}`);
  }
  if (examplesBlock.length > 0) {
    developerParts.push(examplesBlock);
  }
  const devMsg = buildTextMessage('developer', developerParts.join('\n\n'), {
    ...workflowMetadata,
    prompt_preset: preset,
    include_sections: includeSections
  });
  if (devMsg) {
    messages.push(devMsg);
  }

  // User message: user_prefix + slots
  const userParts: string[] = [];
  if (taskConfig.prompt?.user_prefix) {
    userParts.push(`## User Prefix\n${taskConfig.prompt.user_prefix}`);
  }
  const userSlotText = buildJoinText(sortByPriority(groups.user));
  if (userSlotText.trim().length > 0) {
    userParts.push(userSlotText);
  }
  const userMsg = buildTextMessage('user', userParts.join('\n\n'), {
    ...workflowMetadata,
    prompt_preset: preset,
    combined_prompt_length: bundle.combined_prompt.length
  });
  if (userMsg) {
    messages.push(userMsg);
  }

  return messages;
};
