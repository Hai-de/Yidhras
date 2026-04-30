import { z } from 'zod';
import { fromError } from 'zod-validation-error';

import {
  authorityGrantTypeSchema,
  capabilityCategorySchema,
  mediatorKindSchema,
  nonEmptyStringSchema,
  packEntityKindSchema,
  packReferenceKindSchema
} from './common_schema.js';
import { worldPackStorageSchema } from './storage_schema.js';

export type WorldPackVariableValue =
  | string
  | number
  | boolean
  | {
      [key: string]: WorldPackVariableValue;
    };

export type WorldPackValue =
  | string
  | number
  | boolean
  | null
  | WorldPackValue[]
  | {
      [key: string]: WorldPackValue;
    };

export type WorldPackAiTaskType =
  | 'agent_decision'
  | 'intent_grounding_assist'
  | 'context_summary'
  | 'memory_compaction'
  | 'narrative_projection'
  | 'entity_extraction'
  | 'classification'
  | 'moderation'
  | 'embedding'
  | 'rerank';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const worldPackVariableValueSchema: z.ZodType<WorldPackVariableValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), worldPackVariableValueSchema)])
);

const worldPackValueSchema: z.ZodType<WorldPackValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(worldPackValueSchema),
    z.record(z.string(), worldPackValueSchema)
  ])
);

const tickLikeSchema = z.union([nonEmptyStringSchema, z.number().int()]);

const aiTaskTypeSchema = z.enum([
  'agent_decision',
  'intent_grounding_assist',
  'context_summary',
  'memory_compaction',
  'narrative_projection',
  'entity_extraction',
  'classification',
  'moderation',
  'embedding',
  'rerank'
]);

const aiResponseModeSchema = z.enum(['free_text', 'json_object', 'json_schema', 'tool_call', 'embedding']);
const aiPrivacyTierSchema = z.enum(['local_only', 'trusted_cloud', 'any']);
const aiLatencyTierSchema = z.enum(['interactive', 'background', 'offline']);
const aiDeterminismTierSchema = z.enum(['strict', 'balanced', 'creative']);

const aiTaskPromptOverrideSchema = z
  .object({
    preset: nonEmptyStringSchema.optional(),
    system_append: z.string().optional(),
    developer_append: z.string().optional(),
    user_prefix: z.string().optional(),
    include_sections: z.array(nonEmptyStringSchema).optional(),
    examples: z.array(z.record(z.string(), worldPackValueSchema)).optional()
  })
  .strict();

const aiTaskOutputOverrideSchema = z
  .object({
    mode: aiResponseModeSchema.optional(),
    schema: z.record(z.string(), worldPackValueSchema).optional(),
    strict: z.boolean().optional()
  })
  .strict();

const aiTaskParseOverrideSchema = z
  .object({
    decoder: nonEmptyStringSchema.optional(),
    unwrap: nonEmptyStringSchema.optional(),
    field_alias: z.record(z.string(), nonEmptyStringSchema).optional(),
    required_fields: z.array(nonEmptyStringSchema).optional(),
    defaults: z.record(z.string(), worldPackValueSchema).optional()
  })
  .strict();

const aiTaskRouteOverrideSchema = z
  .object({
    route_id: nonEmptyStringSchema.optional(),
    provider: nonEmptyStringSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    latency_tier: aiLatencyTierSchema.optional(),
    determinism_tier: aiDeterminismTierSchema.optional(),
    privacy_tier: aiPrivacyTierSchema.optional()
  })
  .strict();

const aiTaskOverrideSchema = z
  .object({
    prompt: aiTaskPromptOverrideSchema.optional(),
    output: aiTaskOutputOverrideSchema.optional(),
    parse: aiTaskParseOverrideSchema.optional(),
    route: aiTaskRouteOverrideSchema.optional(),
    metadata: z.record(z.string(), worldPackValueSchema).optional()
  })
  .strict();

const aiPackDefaultsSchema = z
  .object({
    prompt_preset: nonEmptyStringSchema.optional(),
    decoder: nonEmptyStringSchema.optional(),
    route_id: nonEmptyStringSchema.optional(),
    privacy_tier: aiPrivacyTierSchema.optional()
  })
  .strict();

const aiPackMemoryLoopSchema = z
  .object({
    summary_every_n_rounds: z.number().int().positive().optional(),
    compaction_every_n_rounds: z.number().int().positive().optional()
  })
  .strict();

const aiPackConfigSchema = z
  .object({
    defaults: aiPackDefaultsSchema.optional(),
    memory_loop: aiPackMemoryLoopSchema.optional(),
    tasks: z.partialRecord(aiTaskTypeSchema, aiTaskOverrideSchema).optional()
  })
  .strict();

