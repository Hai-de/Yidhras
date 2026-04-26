import { randomUUID } from 'node:crypto';

import type { PromptBlock } from './prompt_block.js';
import { buildContextPromptPayload, buildOutputContractPrompt } from './prompt_builder.js';
import type { PromptBundleV2 } from './prompt_bundle_v2.js';
import type { PromptFragmentV2 } from './prompt_fragment_v2.js';
import type { PromptSlotConfig } from './prompt_slot_config.js';
import { type PromptTree,renderSlotText } from './prompt_tree.js';
import type { InferenceContext, PromptBundleMetadata, PromptProcessingTrace, PromptResolvableContext } from './types.js';

type ParsedPromptSlotConfig = PromptSlotConfig;
type PromptContext = InferenceContext | PromptResolvableContext;

const PROMPT_VERSION = 'phase-c-v1';

function buildTextBlock(text: string, meta?: Record<string, unknown>): PromptBlock {
  return {
    id: randomUUID(),
    kind: 'text',
    content: { kind: 'text', text },
    rendered: text,
    metadata: meta
  };
}

function resolveTemplate(config: PromptSlotConfig, context: PromptContext): string | null {
  if (config.default_template) {
    return config.default_template;
  }
  if (config.template_context === 'world_prompts') {
    return context.world_prompts.global_prefix ?? null;
  }
  return null;
}

/**
 * Build V2 fragments for slots whose content is dynamically generated
 * at inference time (not expressible as static YAML templates).
 */
function buildDynamicSlotFragments(
  context: PromptContext,
  slotRegistry: Record<string, ParsedPromptSlotConfig>
): Record<string, PromptFragmentV2[]> {
  const result: Record<string, PromptFragmentV2[]> = {};

  // post_process: JSON snapshot of inference context
  if (slotRegistry['post_process']?.enabled) {
    const payload = buildContextPromptPayload(context);
    const jsonSnapshot = JSON.stringify(payload, null, 2);
    if (jsonSnapshot.trim().length > 0) {
      result['post_process'] = [{
        id: randomUUID(),
        slot_id: 'post_process',
        priority: slotRegistry['post_process']!.default_priority,
        source: 'context.snapshot',
        removable: true,
        replaceable: true,
        children: [buildTextBlock(jsonSnapshot, { source: 'context.snapshot' })],
        anchor: null,
        placement_mode: null,
        depth: null,
        order: null,
        metadata: {}
      }];
    }
  }

  // memory_summary: placeholder (content injected later by memory_injector processor)
  if (slotRegistry['memory_summary']?.enabled) {
    const memorySelectionCount = context.memory_context
      ? context.memory_context.short_term.length + context.memory_context.long_term.length + context.memory_context.summaries.length
      : 0;
    result['memory_summary'] = [{
      id: randomUUID(),
      slot_id: 'memory_summary',
      priority: slotRegistry['memory_summary']!.default_priority,
      source: 'memory.summary',
      removable: true,
      replaceable: true,
      children: [buildTextBlock('', { memory_selection_count: memorySelectionCount })],
      anchor: null,
      placement_mode: null,
      depth: null,
      order: null,
      metadata: { memory_selection_count: memorySelectionCount }
    }];
  }

  // output_contract: use YAML template if defined, otherwise dynamic fallback
  if (slotRegistry['output_contract']?.enabled && !slotRegistry['output_contract']?.default_template) {
    const outputContract = buildOutputContractPrompt();
    if (outputContract.trim().length > 0) {
      result['output_contract'] = [{
        id: randomUUID(),
        slot_id: 'output_contract',
        priority: slotRegistry['output_contract']!.default_priority,
        source: 'output.contract',
        removable: false,
        replaceable: true,
        children: [buildTextBlock(outputContract, { source: 'output.contract' })],
        anchor: null,
        placement_mode: null,
        depth: null,
        order: null,
        metadata: {}
      }];
    }
  }

  return result;
}

/**
 * Build a PromptTree from InferenceContext and PromptSlotRegistry.
 */
