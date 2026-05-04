/**
 * ConversationAssembler — assembles PromptBundleV2 + AgentConversationMemory into AiMessage[].
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.7
 */

import type { AiMessage, AiResolvedTaskConfig } from '../ai/types.js';
import type { PromptBlock } from '../inference/prompt_block.js';
import type { PromptBundleV2 } from '../inference/prompt_bundle_v2.js';
import type { PromptFragmentV2 } from '../inference/prompt_fragment_v2.js';
import type { ConversationFormatConfig } from './format_config.js';
import type { AgentConversationMemory } from './types.js';

// ── Helpers ────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type SlotRole = 'system' | 'developer' | 'user';

interface SlotEntry {
  id: string;
  priority: number;
  heading: string | null;
  text: string;
}

interface ConversationFragmentEntry {
  text: string;
  entryRole: string;
  turnNumber: number;
  fragmentId: string;
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

const buildJoinText = (entries: SlotEntry[]): string =>
  entries
    .map((entry) => {
      if (entry.heading) {
        return `## ${entry.heading}\n${entry.text}`;
      }
      return entry.text;
    })
    .filter((t) => t.trim().length > 0)
    .join('\n\n');

const buildExamplesBlock = (examples: Array<Record<string, unknown>> | undefined): string => {
  if (!examples || examples.length === 0) {
    return '';
  }
  return `## Few-shot Examples\n${examples
    .map((ex, i) => `### Example ${String(i + 1)}\n${JSON.stringify(ex, null, 2)}`)
    .join('\n\n')}`;
};

const sortByPriority = (entries: SlotEntry[]): SlotEntry[] =>
  [...entries].sort((a, b) => b.priority - a.priority);

// ── Fragment Text Extraction ───────────────────────────────

function collectBlockText(block: PromptBlock): string {
  if (block.rendered != null) {
    return block.rendered;
  }
  if (block.kind === 'text' && block.content.kind === 'text') {
    return block.content.text;
  }
  return '';
}

function collectFragmentText(fragment: PromptFragmentV2): string {
  const parts: string[] = [];
  for (const child of fragment.children) {
    if ('slot_id' in child) {
      parts.push(collectFragmentText(child));
    } else {
      parts.push(collectBlockText(child));
    }
  }
  return parts.join('');
}

function extractConversationFragments(
  bundle: PromptBundleV2
): ConversationFragmentEntry[] {
  const fragments = bundle.tree?.fragments_by_slot?.['conversation_history'];
  if (!fragments || fragments.length === 0) {
    return [];
  }

  return fragments
    .filter((f) => !f.permission_denied)
    .map((f) => {
      const metadata = f.metadata ?? {};
      return {
        text: collectFragmentText(f),
        entryRole:
          typeof metadata.entry_role === 'string' ? metadata.entry_role : 'user',
        turnNumber:
          typeof metadata.turn_number === 'number' ? metadata.turn_number : 0,
        fragmentId: f.id
      };
    })
    .sort((a, b) => a.turnNumber - b.turnNumber);
}

// ── Non-Conversation Slot Extraction ───────────────────────

function extractNonConversationSlots(bundle: PromptBundleV2): SlotEntry[] {
  const registry = bundle.tree?.slot_registry;
  if (!registry || !isRecord(registry)) {
    return [];
  }

  const slots: SlotEntry[] = [];
  for (const slotId of Object.keys(registry)) {
    if (slotId === 'conversation_history') {
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection
    const config = registry[slotId];
    if (!isRecord(config)) {
      continue;
    }
    if (config.enabled === false) {
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection
    const text = bundle.slots[slotId];
    if (typeof text !== 'string' || text.trim().length === 0) {
      continue;
    }
    slots.push({
      id: slotId,
      priority:
        typeof config.default_priority === 'number' ? config.default_priority : 0,
      heading:
        config.combined_heading != null && typeof config.combined_heading === 'string'
          ? config.combined_heading
          : null,
      text
    });
  }
  return slots;
}

// ── Assembler ──────────────────────────────────────────────

export interface ConversationAssemblerInput {
  bundle: PromptBundleV2;
  memory?: AgentConversationMemory | null;
  formatConfig: ConversationFormatConfig;
  currentAgentId?: string;
  taskConfig: AiResolvedTaskConfig;
}

export function assembleConversationMessages(input: ConversationAssemblerInput): AiMessage[] {
  const { bundle, formatConfig, taskConfig } = input;
  const slotMapping = formatConfig.message_assembly.slots;
  const roleFormat = formatConfig.message_assembly.role_format;

  // Build slot → target_role lookup
  const slotRoleMap = new Map<string, string>();
  for (const mapping of slotMapping) {
    slotRoleMap.set(mapping.slot, mapping.target_role);
  }

  // 1. Extract non-conversation slots (same as old adapter, excluding conversation_history)
  const standardSlots = extractNonConversationSlots(bundle);

  // Group standard slots by target_role
  const groups: Record<SlotRole, SlotEntry[]> = {
    system: [],
    developer: [],
    user: []
  };

  for (const slot of standardSlots) {
    const targetRole = slotRoleMap.get(slot.id) ?? 'user';
    if (targetRole === 'system' || targetRole === 'developer' || targetRole === 'user') {
      groups[targetRole].push(slot);
    }
  }

  // 2. Extract conversation_history fragments and group by entry_role
  const conversationFragments = extractConversationFragments(bundle);

  const convEntriesByRole: Record<SlotRole, string[]> = {
    system: [],
    developer: [],
    user: []
  };

  for (const cf of conversationFragments) {
    if (cf.text.trim().length === 0) {
      continue;
    }
    const role = cf.entryRole as SlotRole;
    if (convEntriesByRole[role]) {
      convEntriesByRole[role].push(cf.text);
    } else {
      convEntriesByRole.user.push(cf.text);
    }
  }

  // 3. Build message sequence
  const preset = taskConfig.prompt?.preset ?? taskConfig.definition.default_prompt_preset;
  const sourcePromptKeys = Array.isArray(bundle.metadata?.source_prompt_keys)
    ? bundle.metadata.source_prompt_keys
    : [];
  const includeSections = taskConfig.prompt?.include_sections ?? [];
  const examplesBlock = buildExamplesBlock(taskConfig.prompt?.examples);

  const workflowMetadata: Record<string, unknown> = {
    prompt_preset: preset,
    source_prompt_keys: sourcePromptKeys,
    ...(bundle.metadata?.workflow_task_type
      ? { workflow_task_type: bundle.metadata.workflow_task_type }
      : {}),
    ...(bundle.metadata?.workflow_profile_id
      ? { workflow_profile_id: bundle.metadata.workflow_profile_id }
      : {}),
    ...(bundle.metadata?.workflow_profile_version
      ? { workflow_profile_version: bundle.metadata.workflow_profile_version }
      : {}),
    ...(bundle.metadata?.workflow_step_keys
      ? { workflow_step_keys: bundle.metadata.workflow_step_keys }
      : {}),
    ...(bundle.metadata?.workflow_section_summary
      ? { workflow_section_summary: bundle.metadata.workflow_section_summary }
      : {}),
    ...(bundle.metadata?.workflow_placement_summary
      ? { workflow_placement_summary: bundle.metadata.workflow_placement_summary }
      : {}),
    ...(bundle.metadata?.workflow_variable_summary
      ? { workflow_variable_summary: bundle.metadata.workflow_variable_summary }
      : {}),
    ...(bundle.metadata?.workflow_macro_summary
      ? { workflow_macro_summary: bundle.metadata.workflow_macro_summary }
      : {})
  };

  const messages: AiMessage[] = [];

  // -- System message --
  const systemParts: string[] = [];
  systemParts.push(`## Prompt Preset\n${preset}`);
  const systemSlotText = buildJoinText(sortByPriority(groups.system));
  if (systemSlotText.trim().length > 0) {
    systemParts.push(systemSlotText);
  }
  if (convEntriesByRole.system.length > 0) {
    systemParts.push(convEntriesByRole.system.join(formatConfig.transcript.turn_delimiter));
  }
  if (taskConfig.prompt?.system_append) {
    systemParts.push(`## System Append\n${taskConfig.prompt.system_append}`);
  }
  const systemContent = systemParts.join('\n\n');
  const systemPrefix = roleFormat.system.prefix;
  const systemSuffix = roleFormat.system.suffix;
  const systemMsg = buildTextMessage(
    'system',
    systemPrefix + systemContent + systemSuffix,
    { ...workflowMetadata, prompt_preset: preset, source_prompt_keys: sourcePromptKeys }
  );
  if (systemMsg) {
    messages.push(systemMsg);
  }

