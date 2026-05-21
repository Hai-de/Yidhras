import type { PromptBlock } from '../inference/prompt_block.js';
import type { PromptBundleV2 } from '../inference/prompt_bundle_v2.js';
import type { PromptFragmentV2 } from '../inference/prompt_fragment_v2.js';
import type { PromptSlotConfig } from '../inference/prompt_slot_config.js';
import type { PromptTree } from '../inference/prompt_tree.js';
import type { AiMessage } from './types.js';

const roleToSlotId = (role: AiMessage['role']): string => {
  switch (role) {
    case 'system':
      return 'system_core';
    case 'developer':
      return 'role_core';
    case 'assistant':
    case 'tool':
    case 'user':
      return 'output_contract';
  }
};

const roleToPosition = (role: AiMessage['role']): number => {
  switch (role) {
    case 'system':
      return 100;
    case 'developer':
      return 80;
    case 'assistant':
      return 45;
    case 'tool':
      return 42;
    case 'user':
      return 40;
  }
};

const messageToText = (message: AiMessage): string => {
  return message.parts
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text;
        case 'json':
          return JSON.stringify(part.json);
        case 'image_url':
          return `[image_url:${part.url}]`;
        case 'file_ref':
          return `[file_ref:${part.file_id}${part.mime_type ? `:${part.mime_type}` : ''}]`;
      }
    })
    .join('\n');
};

export const buildPromptBundleFromAiMessages = (input: {
  taskId: string;
  taskType: string;
  messages: AiMessage[];
  promptVersion?: string;
  sourcePromptKeys?: string[];
}): PromptBundleV2 => {
  const slotRegistry: Record<string, PromptSlotConfig> = {};
  const fragmentsBySlot: Record<string, PromptFragmentV2[]> = {};
  const combinedParts: string[] = [];

  for (let index = 0; index < input.messages.length; index++) {
    const message = input.messages[index];
    const slotId = roleToSlotId(message.role);
    const position = roleToPosition(message.role) - index / 1000;
    const text = messageToText(message);

    if (!slotRegistry[slotId]) {
      slotRegistry[slotId] = {
        id: slotId,
        display_name: slotId,
        default_priority: Math.floor(position),
        position: Math.floor(position),
        message_role: slotId === 'system_core' ? 'system' : slotId === 'role_core' ? 'developer' : 'user',
        include_in_combined: true,
        combined_heading: null,
        enabled: true
      };
    }

    const block: PromptBlock = {
      id: `${input.taskId}:block:${index}`,
      kind: 'text',
      content: { kind: 'text', text },
      rendered: text,
      metadata: { source: 'explicit_ai_message', role: message.role }
    };

    const fragment: PromptFragmentV2 = {
      id: `${input.taskId}:fragment:${index}`,
      slot_id: slotId,
      priority: position,
      source: 'explicit_ai_message',
      removable: false,
      replaceable: false,
      children: [block],
      anchor: null,
      placement_mode: null,
      depth: null,
      order: index,
      permissions: null,
      metadata: { role: message.role }
    };

    fragmentsBySlot[slotId] = [...(fragmentsBySlot[slotId] ?? []), fragment];
    if (text.trim().length > 0) {
      combinedParts.push(text);
    }
  }

  const resolvedPositions = Object.values(slotRegistry)
    .map((slot) => ({
      slot_id: slot.id,
      resolved_position: slot.position ?? slot.default_priority,
      resolution_source: 'explicit' as const,
      enabled: slot.enabled
    }))
    .sort((left, right) => right.resolved_position - left.resolved_position);

  const tree: PromptTree = {
    inference_id: input.taskId,
    task_type: input.taskType,
    fragments_by_slot: fragmentsBySlot,
    slot_registry: slotRegistry,
    resolved_positions: resolvedPositions,
    metadata: {
      prompt_version: input.promptVersion ?? 'direct-bundle-v1',
      profile_id: null,
      profile_version: null,
      source_prompt_keys: input.sourcePromptKeys ?? ['explicit_ai_messages']
    }
  };

  const slots = Object.fromEntries(
    Object.entries(fragmentsBySlot).map(([slotId, fragments]) => [
      slotId,
      fragments.map((fragment) => fragment.children.map((child) => 'rendered' in child ? child.rendered ?? '' : '').join('')).join('\n\n')
    ])
  );

  return {
    slots,
    slot_order: resolvedPositions.map((position) => position.slot_id),
    combined_prompt: combinedParts.join('\n\n'),
    metadata: {
      prompt_version: tree.metadata.prompt_version,
      source_prompt_keys: tree.metadata.source_prompt_keys,
      workflow_task_type: input.taskType,
      workflow_profile_id: null,
      workflow_profile_version: null,
      workflow_step_keys: []
    },
    tree
  };
};
