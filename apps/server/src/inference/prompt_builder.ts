import { randomUUID } from 'node:crypto';

import { buildContextPromptAssemblySummary, runContextOrchestrator } from '../context/workflow/orchestrator.js';
import { NarrativeResolver } from '../narrative/resolver.js';
import type { PromptFragment, PromptFragmentSlot } from './prompt_fragments.js';
import type { InferenceContext, PromptBundle, PromptProcessingTrace } from './types.js';

const PROMPT_VERSION = 'phase-b-v1';

const SLOT_HEADINGS: Record<PromptFragmentSlot, string> = {
  system_core: 'System Prompt',
  system_policy: 'System Policy Prompt',
  role_core: 'Role Prompt',
  world_context: 'World Prompt',
  memory_short_term: 'Short-Term Memory Prompt',
  memory_long_term: 'Long-Term Memory Prompt',
  memory_summary: 'Memory Summary Prompt',
  output_contract: 'Output Contract Prompt',
  post_process: 'Post Process Prompt'
};

const SLOT_ORDER: PromptFragmentSlot[] = [
  'system_core',
  'system_policy',
  'role_core',
  'world_context',
  'memory_short_term',
  'memory_long_term',
  'memory_summary',
  'output_contract',
  'post_process'
];

const buildContextPromptPayload = (context: InferenceContext): Record<string, unknown> => {
  return {
    actor_ref: context.actor_ref,
    actor_display_name: context.actor_display_name,
    context_run: context.context_run,
    binding_ref: context.binding_ref,
    resolved_agent_id: context.resolved_agent_id,
    agent_snapshot: context.agent_snapshot,
    policy_summary: context.policy_summary,
    attributes: context.attributes,
    visible_variables: context.visible_variables,
    memory_context: context.memory_context,
    pack_state: context.pack_state,
    tick: context.tick.toString(),
    world_pack: context.world_pack,
    strategy: context.strategy
  };
};

const buildOutputContractPrompt = (): string => {
  return [
    'Return a normalized decision object.',
    'Use JSON-compatible values only.',
    'Expected keys: action_type, target_ref, payload, confidence, delay_hint_ticks, reasoning, meta.',
    'Represent all tick-like values as integer strings.'
  ].join('\n');
};

const buildFragment = (
  slot: PromptFragmentSlot,
  priority: number,
  content: string,
  source: string,
  metadata?: Record<string, unknown>
): PromptFragment => {
  return {
    id: randomUUID(),
    slot,
    priority,
    content,
    source,
    removable: true,
    replaceable: true,
    metadata
  };
};

const slotOrderMap = new Map(SLOT_ORDER.map((slot, index) => [slot, index]));

const getAnchorKey = (fragment: PromptFragment): string => {
  if (!fragment.anchor || typeof fragment.anchor !== 'object') {
    return '';
  }

  return `${fragment.anchor.kind}:${fragment.anchor.value}`;
};

const getDepth = (fragment: PromptFragment): number => {
  return typeof fragment.depth === 'number' && Number.isFinite(fragment.depth) ? fragment.depth : 0;
};

const getOrder = (fragment: PromptFragment): number => {
  return typeof fragment.order === 'number' && Number.isFinite(fragment.order) ? fragment.order : 0;
};

const sortFragments = (fragments: PromptFragment[]): PromptFragment[] => {
  return [...fragments].sort((left, right) => {
    const slotOrderDiff =
      (slotOrderMap.get(left.slot) ?? Number.MAX_SAFE_INTEGER) -
      (slotOrderMap.get(right.slot) ?? Number.MAX_SAFE_INTEGER);
    if (slotOrderDiff !== 0) {
      return slotOrderDiff;
    }

    const anchorDiff = getAnchorKey(left).localeCompare(getAnchorKey(right));
    if (anchorDiff !== 0) {
      return anchorDiff;
    }

    const depthDiff = getDepth(left) - getDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }

    const orderDiff = getOrder(left) - getOrder(right);
    if (orderDiff !== 0) {
      return orderDiff;
    }

    const priorityDiff = right.priority - left.priority;
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.id.localeCompare(right.id);
  });
};

const buildSlotPrompt = (fragments: PromptFragment[], slot: PromptFragmentSlot): string => {
  return sortFragments(fragments)
    .filter(fragment => fragment.slot === slot)
    .map(fragment => fragment.content)
    .filter(content => content.length > 0)
    .join('\n');
};

