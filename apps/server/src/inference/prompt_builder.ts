import { randomUUID } from 'node:crypto';

import { buildContextPromptAssemblySummary, runContextOrchestrator } from '../context/workflow/orchestrator.js';
import { sortPromptFragmentsBase } from '../context/workflow/placement_resolution.js';
import { buildSectionDraftsFromFragments, buildSectionSummary } from '../context/workflow/section_drafts.js';
import type { PromptWorkflowTaskType } from '../context/workflow/types.js';
import { renderNarrativeTemplate } from '../narrative/resolver.js';
import type { PromptMacroDiagnostics } from '../narrative/types.js';
import type { PromptFragment, PromptFragmentSlot } from './prompt_fragments.js';
import type { InferenceContext, PromptBundle, PromptProcessingTrace, PromptResolvableContext } from './types.js';

type PromptContext = InferenceContext | PromptResolvableContext;

const isFullInferenceContext = (ctx: PromptContext): ctx is InferenceContext => {
  return 'inference_id' in ctx && ctx.inference_id != null && ctx.context_run != null && ctx.memory_context != null;
};

const PROMPT_VERSION = 'phase-b-v1';

export interface PromptWorkflowBuildOptions {
  task_type?: PromptWorkflowTaskType;
  profile_id?: string | null;
  include_sections?: string[];
}

const resolvePromptWorkflowTaskType = (options?: PromptWorkflowBuildOptions): PromptWorkflowTaskType => {
  return options?.task_type ?? 'agent_decision';
};

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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const buildContextPromptPayload = (context: PromptContext): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    actor_ref: context.actor_ref,
    actor_display_name: context.actor_display_name,
    resolved_agent_id: context.resolved_agent_id,
    agent_snapshot: context.agent_snapshot,
    attributes: context.attributes,
    visible_variables: 'visible_variables' in context ? context.visible_variables : [],
    variable_context_summary: context.variable_context_summary,
    pack_state: context.pack_state,
    tick: context.tick.toString(),
    world_pack: context.world_pack,
    strategy: context.strategy
  };
  if (context.context_run) {
    payload.context_run = context.context_run;
  }
  if ('binding_ref' in context) {
    payload.binding_ref = context.binding_ref;
  }
  if (context.memory_context) {
    payload.memory_context = context.memory_context;
  }
  if ('policy_summary' in context) {
    payload.policy_summary = context.policy_summary;
  }
  return payload;
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
  return sortPromptFragmentsBase(fragments, SLOT_ORDER);
};

