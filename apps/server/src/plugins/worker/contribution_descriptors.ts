import { z } from 'zod';

import { PLUGIN_CAPABILITY_KEY } from '../capability_keys.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const prioritySchema = z.number().int().default(0);
const capabilityKeySchema = z.enum([
  PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER,
  PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER,
  PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER,
  PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST,
  PLUGIN_CAPABILITY_KEY.STEP_CONTRIBUTOR_REGISTER,
  PLUGIN_CAPABILITY_KEY.RULE_CONTRIBUTOR_REGISTER,
  PLUGIN_CAPABILITY_KEY.QUERY_CONTRIBUTOR_REGISTER,
  PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER,
  PLUGIN_CAPABILITY_KEY.SLOT_CONDITION_REGISTER,
  PLUGIN_CAPABILITY_KEY.SLOT_CONTENT_TRANSFORM_REGISTER,
  PLUGIN_CAPABILITY_KEY.PERCEPTION_RESOLVER_REGISTER
]);

const baseContributionDescriptorSchema = z.object({
  name: nonEmptyStringSchema,
  invoke: nonEmptyStringSchema,
  priority: prioritySchema,
  capabilityKey: capabilityKeySchema.optional(),
  manifestName: nonEmptyStringSchema.optional()
});

export const contextSourceDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('context_source'),
  adapterType: z.enum(['entity_state', 'world_state', 'relationship', 'custom']).default('custom'),
  config: z.record(z.string(), z.unknown()).default({})
});

export const promptWorkflowStepDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('prompt_workflow_step'),
  stepKind: z.enum([
    'memory_projection',
    'node_working_set_filter',
    'node_grouping',
    'summary_compaction',
    'token_budget_trim',
    'placement_resolution',
    'fragment_assembly',
    'behavior_control',
    'content_transform',
    'permission_filter',
    'bundle_finalize'
  ]),
  config: z.record(z.string(), z.unknown()).default({})
});

export const packRouteDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('api_route'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: nonEmptyStringSchema,
  config: z.record(z.string(), z.unknown()).default({})
});

export const stepContributorDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('step_contributor'),
  config: z.record(z.string(), z.unknown()).default({})
});

export const ruleContributorDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('rule_contributor'),
  supportsRuleIds: z.array(nonEmptyStringSchema).default([]),
  config: z.record(z.string(), z.unknown()).default({})
});

export const queryContributorDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('query_contributor'),
  supportsQueryNames: z.array(nonEmptyStringSchema).default([]),
  config: z.record(z.string(), z.unknown()).default({})
});

export const dataCleanerDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('data_cleaner'),
  key: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  trigger: z.enum(['on_tick', 'on_unload']).default('on_tick'),
  config: z.record(z.string(), z.unknown()).default({})
});

export const slotConditionEvaluatorDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('slot_condition_evaluator'),
  key: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  config: z.record(z.string(), z.unknown()).default({})
});

export const slotContentTransformerDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('slot_content_transformer'),
  key: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  config: z.record(z.string(), z.unknown()).default({})
});

export const perceptionResolverDescriptorSchema = baseContributionDescriptorSchema.extend({
  type: z.literal('perception_resolver'),
  config: z.record(z.string(), z.unknown()).default({})
});

export const contributionDescriptorSchema = z.discriminatedUnion('type', [
  contextSourceDescriptorSchema,
  promptWorkflowStepDescriptorSchema,
  packRouteDescriptorSchema,
  stepContributorDescriptorSchema,
  ruleContributorDescriptorSchema,
  queryContributorDescriptorSchema,
  dataCleanerDescriptorSchema,
  slotConditionEvaluatorDescriptorSchema,
  slotContentTransformerDescriptorSchema,
  perceptionResolverDescriptorSchema
]);

export const contributionDescriptorListSchema = z.array(contributionDescriptorSchema);

export type ContextSourceDescriptor = z.output<typeof contextSourceDescriptorSchema>;
export type PromptWorkflowStepDescriptor = z.output<typeof promptWorkflowStepDescriptorSchema>;
export type PackRouteDescriptor = z.output<typeof packRouteDescriptorSchema>;
export type StepContributorDescriptor = z.output<typeof stepContributorDescriptorSchema>;
export type RuleContributorDescriptor = z.output<typeof ruleContributorDescriptorSchema>;
export type QueryContributorDescriptor = z.output<typeof queryContributorDescriptorSchema>;
export type DataCleanerDescriptor = z.output<typeof dataCleanerDescriptorSchema>;
export type SlotConditionEvaluatorDescriptor = z.output<typeof slotConditionEvaluatorDescriptorSchema>;
export type SlotContentTransformerDescriptor = z.output<typeof slotContentTransformerDescriptorSchema>;
export type PerceptionResolverDescriptor = z.output<typeof perceptionResolverDescriptorSchema>;
export type ContributionDescriptor = z.output<typeof contributionDescriptorSchema>;
export type ContextSourceDescriptorInput = z.input<typeof contextSourceDescriptorSchema>;
export type PromptWorkflowStepDescriptorInput = z.input<typeof promptWorkflowStepDescriptorSchema>;
export type PackRouteDescriptorInput = z.input<typeof packRouteDescriptorSchema>;
export type StepContributorDescriptorInput = z.input<typeof stepContributorDescriptorSchema>;
export type RuleContributorDescriptorInput = z.input<typeof ruleContributorDescriptorSchema>;
export type QueryContributorDescriptorInput = z.input<typeof queryContributorDescriptorSchema>;
export type DataCleanerDescriptorInput = z.input<typeof dataCleanerDescriptorSchema>;
export type SlotConditionEvaluatorDescriptorInput = z.input<typeof slotConditionEvaluatorDescriptorSchema>;
export type SlotContentTransformerDescriptorInput = z.input<typeof slotContentTransformerDescriptorSchema>;
export type PerceptionResolverDescriptorInput = z.input<typeof perceptionResolverDescriptorSchema>;
export type ContributionDescriptorInput = z.input<typeof contributionDescriptorSchema>;
export type ContributionType = ContributionDescriptor['type'];