const timeUnitSchema = z
  .object({
    name: nonEmptyStringSchema,
    ratio: z.number().int().positive().optional(),
    irregular_ratios: z.array(z.number().int().positive()).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ratio === undefined && value.irregular_ratios === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'time unit requires ratio or irregular_ratios'
      });
    }
  });

const calendarConfigSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    is_primary: z.boolean().optional(),
    tick_rate: z.number().int().positive(),
    units: z.array(timeUnitSchema)
  })
  .strict();

export const simulationTimeConfigSchema = z
  .object({
    min_tick: tickLikeSchema.optional(),
    max_tick: tickLikeSchema.optional(),
    initial_tick: tickLikeSchema.optional(),
    step_ticks: tickLikeSchema.optional()
  })
  .strict();

const metadataLinkSchema = z.union([z.string().url(), nonEmptyStringSchema]);

const metadataAuthorSchema = z
  .object({
    name: nonEmptyStringSchema,
    role: nonEmptyStringSchema.optional(),
    homepage: metadataLinkSchema.optional()
  })
  .strict();

const metadataPresentationSchema = z
  .object({
    cover_image: nonEmptyStringSchema.optional(),
    icon: nonEmptyStringSchema.optional(),
    theme: z.record(z.string(), worldPackValueSchema).optional()
  })
  .strict();

const metadataSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional(),
    authors: z.array(metadataAuthorSchema).optional(),
    license: nonEmptyStringSchema.optional(),
    homepage: metadataLinkSchema.optional(),
    repository: metadataLinkSchema.optional(),
    tags: z.array(nonEmptyStringSchema).optional(),
    presentation: metadataPresentationSchema.optional(),
    published_at: nonEmptyStringSchema.optional(),
    status: nonEmptyStringSchema.optional()
  })
  .passthrough();

const constitutionSchema = z
  .object({
    axioms: z.array(nonEmptyStringSchema).default([]),
    namespaces: z.array(nonEmptyStringSchema).default([])
  })
  .strict()
  .default({ axioms: [], namespaces: [] });

const entityDefinitionSchema = z
  .object({
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    kind: packEntityKindSchema.optional(),
    entity_type: nonEmptyStringSchema.optional(),
    tags: z.array(nonEmptyStringSchema).default([]),
    static_schema_ref: nonEmptyStringSchema.optional(),
    state: z.record(z.string(), worldPackValueSchema).optional(),
    claims: z.record(z.string(), worldPackValueSchema).optional(),
    metadata: z.record(z.string(), worldPackValueSchema).optional()
  })
  .strict();

const mediatorDefinitionSchema = z
  .object({
    id: nonEmptyStringSchema,
    entity_ref: nonEmptyStringSchema,
    mediator_kind: mediatorKindSchema,
    grants: z
      .array(
        z
          .object({
            capability_key: nonEmptyStringSchema
          })
          .strict()
      )
      .default([]),
    requires: z.array(worldPackValueSchema).default([]),
    binding_rules: z.array(worldPackValueSchema).default([]),
    perception_effects: z.array(worldPackValueSchema).default([]),
    execution_effects: z.array(worldPackValueSchema).default([]),
    override_rules: z.array(worldPackValueSchema).default([]),
    revocation_rules: z.array(worldPackValueSchema).default([])
  })
  .strict();

const entitiesSchema = z
  .object({
    actors: z.array(entityDefinitionSchema).default([]),
    artifacts: z.array(entityDefinitionSchema).default([]),
    mediators: z.array(mediatorDefinitionSchema).default([]),
    domains: z.array(entityDefinitionSchema).default([]),
    institutions: z.array(entityDefinitionSchema).default([])
  })
  .strict()
  .default({
    actors: [],
    artifacts: [],
    mediators: [],
    domains: [],
    institutions: []
  })
  .superRefine((value, ctx) => {
    const allEntityIds = [
      ...value.actors.map(item => item.id),
      ...value.artifacts.map(item => item.id),
      ...value.mediators.map(item => item.id),
      ...value.domains.map(item => item.id),
      ...value.institutions.map(item => item.id)
    ];
    const uniqueIds = new Set(allEntityIds);
    if (uniqueIds.size !== allEntityIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'entity ids must be unique across all entity groups'
      });
    }
  });

const identityDefinitionSchema = z
  .object({
    id: nonEmptyStringSchema,
    subject_entity_id: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    claims: z.record(z.string(), worldPackValueSchema).optional(),
    metadata: z.record(z.string(), worldPackValueSchema).optional()
  })
  .strict();

