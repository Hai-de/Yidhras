import { randomUUID } from 'node:crypto';

import type { PromptBlock } from './prompt_block.js';
import { buildPromptFragments } from './prompt_builder.js';
import type { PromptBundleV2 } from './prompt_bundle_v2.js';
import type { PromptFragmentV2 } from './prompt_fragment_v2.js';
import type { PromptFragment } from './prompt_fragments.js';
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

function buildOldFragmentAsV2(fragment: PromptFragment): PromptFragmentV2 {
  return {
    id: fragment.id,
    slot_id: fragment.slot,
    priority: fragment.priority,
    source: fragment.source,
    removable: fragment.removable ?? true,
    replaceable: fragment.replaceable ?? true,
    children: [buildTextBlock(fragment.content, { migrated_from: 'legacy_fragment' })],
    anchor: fragment.anchor ?? null,
    placement_mode: fragment.placement_mode ?? null,
    depth: fragment.depth ?? null,
    order: fragment.order ?? null,
    metadata: fragment.metadata
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

  // Compatibility bridge: merge old prompt fragments
  const oldFragments = buildPromptFragments(context);
  for (const oldFragment of oldFragments) {
    const slotId = oldFragment.slot;
    if (!fragmentsBySlot[slotId]) {
      fragmentsBySlot[slotId] = [];
    }
    if (oldFragment.content.trim().length > 0) {
      fragmentsBySlot[slotId]!.push(buildOldFragmentAsV2(oldFragment));
    }
    sourceKeys.push(oldFragment.source);
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
