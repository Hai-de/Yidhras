import { randomUUID } from 'node:crypto';

import { NarrativeResolver } from '../narrative/resolver.js';
import { createMemoryInjectorPromptProcessor } from './processors/memory_injector.js';
import { createMemorySummaryPromptProcessor } from './processors/memory_summary.js';
import { createPolicyFilterPromptProcessor } from './processors/policy_filter.js';
import { createTokenBudgetTrimmerPromptProcessor } from './processors/token_budget_trimmer.js';
import type { PromptFragment, PromptFragmentSlot } from './prompt_fragments.js';
import type { PromptProcessor } from './prompt_processors.js';
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
    binding_ref: context.binding_ref,
    resolved_agent_id: context.resolved_agent_id,
    agent_snapshot: context.agent_snapshot,
    policy_summary: context.policy_summary,
    attributes: context.attributes,
    visible_variables: context.visible_variables,
    memory_context: context.memory_context,
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

const sortFragments = (fragments: PromptFragment[]): PromptFragment[] => {
  const slotOrderMap = new Map(SLOT_ORDER.map((slot, index) => [slot, index]));
  return [...fragments].sort((left, right) => {
    const slotOrderDiff =
      (slotOrderMap.get(left.slot) ?? Number.MAX_SAFE_INTEGER) -
      (slotOrderMap.get(right.slot) ?? Number.MAX_SAFE_INTEGER);
    if (slotOrderDiff !== 0) {
      return slotOrderDiff;
    }

    return right.priority - left.priority;
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
  const templateContext = {
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

  const worldPrompt = worldTemplate.length > 0 ? resolver.resolve(worldTemplate, templateContext) : '';
  const resolvedRoleTemplate = roleTemplate.length > 0 ? resolver.resolve(roleTemplate, templateContext) : '';
  const rolePrompt = [
    resolvedRoleTemplate,
    `Actor display name: ${context.actor_display_name}`,
    `Actor role: ${context.actor_ref.role}`,
    `Resolved agent id: ${context.resolved_agent_id ?? 'none'}`
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

const buildPromptProcessingTrace = (
  processorNames: string[],
  fragmentsBefore: PromptFragment[],
  fragmentsAfter: PromptFragment[],
  steps: PromptProcessingTrace['steps'] = []
): PromptProcessingTrace => {
  return {
    processor_names: processorNames,
    fragment_count_before: fragmentsBefore.length,
    fragment_count_after: fragmentsAfter.length,
    steps,
    fragments: fragmentsAfter.map(fragment => ({
      id: fragment.id,
      slot: fragment.slot,
      source: fragment.source,
      priority: fragment.priority,
      metadata: fragment.metadata
    }))
  };
};

const diffFragments = (
  before: PromptFragment[],
  after: PromptFragment[],
  processorName: string
): NonNullable<PromptProcessingTrace['steps']>[number] => {
  const beforeIds = new Set(before.map(fragment => fragment.id));
  const afterIds = new Set(after.map(fragment => fragment.id));
  const addedFragmentIds = after
    .filter(fragment => !beforeIds.has(fragment.id))
    .map(fragment => fragment.id);
  const removedFragmentIds = before
    .filter(fragment => !afterIds.has(fragment.id))
    .map(fragment => fragment.id);

  const notes: Record<string, unknown> = {};
  const summaryCompaction = after.find(fragment => fragment.source === 'memory.summary.compaction');
  if (processorName === 'memory-summary' && summaryCompaction) {
    notes.summary_fragment_id = summaryCompaction.id;
    notes.summarized_fragment_ids = summaryCompaction.metadata?.summarized_fragment_ids;
  }

  if (processorName === 'policy-filter') {
    notes.policy_filtered = removedFragmentIds.length;
  }

  if (processorName === 'token-budget-trimmer') {
    notes.trimmed = removedFragmentIds.length;
  }

  return {
    processor_name: processorName,
    fragment_count_before: before.length,
    fragment_count_after: after.length,
    added_fragment_ids: addedFragmentIds,
    removed_fragment_ids: removedFragmentIds,
    notes
  };
};

export const runPromptProcessors = async (
  context: InferenceContext,
  fragments: PromptFragment[],
  processors: PromptProcessor[] = [
    createMemoryInjectorPromptProcessor(),
    createPolicyFilterPromptProcessor(),
    createMemorySummaryPromptProcessor(),
    createTokenBudgetTrimmerPromptProcessor()
  ]
): Promise<PromptFragment[]> => {
  let current = sortFragments(fragments);
  const initialFragments = current;
  const steps: NonNullable<PromptProcessingTrace['steps']> = [];

  for (const processor of processors) {
    const before = current;
    const after = sortFragments(
      await processor.process({
        context,
        fragments: before
      })
    );
    steps.push(diffFragments(before, after, processor.name));
    current = after;
  }

  const baseTrace = buildPromptProcessingTrace(
    processors.map(processor => processor.name),
    initialFragments,
    current,
    steps
  );

  context.memory_context.diagnostics = {
    ...context.memory_context.diagnostics,
    prompt_processing_trace: {
      ...baseTrace,
      ...((typeof context.memory_context.diagnostics.prompt_processing_trace === 'object' &&
        context.memory_context.diagnostics.prompt_processing_trace !== null)
        ? (context.memory_context.diagnostics.prompt_processing_trace as Record<string, unknown>)
        : {})
    }
  };
  return current;
};

export const buildPromptBundleFromFragments = (
  fragments: PromptFragment[],
  context: InferenceContext
): PromptBundle => {
  const sortedFragments = sortFragments(fragments);

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
  const processed = await runPromptProcessors(context, fragments);
  return buildPromptBundleFromFragments(processed, context);
};