const readPromptWorkflowMetadata = (context: PromptContext): {
  workflow_task_type: string | null;
  workflow_profile_id: string | null;
  workflow_profile_version: string | null;
  workflow_step_keys?: string[];
  workflow_section_summary?: Record<string, unknown> | null;
  workflow_placement_summary?: Record<string, unknown> | null;
  workflow_variable_summary?: Record<string, unknown> | null;
  workflow_macro_summary?: PromptMacroDiagnostics | null;
  processing_trace?: PromptProcessingTrace;
} => {
  if (!context.context_run) {
    return {
      workflow_task_type: null,
      workflow_profile_id: null,
      workflow_profile_version: null
    };
  }
  const orchestration = isRecord(context.context_run.diagnostics.orchestration)
    ? context.context_run.diagnostics.orchestration
    : null;
  const promptWorkflow = orchestration && isRecord(orchestration.prompt_workflow)
    ? orchestration.prompt_workflow
    : null;
  const orchestrationTrace = orchestration?.processing_trace;
  const legacyTrace = context.memory_context?.diagnostics?.prompt_processing_trace;
  const processingTrace = isRecord(orchestrationTrace)
    ? (orchestrationTrace as unknown as PromptProcessingTrace)
    : isRecord(legacyTrace)
      ? (legacyTrace as unknown as PromptProcessingTrace)
      : undefined;

  return {
    workflow_task_type:
      promptWorkflow && typeof promptWorkflow.task_type === 'string'
        ? promptWorkflow.task_type
        : processingTrace?.workflow_task_type ?? null,
    workflow_profile_id:
      promptWorkflow && typeof promptWorkflow.profile_id === 'string'
        ? promptWorkflow.profile_id
        : processingTrace?.workflow_profile_id ?? null,
    workflow_profile_version:
      promptWorkflow && typeof promptWorkflow.profile_version === 'string'
        ? promptWorkflow.profile_version
        : processingTrace?.workflow_profile_version ?? null,
    workflow_step_keys:
      promptWorkflow && Array.isArray(promptWorkflow.selected_step_keys)
        ? promptWorkflow.selected_step_keys.filter((value): value is string => typeof value === 'string')
        : processingTrace?.workflow_step_keys,
    workflow_section_summary:
      promptWorkflow && isRecord(promptWorkflow.section_summary)
        ? promptWorkflow.section_summary
        : null,
    workflow_placement_summary:
      promptWorkflow && isRecord(promptWorkflow.placement_summary)
        ? promptWorkflow.placement_summary
        : null,
    workflow_variable_summary:
      promptWorkflow && isRecord(promptWorkflow.variable_summary)
        ? promptWorkflow.variable_summary
        : null,
    workflow_macro_summary:
      promptWorkflow && isRecord(promptWorkflow.macro_summary)
        ? (promptWorkflow.macro_summary as unknown as PromptMacroDiagnostics)
        : null,
    processing_trace: processingTrace
  };
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

const summarizeMacroDiagnostics = (
  diagnostics: PromptMacroDiagnostics[]
): { variableSummary: Record<string, unknown>; macroSummary: PromptMacroDiagnostics } => {
  const namespaces = new Set<string>();
  const missingPaths = new Set<string>();
  const restrictedPaths = new Set<string>();
  let aliasFallbackCount = 0;
  let outputLength = 0;
  const traces: PromptMacroDiagnostics['traces'] = [];
  const blocks: NonNullable<PromptMacroDiagnostics['blocks']> = [];

  for (const item of diagnostics) {
    for (const namespace of item.namespaces_used ?? []) {
      namespaces.add(namespace);
    }
    for (const path of item.missing_paths) {
      missingPaths.add(path);
    }
    for (const path of item.restricted_paths) {
      restrictedPaths.add(path);
    }
    aliasFallbackCount += item.alias_fallback_count ?? 0;
    outputLength += item.output_length ?? 0;
    traces.push(...item.traces);
    blocks.push(...(item.blocks ?? []));
  }

  return {
    variableSummary: {
      namespaces: Array.from(namespaces),
      alias_fallback_count: aliasFallbackCount,
      missing_paths: Array.from(missingPaths),
      restricted_paths: Array.from(restrictedPaths)
    },
    macroSummary: {
      template_source: diagnostics.map(item => item.template_source).filter((value): value is string => Boolean(value)).join(',') || undefined,
      traces,
      missing_paths: Array.from(missingPaths),
      restricted_paths: Array.from(restrictedPaths),
      blocks,
      alias_fallback_count: aliasFallbackCount,
      namespaces_used: Array.from(namespaces),
      output_length: outputLength
    }
  };
};

export const buildPromptFragments = (context: PromptContext): PromptFragment[] => {
  const worldTemplate = context.world_prompts.global_prefix ?? '';
  const roleTemplate = context.world_prompts.agent_initial_context ?? '';

  const worldRender = worldTemplate.length > 0
    ? renderNarrativeTemplate({
        template: worldTemplate,
        variableContext: context.variable_context,
        extraContext: {
          actor_name: context.actor_display_name,
          actor_role: context.actor_ref.role,
          current_tick: context.tick.toString()
        },
        templateSource: 'world_prompts.global_prefix'
      })
    : { text: '', diagnostics: { traces: [], missing_paths: [], restricted_paths: [], blocks: [], alias_fallback_count: 0, namespaces_used: [], output_length: 0 } };

  const roleRender = roleTemplate.length > 0
    ? renderNarrativeTemplate({
        template: roleTemplate,
        variableContext: context.variable_context,
        extraContext: {
          actor_name: context.actor_display_name,
          actor_role: context.actor_ref.role,
          identity_id: context.identity.id,
          strategy: context.strategy,
          current_tick: context.tick.toString()
        },
        templateSource: 'world_prompts.agent_initial_context'
      })
    : { text: '', diagnostics: { traces: [], missing_paths: [], restricted_paths: [], blocks: [], alias_fallback_count: 0, namespaces_used: [], output_length: 0 } };

  const { variableSummary, macroSummary } = summarizeMacroDiagnostics([worldRender.diagnostics, roleRender.diagnostics]);
  if (context.context_run) {
    context.context_run.diagnostics.orchestration = {
      ...(context.context_run.diagnostics.orchestration ?? {}),
      variable_resolution: {
        variable_summary: variableSummary,
        macro_summary: macroSummary
      }
    };
  }

  const rolePrompt = [
    roleRender.text,
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

  const memorySelectionCount = context.memory_context
    ? context.memory_context.short_term.length + context.memory_context.long_term.length + context.memory_context.summaries.length
    : 0;

  return [
    buildFragment('system_core', 100, systemPrompt, 'system.core'),
    buildFragment('role_core', 90, rolePrompt, 'world_prompts.agent_initial_context', {
      prompt_macro_diagnostics: roleRender.diagnostics
    }),
    buildFragment('world_context', 80, worldRender.text, 'world_prompts.global_prefix', {
      prompt_macro_diagnostics: worldRender.diagnostics
    }),
    buildFragment('memory_summary', 70, '', 'memory.summary', {
      memory_selection_count: memorySelectionCount
    }),
    buildFragment('post_process', 60, contextPrompt, 'context.snapshot'),
    buildFragment('output_contract', 50, outputContractPrompt, 'output.contract')
  ];
};

export const buildPromptBundleFromFragments = (
  fragments: PromptFragment[],
  context: PromptContext
): PromptBundle => {
  const sortedFragments = sortFragments(fragments);
  const workflowMetadata = readPromptWorkflowMetadata(context);
  const workflowSectionPolicy = workflowMetadata.workflow_profile_id === 'context-summary-default'
    || workflowMetadata.workflow_profile_id === 'memory-compaction-default'
    ? 'minimal'
    : 'standard';
  const fallbackSectionSummary = buildSectionSummary(
    buildSectionDraftsFromFragments(sortedFragments, {
      task_type: (workflowMetadata.workflow_task_type ?? 'agent_decision') as PromptWorkflowTaskType,
      section_policy: workflowSectionPolicy
    })
  );
  const resolvedSectionSummary = workflowMetadata.workflow_section_summary ?? fallbackSectionSummary;
  const resolvedPlacementSummary = workflowMetadata.workflow_placement_summary ?? {
    total_fragments: sortedFragments.length,
    resolved_with_anchor: sortedFragments.filter(fragment => fragment.anchor).length,
    fallback_count: 0
  };
  const variableResolution = context.context_run && isRecord(context.context_run.diagnostics.orchestration?. variable_resolution)
    ? context.context_run.diagnostics.orchestration.variable_resolution as Record<string, unknown>
    : null;

  if (context.context_run) {
    context.context_run.diagnostics.prompt_assembly = buildContextPromptAssemblySummary(sortedFragments);
    context.context_run.diagnostics.orchestration = {
      ...(context.context_run.diagnostics.orchestration ?? {}),
      prompt_assembly: context.context_run.diagnostics.prompt_assembly
    };
  }
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
      workflow_task_type: workflowMetadata.workflow_task_type,
      workflow_profile_id: workflowMetadata.workflow_profile_id,
      workflow_profile_version: workflowMetadata.workflow_profile_version,
      workflow_step_keys: workflowMetadata.workflow_step_keys,
      workflow_section_summary: resolvedSectionSummary,
      workflow_placement_summary: resolvedPlacementSummary,
      workflow_variable_summary: workflowMetadata.workflow_variable_summary ?? (variableResolution?.variable_summary as Record<string, unknown> | undefined),
      workflow_macro_summary: workflowMetadata.workflow_macro_summary ?? (variableResolution?.macro_summary as PromptMacroDiagnostics | undefined),
      processing_trace: workflowMetadata.processing_trace
    }
  };
};

export const buildPromptBundle = async (context: PromptContext, options: PromptWorkflowBuildOptions = {}): Promise<PromptBundle> => {
  const fragments = buildPromptFragments(context);
  if (isFullInferenceContext(context)) {
    const orchestrated = await runContextOrchestrator(context, fragments, {
      task_type: resolvePromptWorkflowTaskType(options),
      profile_id: options.profile_id ?? null,
      include_sections: options.include_sections
    });
    return buildPromptBundleFromFragments(orchestrated.fragments, context);
  }
  return buildPromptBundleFromFragments(fragments, context);
};
