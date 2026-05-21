import { randomUUID } from 'crypto';

import { buildOutputContractPrompt } from '../../../inference/output_contract_prompt.js';
import type { PromptSlotConfig, ResolvedSlotPosition } from '../../../inference/prompt_slot_config.js';
import type { InferenceContext } from '../../../inference/types.js';
import { renderNarrativeTemplate } from '../../../template_engine/frontends/narrative/resolver.js';
import type {
  PromptSectionDraft,
  PromptSectionDraftType,
  TrackResult
} from '../types.js';

const SLOT_TO_SECTION_TYPE: Record<string, PromptSectionDraftType> = {
  system_core: 'system_instruction',
  system_policy: 'system_policy',
  role_core: 'role_context',
  world_context: 'world_context',
  output_contract: 'output_contract'
};

const resolveTemplate = (config: PromptSlotConfig, context: InferenceContext): string | null => {
  if (config.default_template) {
    return config.default_template;
  }
  if (config.template_context === 'world_prompts') {
    const key = config.template_key ?? 'global_prefix';
    return context.world_prompts[key] ?? null;
  }
  return null;
};

const buildExtraContext = (context: InferenceContext): Record<string, unknown> => ({
  actor_name: context.actor_display_name,
  actor_role: context.actor_ref.role,
  actor_agent_id: context.resolved_agent_id ?? 'none',
  current_tick: context.tick.toString(),
  strategy: context.strategy,
  identity_id: context.identity?.id ?? '',
  agent_id: context.resolved_agent_id ?? '',
  pack_actor_roles: context.pack_state.actor_roles.join(', ') || 'none',
  owned_artifacts: context.pack_state.owned_artifacts.map((a: { id: string }) => a.id).join(', ') || 'none'
});

export function runTemplateTrack(
  slotRegistry: Record<string, PromptSlotConfig>,
  resolvedPositions: ResolvedSlotPosition[],
  context: InferenceContext
): TrackResult<PromptSectionDraft[]> {
  const drafts: PromptSectionDraft[] = [];
  let totalSlots = 0;
  let templatedSlots = 0;

  const extraContext = buildExtraContext(context);

  for (const resolved of resolvedPositions) {
    const config = slotRegistry[resolved.slot_id];
    if (!config) continue;
    totalSlots++;
    if (!config.enabled) {
      continue;
    }

    const rawTemplate = resolveTemplate(config, context);

    // output_contract without default_template → generate dynamically
    if (config.id === 'output_contract' && !rawTemplate) {
      const outputContract = buildOutputContractPrompt();
      drafts.push({
        id: randomUUID(),
        track: 'template',
        section_type: 'output_contract',
        slot: 'output_contract',
        priority: resolved.resolved_position,
        source_node_ids: [],
        content_blocks: [{ kind: 'text', text: outputContract }],
        removable: false,
        metadata: { display_name: config.display_name }
      });
      templatedSlots++;
      continue;
    }

    // Slots without templates — skip (handled by node/snapshot tracks)
    if (!rawTemplate) {
      continue;
    }

    const expanded = renderNarrativeTemplate({
      template: rawTemplate,
      variableContext: context.variable_context,
      extraContext,
      templateSource: 'prompt_slot_template'
    });

    const sectionType = SLOT_TO_SECTION_TYPE[config.id] ?? 'system_instruction';

    drafts.push({
      id: randomUUID(),
      track: 'template',
      section_type: sectionType,
      slot: config.id,
      priority: config.default_priority,
      source_node_ids: [],
      content_blocks: [{ kind: 'text', text: expanded.text }],
      placement: {
        placement_mode: null,
        order: resolved.resolved_position
      },
      removable: false,
      estimated_tokens: undefined,
      metadata: { display_name: config.display_name }
    });
    templatedSlots++;
  }

  return {
    result: drafts,
    trace: {
      track: 'template',
      input_summary: { slot_count: totalSlots, templated_slots: templatedSlots },
      output_summary: { section_drafts_count: drafts.length },
      decisions: []
    }
  };
}