const buildCombinedPrompt = (fragments: PromptFragment[]): string => {
  const sorted = sortFragments(fragments);
  return SLOT_ORDER.map(slot => {
    const content = sorted
      .filter(fragment => fragment.slot === slot)
      .map(fragment => fragment.content)
      .filter(value => value.length > 0)
      .join('\n');

    if (content.length === 0) {
      return null;
    }

    return `# ${SLOT_HEADINGS[slot]}\n${content}`;
  })
    .filter((value): value is string => value !== null)
    .join('\n\n');
};

export const buildPromptFragments = (context: InferenceContext): PromptFragment[] => {
  const resolver = new NarrativeResolver(context.visible_variables);
  const resolverTemplateContext = {
    ...context.visible_variables,
    name: context.world_pack.name,
    actor_name: context.actor_display_name,
    actor_role: context.actor_ref.role,
    identity_id: context.identity.id,
    strategy: context.strategy,
    current_tick: context.tick.toString()
  };

  const worldTemplate = context.world_prompts.global_prefix ?? '';
  const roleTemplate = context.world_prompts.agent_initial_context ?? '';

  const worldPrompt = worldTemplate.length > 0 ? resolver.resolve(worldTemplate, resolverTemplateContext) : '';
  const resolvedRoleTemplate = roleTemplate.length > 0 ? resolver.resolve(roleTemplate, resolverTemplateContext) : '';
  const rolePrompt = [
    resolvedRoleTemplate,
    `Actor display name: ${context.actor_display_name}`,
    `Actor role: ${context.actor_ref.role}`,
    `Resolved agent id: ${context.resolved_agent_id ?? 'none'}`,
    `Pack actor roles: ${context.pack_state.actor_roles.join(', ') || 'none'}`,
    `Owned artifacts: ${context.pack_state.owned_artifacts.map(artifact => artifact.id).join(', ') || 'none'}`
  ]
    .filter(line => line.length > 0)
    .join('\n');

  const systemPrompt = [
    'You are the Yidhras inference service operating on the current workflow baseline.',
    'Generate a stable, normalized decision for the current actor.',
    `Selected strategy: ${context.strategy}`
  ].join('\n');

  const contextPrompt = JSON.stringify(buildContextPromptPayload(context), null, 2);
  const outputContractPrompt = buildOutputContractPrompt();

  return [
    buildFragment('system_core', 100, systemPrompt, 'system.core'),
    buildFragment('role_core', 90, rolePrompt, 'world_prompts.agent_initial_context'),
    buildFragment('world_context', 80, worldPrompt, 'world_prompts.global_prefix'),
    buildFragment('memory_summary', 70, '', 'memory.summary', {
      memory_selection_count:
        context.memory_context.short_term.length +
        context.memory_context.long_term.length +
        context.memory_context.summaries.length
    }),
    buildFragment('post_process', 60, contextPrompt, 'context.snapshot'),
    buildFragment('output_contract', 50, outputContractPrompt, 'output.contract')
  ];
};

export const buildPromptBundleFromFragments = (
  fragments: PromptFragment[],
  context: InferenceContext
): PromptBundle => {
  const sortedFragments = sortFragments(fragments);

  context.context_run.diagnostics.prompt_assembly = buildContextPromptAssemblySummary(sortedFragments);
  context.context_run.diagnostics.orchestration = {
    ...(context.context_run.diagnostics.orchestration ?? {}),
    prompt_assembly: context.context_run.diagnostics.prompt_assembly
  };
  return {
    system_prompt: buildSlotPrompt(sortedFragments, 'system_core'),
    role_prompt: buildSlotPrompt(sortedFragments, 'role_core'),
    world_prompt: buildSlotPrompt(sortedFragments, 'world_context'),
    context_prompt: buildSlotPrompt(sortedFragments, 'post_process'),
    output_contract_prompt: buildSlotPrompt(sortedFragments, 'output_contract'),
    combined_prompt: buildCombinedPrompt(sortedFragments),
    metadata: {
      prompt_version: PROMPT_VERSION,
      source_prompt_keys: [
        ...Object.keys(context.world_prompts),
        ...sortedFragments.map(fragment => fragment.source)
      ],
      processing_trace: context.memory_context.diagnostics.prompt_processing_trace as
        | PromptProcessingTrace
        | undefined
    }
  };
};

export const buildPromptBundle = async (context: InferenceContext): Promise<PromptBundle> => {
  const fragments = buildPromptFragments(context);
  const orchestrated = await runContextOrchestrator(context, fragments);
  return buildPromptBundleFromFragments(orchestrated.fragments, context);
}