  // -- Developer message --
  const developerParts: string[] = [];
  const devSlotText = buildJoinText(sortByPriority(groups.developer));
  if (devSlotText.trim().length > 0) {
    developerParts.push(devSlotText);
  }
  if (convEntriesByRole.developer.length > 0) {
    developerParts.push(convEntriesByRole.developer.join(formatConfig.transcript.turn_delimiter));
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
  const devContent = developerParts.join('\n\n');
  const devPrefix = roleFormat.developer.prefix;
  const devSuffix = roleFormat.developer.suffix;
  const devMsg = buildTextMessage(
    'developer',
    devPrefix + devContent + devSuffix,
    { ...workflowMetadata, prompt_preset: preset, include_sections: includeSections }
  );
  if (devMsg) {
    messages.push(devMsg);
  }

  // -- User message --
  const userParts: string[] = [];
  if (taskConfig.prompt?.user_prefix) {
    userParts.push(`## User Prefix\n${taskConfig.prompt.user_prefix}`);
  }
  const userSlotText = buildJoinText(sortByPriority(groups.user));
  if (userSlotText.trim().length > 0) {
    userParts.push(userSlotText);
  }
  if (convEntriesByRole.user.length > 0) {
    userParts.push(convEntriesByRole.user.join(formatConfig.transcript.turn_delimiter));
  }
  const userContent = userParts.join('\n\n');
  const userPrefix = roleFormat.user.prefix;
  const userSuffix = roleFormat.user.suffix;
  const userMsg = buildTextMessage(
    'user',
    userPrefix + userContent + userSuffix,
    {
      ...workflowMetadata,
      prompt_preset: preset,
      combined_prompt_length: bundle.combined_prompt.length
    }
  );
  if (userMsg) {
    messages.push(userMsg);
  }

  // -- AI fill position (only when conversation history is present) --
  const injection = formatConfig.message_assembly.injection;
  const hasConversationContent = conversationFragments.length > 0;
  if (injection.ai_fill_role === 'assistant' && hasConversationContent) {
    const aiMsgIndex = resolveInjectionIndex(messages, injection.ai_fill_position);
    messages.splice(aiMsgIndex, 0, {
      role: 'assistant',
      parts: [{ type: 'text', text: '' }]
    });
  }

  return messages;
}

function resolveInjectionIndex(
  messages: AiMessage[],
  position: string
): number {
  switch (position) {
    case 'after_last_user': {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          return i + 1;
        }
      }
      return messages.length;
    }
    case 'after_last_system': {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'system') {
          return i + 1;
        }
      }
      return messages.length;
    }
    case 'at_end':
    default:
      return messages.length;
  }
}
