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

const metadataSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional()
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

const rulesSchema = z
  .object({
    perception: z.array(worldRuleDefinitionSchema).default([]),
    capability_resolution: z.array(worldRuleDefinitionSchema).default([]),
    invocation: z.array(worldRuleDefinitionSchema).default([]),
    objective_enforcement: z.array(worldRuleDefinitionSchema).default([]),
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

const bootstrapSchema = z
  .object({
    initial_states: z.array(bootstrapInitialStateSchema).default([]),
    initial_events: z.array(worldPackValueSchema).default([])
  })
  .strict()
  .default({ initial_states: [], initial_events: [] });

export const worldPackConstitutionSchema = z
  .object({
    metadata: metadataSchema,
    constitution: constitutionSchema.optional(),
    variables: z.record(z.string(), worldPackVariableValueSchema).optional(),
    prompts: z.record(z.string(), z.string()).optional(),
    time_systems: z.array(calendarConfigSchema).optional(),
    simulation_time: simulationTimeConfigSchema.optional(),
    entities: entitiesSchema.optional(),
    identities: z.array(identityDefinitionSchema).optional(),
    capabilities: z.array(capabilityDefinitionSchema).optional(),
    authorities: z.array(authorityDefinitionSchema).optional(),
    rules: rulesSchema.optional(),
    storage: worldPackStorageSchema.optional(),
    bootstrap: bootstrapSchema.optional()
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
export type WorldPackVariableRecord = Record<string, WorldPackVariableValue>;
export type WorldPack = z.infer<typeof worldPackConstitutionSchema>;

export const parseWorldPackConstitution = (value: unknown, sourceLabel = 'world pack'): WorldPack => {
  const result = worldPackConstitutionSchema.safeParse(value);
  if (!result.success) {
    const validationError = fromError(result.error);
    throw new Error(`[WorldPackLoader] Invalid ${sourceLabel}: ${validationError.message}`);
  }

  return result.data;
};
