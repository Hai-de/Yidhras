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
  | WorldPackVariableValue[]
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
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(worldPackVariableValueSchema),
    z.record(z.string(), worldPackVariableValueSchema)
  ])
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
    tasks: z.partialRecord(aiTaskTypeSchema, aiTaskOverrideSchema).optional(),
    slots: z
      .record(z.string(),
        z
          .object({
            display_name: nonEmptyStringSchema,
            description: nonEmptyStringSchema.optional(),
            default_priority: z.number().int().min(0),
            position: z.number().int().nullable().optional(),
            anchor: z
              .object({
                ref: z.string().min(1),
                relation: z.enum(['after', 'before'])
              })
              .nullable()
              .optional(),
            default_template: nonEmptyStringSchema.nullish(),
            template_context: z.enum(['inference', 'world_prompts', 'pack_state', 'none']).optional(),
            message_role: z.enum(['system', 'developer', 'user']).optional(),
            include_in_combined: z.boolean(),
            combined_heading: nonEmptyStringSchema.nullish(),
            enabled: z.boolean(),
            metadata: z.record(z.string(), z.unknown()).optional()
          })
          .strict()
      )
      .optional()
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
        code: "custom",
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
    step: z
      .object({
        strategy: z.enum(['variable', 'adaptive']),
        range: z.object({
          min: tickLikeSchema,
          max: tickLikeSchema
        }),
        loop_interval_ms: z.number().int().positive().optional(),
        adaptive: z
          .object({
            target_loop_ms: z.number().int().positive(),
            scale_up_threshold_ms: z.number().int().positive(),
            scale_down_threshold_ms: z.number().int().positive()
          })
          .optional()
      })
      .optional()
  })
  .strict();

const metadataLinkSchema = z.union([z.url(), nonEmptyStringSchema]);

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

const packFrontendManifestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('default') }),
  z.object({
    type: z.literal('custom'),
    entry: nonEmptyStringSchema
  })
]);

const metadataSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional(),
    instance_id: nonEmptyStringSchema.optional(),
    authors: z.array(metadataAuthorSchema).optional(),
    license: nonEmptyStringSchema.optional(),
    homepage: metadataLinkSchema.optional(),
    repository: metadataLinkSchema.optional(),
    tags: z.array(nonEmptyStringSchema).optional(),
    presentation: metadataPresentationSchema.optional(),
    frontend: packFrontendManifestSchema.optional(),
    published_at: nonEmptyStringSchema.optional(),
    status: nonEmptyStringSchema.optional()
  })
  .loose();

const constitutionSchema = z
  .object({
    axioms: z.array(nonEmptyStringSchema).default([]),
    namespaces: z.array(nonEmptyStringSchema).default([])
  })
  .strict()
  .default({ axioms: [], namespaces: [] });

const actorInferenceSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('behavior_tree'),
      behavior_tree: nonEmptyStringSchema
    })
    .strict(),
  z
    .object({
      provider: z.literal('openai_compatible'),
      model: nonEmptyStringSchema
    })
    .strict(),
  z
    .object({
      provider: z.literal('anthropic'),
      model: nonEmptyStringSchema
    })
    .strict()
]);

export type ActorInferenceConfig = z.infer<typeof actorInferenceSchema>;

const workflowTriggerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('manual')
    })
    .strict(),
  z
    .object({
      type: z.literal('event'),
      event_types: z.array(nonEmptyStringSchema).min(1)
    })
    .strict()
]);

const workflowConditionSchema = z
  .object({
    field: nonEmptyStringSchema,
    op: z.enum(['eq', 'neq']),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()])
  })
  .strict();

const workflowStepSchema = z
  .object({
    id: nonEmptyStringSchema,
    agent: nonEmptyStringSchema,
    depends_on: z.array(nonEmptyStringSchema).optional(),
    input_from: z.array(nonEmptyStringSchema).optional(),
    condition: workflowConditionSchema.optional(),
    inference: actorInferenceSchema
  })
  .strict();