const capabilityDefinitionSchema = z
  .object({
    key: nonEmptyStringSchema,
    category: capabilityCategorySchema,
    description: nonEmptyStringSchema.optional(),
    target_schema: nonEmptyStringSchema.optional(),
    requires_subject_schema: nonEmptyStringSchema.optional(),
    default_visibility: z.enum(['operator', 'public', 'actor_local']).optional(),
    default_constraints: z.record(z.string(), worldPackValueSchema).optional()
  })
  .strict();

const targetSelectorSchema = z
  .object({
    kind: packReferenceKindSchema,
    entity_id: nonEmptyStringSchema.optional(),
    identity_id: nonEmptyStringSchema.optional(),
    mediator_id: nonEmptyStringSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.kind === 'holder_of' ||
      value.kind === 'binding_of' ||
      value.kind === 'direct_entity' ||
      value.kind === 'domain_owner'
    ) {
      if (!value.entity_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `target selector kind=${value.kind} requires entity_id`
        });
      }
    }
    if (value.kind === 'subject_entity' && !value.identity_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target selector kind=subject_entity requires identity_id'
      });
    }
  });

const authorityDefinitionSchema = z
  .object({
    id: nonEmptyStringSchema,
    source_entity_id: nonEmptyStringSchema,
    target_selector: targetSelectorSchema,
    capability_key: nonEmptyStringSchema,
    grant_type: authorityGrantTypeSchema,
    mediated_by_entity_id: nonEmptyStringSchema.optional(),
    scope_json: z.record(z.string(), worldPackValueSchema).optional(),
    conditions_json: z.record(z.string(), worldPackValueSchema).optional(),
    priority: z.number().int().default(0),
    status: nonEmptyStringSchema.optional(),
    revocable: z.boolean().optional()
  })
  .strict();

const worldRuleDefinitionSchema = z
  .object({
    id: nonEmptyStringSchema,
    when: z.record(z.string(), worldPackValueSchema).default({}),
    then: z.record(z.string(), worldPackValueSchema).default({})
  })
  .strict();

const KERNEL_INTENT_TYPES = ['trigger_event', 'post_message', 'adjust_relationship', 'adjust_snr'] as const;