export function buildPromptTree(
  context: PromptContext,
  slotRegistry: Record<string, ParsedPromptSlotConfig>
): PromptTree {
  const fragmentsBySlot: Record<string, PromptFragmentV2[]> = {};
  const sourceKeys: string[] = [];

  for (const slotConfig of Object.values(slotRegistry)) {
    if (!slotConfig.enabled) {
      continue;
    }

    const fragments: PromptFragmentV2[] = [];
    const template = resolveTemplate(slotConfig, context);

    if (template && template.trim().length > 0) {
      const block: PromptBlock = {
        id: randomUUID(),
        kind: 'text',
        content: { kind: 'text', text: template },
        rendered: template,
        metadata: {
          source: `slot_config:${slotConfig.id}`,
          template_context: slotConfig.template_context ?? 'inference'
        }
      };

      fragments.push({
        id: randomUUID(),
        slot_id: slotConfig.id,
        priority: slotConfig.default_priority,
        source: `slot_config:${slotConfig.id}`,
        removable: false,
        replaceable: true,
        children: [block],
        anchor: null,
        placement_mode: null,
        depth: null,
        order: null,
        permissions: slotConfig.permissions ?? null,
        metadata: { display_name: slotConfig.display_name }
      });
    }

    fragmentsBySlot[slotConfig.id] = fragments;
    sourceKeys.push(`slot_config:${slotConfig.id}`);
  }

  // Merge dynamically generated slot content (post_process, memory_summary, etc.)
  const dynamicFragments = buildDynamicSlotFragments(context, slotRegistry);
  for (const [slotId, fragments] of Object.entries(dynamicFragments)) {
    if (!fragmentsBySlot[slotId]) {
      fragmentsBySlot[slotId] = [];
    }
    fragmentsBySlot[slotId]!.push(...fragments);
    sourceKeys.push(...fragments.map(f => f.source));
  }

  return {
    inference_id: 'inference_id' in context ? (context as { inference_id: string }).inference_id : '',
    task_type: 'agent_decision',
    fragments_by_slot: fragmentsBySlot,
    slot_registry: slotRegistry,
    metadata: {
      prompt_version: PROMPT_VERSION,
      profile_id: null,
      profile_version: null,
      source_prompt_keys: sourceKeys
    }
  };
}

/**
 * Build PromptBundleV2 from a PromptTree.
 */
export function buildPromptBundleV2(tree: PromptTree, _context: PromptContext): PromptBundleV2 {
  const slots: Record<string, string> = {};
  const combinedParts: string[] = [];

  for (const slotId of Object.keys(tree.slot_registry)) {
    const config = tree.slot_registry[slotId];
    if (!config || !config.enabled) {
      continue;
    }
    const fragments = tree.fragments_by_slot[slotId] ?? [];
    const allDenied = fragments.length > 0 && fragments.every(f => f.permission_denied === true);
    if (allDenied) {
      continue;
    }


    const text = renderSlotText(tree.fragments_by_slot, slotId);
    slots[slotId] = text;
    

    if (config.include_in_combined && text.trim().length > 0) {
      if (config.combined_heading) {
        combinedParts.push(`# ${config.combined_heading}\n${text}`);
      } else {
        combinedParts.push(text);
      }
    }
  }

  const metadata: PromptBundleMetadata = {
    prompt_version: tree.metadata.prompt_version,
    source_prompt_keys: tree.metadata.source_prompt_keys,
    workflow_task_type: tree.metadata.workflow?.workflow_task_type ?? null,
    workflow_profile_id: tree.metadata.workflow?.workflow_profile_id ?? null,
    workflow_profile_version: tree.metadata.workflow?.workflow_profile_version ?? null,
    workflow_step_keys: tree.metadata.workflow?.workflow_step_keys,
    workflow_section_summary: tree.metadata.workflow?.workflow_section_summary,
    workflow_placement_summary: tree.metadata.workflow?.workflow_placement_summary,
    workflow_variable_summary: tree.metadata.workflow?.workflow_variable_summary,
    workflow_macro_summary: tree.metadata.workflow?.workflow_macro_summary,
    processing_trace: tree.metadata.processing_trace as PromptProcessingTrace | undefined
  };

  return {
    slots,
    combined_prompt: combinedParts.join('\n\n'),
    metadata,
    tree
  };
}