const validateWorkflowDag = (workflowName: string, steps: Array<z.infer<typeof workflowStepSchema>>, ctx: z.RefinementCtx): void => {
  const stepIds = steps.map(step => step.id);
  const stepIdSet = new Set(stepIds);
  if (stepIdSet.size !== stepIds.length) {
    ctx.addIssue({
      code: "custom",
      message: `workflow "${workflowName}" step ids must be unique`,
      path: [workflowName, 'steps']
    });
  }

  const declaredIndexByStepId = new Map(stepIds.map((stepId, index) => [stepId, index]));
  const dependencyMap = new Map<string, string[]>();

  for (const [index, step] of steps.entries()) {
    const dependsOn = step.depends_on ?? [];
    dependencyMap.set(step.id, dependsOn);
    for (const dependencyStepId of dependsOn) {
      if (!stepIdSet.has(dependencyStepId)) {
        ctx.addIssue({
          code: "custom",
          message: `workflow "${workflowName}" step "${step.id}" depends_on references unknown step "${dependencyStepId}"`,
          path: [workflowName, 'steps', index, 'depends_on']
        });
      }
    }

    for (const inputStepId of step.input_from ?? []) {
      const inputIndex = declaredIndexByStepId.get(inputStepId);
      if (inputIndex === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `workflow "${workflowName}" step "${step.id}" input_from references unknown step "${inputStepId}"`,
          path: [workflowName, 'steps', index, 'input_from']
        });
        continue;
      }
      if (inputIndex >= index) {
        ctx.addIssue({
          code: "custom",
          message: `workflow "${workflowName}" step "${step.id}" input_from must reference an earlier step; "${inputStepId}" is not earlier in declaration order`,
          path: [workflowName, 'steps', index, 'input_from']
        });
      }
    }
  }

  const collectDependencyClosure = (stepId: string, seen = new Set<string>()): Set<string> => {
    for (const dependencyStepId of dependencyMap.get(stepId) ?? []) {
      if (!seen.has(dependencyStepId)) {
        seen.add(dependencyStepId);
        collectDependencyClosure(dependencyStepId, seen);
      }
    }
    return seen;
  };

  for (const [index, step] of steps.entries()) {
    const dependencyClosure = collectDependencyClosure(step.id);
    for (const inputStepId of step.input_from ?? []) {
      if (stepIdSet.has(inputStepId) && !dependencyClosure.has(inputStepId)) {
        ctx.addIssue({
          code: "custom",
          message: `workflow "${workflowName}" step "${step.id}" input_from must reference a dependency predecessor; "${inputStepId}" is not in depends_on closure`,
          path: [workflowName, 'steps', index, 'input_from']
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visiting.has(stepId)) return false;
    if (visited.has(stepId)) return true;
    visiting.add(stepId);
    for (const dependencyStepId of dependencyMap.get(stepId) ?? []) {
      if (stepIdSet.has(dependencyStepId) && !visit(dependencyStepId)) return false;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return true;
  };

  for (const stepId of stepIds) {
    if (!visit(stepId)) {
      ctx.addIssue({ code: "custom", message: `workflow "${workflowName}" depends_on graph must be acyclic`, path: [workflowName, 'steps'] });
      break;
    }
  }
};

const workflowDefinitionSchema = z
  .object({
    trigger: workflowTriggerSchema,
    steps: z.array(workflowStepSchema).min(1),
    failure_policy: z.literal('narrativize').optional(),
    max_ticks: z.number().int().positive(),
    lock_policy: z.literal('active_steps').optional()
  })
  .strict();

const workflowsSchema = z.record(nonEmptyStringSchema, workflowDefinitionSchema).superRefine((workflows, ctx) => {
  for (const [workflowName, workflow] of Object.entries(workflows)) {
    validateWorkflowDag(workflowName, workflow.steps, ctx);
  }
});

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
    metadata: z.record(z.string(), worldPackValueSchema).optional(),
    inference: actorInferenceSchema.optional()
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
    collectives: z.array(entityDefinitionSchema).default([]),
    artifacts: z.array(entityDefinitionSchema).default([]),
    mediators: z.array(mediatorDefinitionSchema).default([]),
    domains: z.array(entityDefinitionSchema).default([]),
    institutions: z.array(entityDefinitionSchema).default([])
  })
  .strict()
  .default({
    actors: [],
    collectives: [],
    artifacts: [],
    mediators: [],
    domains: [],
    institutions: []
  })
  .superRefine((value, ctx) => {
    const allEntityIds = [
      ...value.actors.map(item => item.id),
      ...value.collectives.map(item => item.id),
      ...value.artifacts.map(item => item.id),
      ...value.mediators.map(item => item.id),
      ...value.domains.map(item => item.id),
      ...value.institutions.map(item => item.id)
    ];
    const uniqueIds = new Set(allEntityIds);
    if (uniqueIds.size !== allEntityIds.length) {
      ctx.addIssue({
        code: "custom",
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
    mediator_id: nonEmptyStringSchema.optional(),
    entity_type: nonEmptyStringSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.kind === 'holder_of' ||
      value.kind === 'binding_of' ||
      value.kind === 'direct_entity' ||
      value.kind === 'domain_owner' ||
      value.kind === 'member_of'
    ) {
      if (!value.entity_id) {
        ctx.addIssue({
          code: "custom",
          message: `target selector kind=${value.kind} requires entity_id`
        });
      }
    }
    if (value.kind === 'subject_entity' && !value.entity_id && !value.identity_id) {
      ctx.addIssue({
        code: "custom",
        message: 'target selector kind=subject_entity requires entity_id or identity_id'
      });
    }
    if (value.kind === 'entity_type_is' && !value.entity_type) {
      ctx.addIssue({
        code: "custom",
        message: 'target selector kind=entity_type_is requires entity_type'
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    if (KERNEL_INTENT_TYPES.includes(value as (typeof KERNEL_INTENT_TYPES)[number])) {
      return;
    }
    if (!value.startsWith('invoke.')) {
      ctx.addIssue({
        code: "custom",
        message: `invocation_type '${value}' must use 'invoke.' prefix for capability-key matching in the enforcement pipeline. Expected format: 'invoke.${value}'. Kernel actions (${KERNEL_INTENT_TYPES.join(', ')}) are exempt.`
      });
    }
  }
});

const objectiveEnforcementRuleSchema = worldRuleDefinitionSchema.extend({
  when: objectiveEnforcementWhenSchema
});

const perceptionWhenSchema = z
  .object({
    observer_at: z.enum(['same', 'adjacent', 'any']).optional(),
    event_visibility: z.enum(['public', 'private']).optional(),
    observer_is_actor: z.boolean().optional(),
    investigation_count_min: z.number().int().min(0).optional(),
    observer_has_capability: z.string().optional()
  })
  .loose();

const perceptionThenSchema = z
  .object({
    level: z.enum(['full', 'partial', 'none']),
    reveal_public: z.boolean().optional(),
    reveal_hidden: z.boolean().optional(),
    max_hidden_segments: z.number().int().min(0).optional()
  })
  .loose();

const perceptionRuleSchema = z
  .object({
    id: nonEmptyStringSchema,
    when: perceptionWhenSchema,
    then: perceptionThenSchema
  })
  .strict();

const projectionWhenSchema = z
  .object({
    tick_interval: z.number().int().positive().optional(),
    on_event_type: nonEmptyStringSchema.optional(),
    entity_type_is: nonEmptyStringSchema.optional()
  })
  .loose()

const projectionThenSchema = z
  .object({
    compute: z.enum(['count', 'sum', 'max', 'min', 'collect']),
    source_entity_type: nonEmptyStringSchema.optional(),
    source_state_key: nonEmptyStringSchema.optional(),
    source_collection: nonEmptyStringSchema.optional(),
    target_projection: nonEmptyStringSchema,
    aggregate_by: z.array(nonEmptyStringSchema).optional(),
    filter_condition: z.record(z.string(), worldPackValueSchema).optional()
  })
  .loose()

const projectionRuleSchema = z
  .object({
    id: nonEmptyStringSchema,
    when: projectionWhenSchema,
    then: projectionThenSchema
  })
  .strict()

const rulesSchema = z
  .object({
    perception: z.array(perceptionRuleSchema).default([]),
    capability_resolution: z.array(worldRuleDefinitionSchema).default([]),
    invocation: z.array(worldRuleDefinitionSchema).default([]),
    objective_enforcement: z.array(objectiveEnforcementRuleSchema).default([]),
    projection: z.array(projectionRuleSchema).default([])
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
    initial_events: z.array(bootstrapInitialEventSchema).default([])
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
          code: "custom",
          message: `state_transform range min (${range.min}) must be <= max (${range.max}) for label "${range.label}"`
        });
      }
    }
    const labels = ranges.map(r => r.label);
    const uniqueLabels = new Set(labels);
    if (uniqueLabels.size !== labels.length) {
      ctx.addIssue({
        code: "custom",
        message: 'state_transform range labels must be unique'
      });
    }
  });

export const spatialDiscreteLocationSchema = z
  .object({
    id: nonEmptyStringSchema
  })
  .strict();

export const spatialDiscreteEdgeSchema = z
  .object({
    from: nonEmptyStringSchema,
    to: nonEmptyStringSchema,
    type: z.enum(['bidirectional', 'directed']).default('bidirectional'),
    weight: z.number().positive().default(1)
  })
  .strict();

export const spatialDiscreteSchema = z
  .object({
    model: z.literal('discrete'),
    locations: z.array(spatialDiscreteLocationSchema).min(1),
    edges: z.array(spatialDiscreteEdgeSchema).default([])
  })
  .strict();

export const spatialSchema = z.discriminatedUnion('model', [spatialDiscreteSchema]);

const includeValueSchema = z.string().min(1);

const includeSchema = z.record(z.string().min(1), includeValueSchema).optional();

export const VALID_INCLUDE_SECTION_KEYS = [
  'schema_version',
  'metadata',
  'constitution',
  'variables',
  'prompts',
  'ai',
  'time_systems',
  'simulation_time',
  'entities',
  'identities',
  'capabilities',
  'authorities',
  'rules',
  'storage',
  'scheduler',
  'bootstrap',
  'state_transforms',
  'spatial',
  'workflows'
] as const;

export type ValidIncludeSectionKey = (typeof VALID_INCLUDE_SECTION_KEYS)[number];

export type WorldPackInclude = z.infer<typeof includeSchema>;

export const worldPackConstitutionSchema = z
  .object({
    schema_version: z.number().int().nonnegative().default(0),
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
    state_transforms: z.array(stateTransformSchema).optional(),
    spatial: spatialSchema.optional(),
    workflows: workflowsSchema.optional(),
    include: includeSchema
  })
  .superRefine((value, ctx) => {
    if ('actions' in value) {
      ctx.addIssue({
        code: "custom",
        message: 'Legacy field actions is no longer accepted; migrate to rules.objective_enforcement + capabilities/authorities'
      });
    }
    if ('decision_rules' in value) {
      ctx.addIssue({
        code: "custom",
        message: 'Legacy field decision_rules is no longer accepted; migrate to unified rules.* definitions'
      });
    }

    const entityIds = new Set<string>();
    if (value.entities) {
      for (const actor of value.entities.actors) {
        entityIds.add(actor.id);
      }
      for (const collective of value.entities.collectives) {
        entityIds.add(collective.id);
      }
      for (const domain of value.entities.domains) {
        entityIds.add(domain.id);
      }
      for (const artifact of value.entities.artifacts) {
        entityIds.add(artifact.id);
      }
      for (const institution of value.entities.institutions) {
        entityIds.add(institution.id);
      }
      for (const mediator of value.entities.mediators) {
        entityIds.add(mediator.id);
      }
    }

    if (value.identities) {
      for (const identity of value.identities) {
        if (!entityIds.has(identity.subject_entity_id)) {
          ctx.addIssue({
            code: "custom",
            message: `identity "${identity.id}" references unknown actor "${identity.subject_entity_id}" in subject_entity_id`,
            path: ['identities']
          });
        }
      }
    }

    if (value.spatial && value.entities?.domains) {
      const domainIds = new Set(value.entities.domains.map((d) => d.id));
      for (const location of value.spatial.locations) {
        if (!domainIds.has(location.id)) {
          ctx.addIssue({
            code: "custom",
            message: `spatial.location "${location.id}" must reference an entity in entities.domains`,
            path: ['spatial', 'locations']
          });
        }
      }
      for (const edge of value.spatial.edges) {
        if (!domainIds.has(edge.from)) {
          ctx.addIssue({
            code: "custom",
            message: `spatial.edge.from "${edge.from}" must reference an entity in entities.domains`,
            path: ['spatial', 'edges']
          });
        }
        if (!domainIds.has(edge.to)) {
          ctx.addIssue({
            code: "custom",
            message: `spatial.edge.to "${edge.to}" must reference an entity in entities.domains`,
            path: ['spatial', 'edges']
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
            code: "custom",
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
          code: "custom",
          message: 'Legacy scenario.agents is no longer accepted; migrate to entities.actors + identities/authorities'
        });
      }
      if (scenarioValue && 'artifacts' in scenarioValue) {
        ctx.addIssue({
          code: "custom",
          message: 'Legacy scenario.artifacts is no longer accepted; migrate to entities.artifacts + rules.objective_enforcement'
        });
      }
      if (scenarioValue && 'relationships' in scenarioValue) {
        ctx.addIssue({
          code: "custom",
          message: 'Legacy scenario.relationships is no longer accepted; migrate to entities/authorities or kernel relational fixtures'
        });
      }
      ctx.addIssue({
        code: "custom",
        message: 'Legacy field scenario is no longer accepted; migrate world initialization to bootstrap.initial_states'
      });
    }
    if ('event_templates' in value) {
      ctx.addIssue({
        code: "custom",
        message: 'Legacy field event_templates is no longer accepted; inline events under rules.objective_enforcement[*].then.emit_events'
      });
    }
  })
  .loose();

export type SimulationTimeConfig = z.infer<typeof simulationTimeConfigSchema>;
export type WorldPackBootstrapInitialState = z.infer<typeof bootstrapInitialStateSchema>;
export type WorldPackBootstrapInitialEvent = z.infer<typeof bootstrapInitialEventSchema>;
export type WorldPackOpening = z.infer<typeof worldPackOpeningSchema>;
export type WorldPackVariableRecord = Record<string, WorldPackVariableValue>;
export type WorldPackMetadata = z.infer<typeof metadataSchema>;
export type WorldPackAiConfig = z.infer<typeof aiPackConfigSchema>;
export type WorldPackStateTransform = z.infer<typeof stateTransformSchema>;
export type WorldPack = z.infer<typeof worldPackConstitutionSchema>;
export type WorldPackWorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorldPackWorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorldPackWorkflowTrigger = z.infer<typeof workflowTriggerSchema>;
export type WorldPackWorkflowCondition = z.infer<typeof workflowConditionSchema>;

export { bootstrapInitialEventSchema, worldPackOpeningSchema, worldPackVariablesRecordSchema };

export const parseWorldPackConstitution = (value: unknown, sourceLabel = 'world pack'): WorldPack => {
  const result = worldPackConstitutionSchema.safeParse(value);
  if (!result.success) {
    const validationError = fromError(result.error);
    throw new Error(`[WorldPackLoader] Invalid ${sourceLabel}: ${validationError.message}`);
  }

  return result.data;
};