const objectiveEnforcementWhenSchema = z.record(z.string(), worldPackValueSchema).superRefine((when, ctx) => {
  if (typeof when.invocation_type === 'string' && when.invocation_type.trim().length > 0) {
    const value = when.invocation_type;
    if (KERNEL_INTENT_TYPES.includes(value as (typeof KERNEL_INTENT_TYPES)[number])) {
      return;
    }
    if (!value.startsWith('invoke.')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invocation_type '${value}' must use 'invoke.' prefix for capability-key matching in the enforcement pipeline. Expected format: 'invoke.${value}'. Kernel actions (${KERNEL_INTENT_TYPES.join(', ')}) are exempt.`
      });
    }
  }
});

const objectiveEnforcementRuleSchema = worldRuleDefinitionSchema.extend({
  when: objectiveEnforcementWhenSchema
});

const rulesSchema = z
  .object({
    perception: z.array(worldRuleDefinitionSchema).default([]),
    capability_resolution: z.array(worldRuleDefinitionSchema).default([]),
    invocation: z.array(worldRuleDefinitionSchema).default([]),
    objective_enforcement: z.array(objectiveEnforcementRuleSchema).default([]),
    projection: z.array(worldRuleDefinitionSchema).default([])
  })
  .strict()
  .default({
    perception: [],
    capability_resolution: [],
    invocation: [],
    objective_enforcement: [],
    projection: []
  });

const bootstrapInitialStateSchema = z
  .object({
    entity_id: nonEmptyStringSchema,
    state_namespace: nonEmptyStringSchema,
    state_json: z.record(z.string(), worldPackValueSchema)
  })
  .strict();

const bootstrapInitialEventSchema = z
  .object({
    event_type: nonEmptyStringSchema,
    payload: z.record(z.string(), worldPackValueSchema).default({})
  })
  .strict();

const worldPackVariablesRecordSchema = z.record(z.string(), worldPackVariableValueSchema);

const worldPackOpeningSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    variables: worldPackVariablesRecordSchema.optional(),
    initial_states: bootstrapInitialStateSchema.array().optional().default([]),
    initial_events: bootstrapInitialEventSchema.array().optional().default([])
  })
  .strict();

const bootstrapSchema = z
  .object({
    initial_states: z.array(bootstrapInitialStateSchema).default([]),
    initial_events: z.array(worldPackValueSchema).default([])
  })
  .strict()
  .default({ initial_states: [], initial_events: [] });

const stateTransformRangeSchema = z
  .object({
    min: z.number(),
    max: z.number(),
    label: nonEmptyStringSchema
  })
  .strict();

const stateTransformSchema = z
  .object({
    source: nonEmptyStringSchema,
    ranges: z.array(stateTransformRangeSchema),
    target: nonEmptyStringSchema
  })
  .strict()
  .superRefine((value, ctx) => {
    const ranges = value.ranges;
    for (const range of ranges) {
      if (range.min > range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `state_transform range min (${range.min}) must be <= max (${range.max}) for label "${range.label}"`
        });
      }
    }
    const labels = ranges.map(r => r.label);
    const uniqueLabels = new Set(labels);
    if (uniqueLabels.size !== labels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'state_transform range labels must be unique'
      });
    }
  });

export const worldPackConstitutionSchema = z
  .object({
    metadata: metadataSchema,
    constitution: constitutionSchema.optional(),
    variables: z.record(z.string(), worldPackVariableValueSchema).optional(),
    prompts: z.record(z.string(), z.string()).optional(),
    ai: aiPackConfigSchema.optional(),
    time_systems: z.array(calendarConfigSchema).optional(),
    simulation_time: simulationTimeConfigSchema.optional(),
    entities: entitiesSchema.optional(),
    identities: z.array(identityDefinitionSchema).optional(),
    capabilities: z.array(capabilityDefinitionSchema).optional(),
    authorities: z.array(authorityDefinitionSchema).optional(),
    rules: rulesSchema.optional(),
    storage: worldPackStorageSchema.optional(),
    scheduler: z
      .object({
        partition_count: z.number().int().positive().optional()
      })
      .optional(),
    bootstrap: bootstrapSchema.optional(),
    state_transforms: z.array(stateTransformSchema).optional()
  })
  .superRefine((value, ctx) => {
    if ('actions' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Legacy field actions is no longer accepted; migrate to rules.objective_enforcement + capabilities/authorities'
      });
    }
    if ('decision_rules' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Legacy field decision_rules is no longer accepted; migrate to unified rules.* definitions'
      });
    }

    const entityIds = new Set<string>();
    if (value.entities) {
      for (const actor of value.entities.actors ?? []) {
        entityIds.add(actor.id);
      }
    }

    if (value.identities) {
      for (const identity of value.identities) {
        if (!entityIds.has(identity.subject_entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `identity "${identity.id}" references unknown actor "${identity.subject_entity_id}" in subject_entity_id`,
            path: ['identities']
          });
        }
      }
    }

    if (value.state_transforms && value.state_transforms.length > 1) {
      const targets = value.state_transforms.map(t => t.target);
      const seen = new Set<string>();
      for (const target of targets) {
        if (seen.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate state_transform target "${target}": each transform must have a unique target key`,
            path: ['state_transforms']
          });
          break;
        }
        seen.add(target);
      }
    }

    if ('scenario' in value) {
      const scenarioValue = isRecord(value.scenario) ? value.scenario : null;
      if (scenarioValue && 'agents' in scenarioValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Legacy scenario.agents is no longer accepted; migrate to entities.actors + identities/authorities'
        });
      }
      if (scenarioValue && 'artifacts' in scenarioValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Legacy scenario.artifacts is no longer accepted; migrate to entities.artifacts + rules.objective_enforcement'
        });
      }
      if (scenarioValue && 'relationships' in scenarioValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Legacy scenario.relationships is no longer accepted; migrate to entities/authorities or kernel relational fixtures'
        });
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Legacy field scenario is no longer accepted; migrate world initialization to bootstrap.initial_states'
      });
    }
    if ('event_templates' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Legacy field event_templates is no longer accepted; inline events under rules.objective_enforcement[*].then.emit_events'
      });
    }
  })
  .passthrough();

export type SimulationTimeConfig = z.infer<typeof simulationTimeConfigSchema>;
export type WorldPackBootstrapInitialState = z.infer<typeof bootstrapInitialStateSchema>;
export type WorldPackBootstrapInitialEvent = z.infer<typeof bootstrapInitialEventSchema>;
export type WorldPackOpening = z.infer<typeof worldPackOpeningSchema>;
export type WorldPackVariableRecord = Record<string, WorldPackVariableValue>;
export type WorldPackMetadata = z.infer<typeof metadataSchema>;
export type WorldPackAiConfig = z.infer<typeof aiPackConfigSchema>;
export type WorldPackStateTransform = z.infer<typeof stateTransformSchema>;
export type WorldPack = z.infer<typeof worldPackConstitutionSchema>;

export { bootstrapInitialEventSchema, worldPackOpeningSchema, worldPackVariablesRecordSchema };

export const parseWorldPackConstitution = (value: unknown, sourceLabel = 'world pack'): WorldPack => {
  const result = worldPackConstitutionSchema.safeParse(value);
  if (!result.success) {
    const validationError = fromError(result.error);
    throw new Error(`[WorldPackLoader] Invalid ${sourceLabel}: ${validationError.message}`);
  }

  return result.data;
};
