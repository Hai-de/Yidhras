import { z } from 'zod';
import { fromError } from 'zod-validation-error';

const NonEmptyStringSchema = z.string().trim().min(1);

export type WorldPackVariableValue =
  | string
  | number
  | boolean
  | {
      [key: string]: WorldPackVariableValue;
    };

const WorldPackVariableValueSchema: z.ZodType<WorldPackVariableValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.string(), WorldPackVariableValueSchema)
  ])
);

export type WorldPackScenarioValue =
  | string
  | number
  | boolean
  | null
  | WorldPackScenarioValue[]
  | {
      [key: string]: WorldPackScenarioValue;
    };

const WorldPackScenarioValueSchema: z.ZodType<WorldPackScenarioValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(WorldPackScenarioValueSchema),
    z.record(z.string(), WorldPackScenarioValueSchema)
  ])
);

const TimeUnitSchema = z
  .object({
    name: NonEmptyStringSchema,
    ratio: z.number().int().positive().optional(),
    irregular_ratios: z.array(z.number().int().positive()).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ratio === undefined && value.irregular_ratios === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'time unit requires ratio or irregular_ratios' });
    }
  });

const CalendarConfigSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    is_primary: z.boolean().optional(),
    tick_rate: z.number().int().positive(),
    units: z.array(TimeUnitSchema)
  })
  .strict();

const TickLikeSchema = z.union([NonEmptyStringSchema, z.number().int()]);

export const SimulationTimeConfigSchema = z
  .object({
    min_tick: TickLikeSchema.optional(),
    max_tick: TickLikeSchema.optional(),
    initial_tick: TickLikeSchema.optional(),
    step_ticks: TickLikeSchema.optional()
  })
  .strict();

const ScenarioIdentityConfigSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    name: NonEmptyStringSchema.optional(),
    provider: NonEmptyStringSchema.optional(),
    status: NonEmptyStringSchema.optional(),
    claims: z.record(z.string(), WorldPackScenarioValueSchema).optional(),
    metadata: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

const ScenarioAgentConfigSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    identity: ScenarioIdentityConfigSchema.optional(),
    roles: z.array(NonEmptyStringSchema).optional(),
    state: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

const ScenarioRelationshipConfigSchema = z
  .object({
    from_id: NonEmptyStringSchema,
    to_id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    weight: z.number().finite()
  })
  .strict();

const ScenarioArtifactConfigSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    state: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

const WorldPackScenarioConfigSchema = z
  .object({
    agents: z.array(ScenarioAgentConfigSchema).optional(),
    relationships: z.array(ScenarioRelationshipConfigSchema).optional(),
    artifacts: z.array(ScenarioArtifactConfigSchema).optional(),
    world_state: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

const WorldPackEventTemplateConfigSchema = z
  .object({
    type: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    impact_data: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

export const WorldPackActionExecutorSchema = z.enum(['claim_artifact', 'set_actor_state', 'emit_event']);

const WorldPackActionConfigSchema = z
  .object({
    executor: WorldPackActionExecutorSchema,
    defaults: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

const WorldPackDecisionRuleConditionSchema = z
  .object({
    actor_has_artifact: NonEmptyStringSchema.optional(),
    actor_state: z.record(z.string(), WorldPackScenarioValueSchema).optional(),
    world_state: z.record(z.string(), WorldPackScenarioValueSchema).optional(),
    latest_event: z
      .object({
        semantic_type: NonEmptyStringSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict();

const WorldPackDecisionRuleDecideSchema = z
  .object({
    action_type: NonEmptyStringSchema,
    target_ref: z.record(z.string(), WorldPackScenarioValueSchema).nullable().optional(),
    payload: z.record(z.string(), WorldPackScenarioValueSchema).optional()
  })
  .strict();

const WorldPackDecisionRuleConfigSchema = z
  .object({
    id: NonEmptyStringSchema,
    priority: z.number().int(),
    when: WorldPackDecisionRuleConditionSchema,
    decide: WorldPackDecisionRuleDecideSchema
  })
  .strict();

export const WorldPackSchema = z
  .object({
    metadata: z
      .object({
        id: NonEmptyStringSchema,
        name: NonEmptyStringSchema,
        version: NonEmptyStringSchema
      })
      .passthrough(),
    variables: z.record(z.string(), WorldPackVariableValueSchema).optional(),
    prompts: z.record(z.string(), z.string()).optional(),
    time_systems: z.array(CalendarConfigSchema).optional(),
    simulation_time: SimulationTimeConfigSchema.optional(),
    scenario: WorldPackScenarioConfigSchema.optional(),
    event_templates: z.record(z.string(), WorldPackEventTemplateConfigSchema).optional(),
    actions: z.record(z.string(), WorldPackActionConfigSchema).optional(),
    decision_rules: z.array(WorldPackDecisionRuleConfigSchema).optional()
  })
  .passthrough();

export type SimulationTimeConfig = z.infer<typeof SimulationTimeConfigSchema>;
export type ScenarioIdentityConfig = z.infer<typeof ScenarioIdentityConfigSchema>;
export type WorldPackScenarioAgentConfig = z.infer<typeof ScenarioAgentConfigSchema>;
export type WorldPackScenarioRelationshipConfig = z.infer<typeof ScenarioRelationshipConfigSchema>;
export type WorldPackScenarioArtifactConfig = z.infer<typeof ScenarioArtifactConfigSchema>;
export type WorldPackScenarioConfig = z.infer<typeof WorldPackScenarioConfigSchema>;
export type WorldPackEventTemplateConfig = z.infer<typeof WorldPackEventTemplateConfigSchema>;
export type WorldPackActionExecutor = z.infer<typeof WorldPackActionExecutorSchema>;
export type WorldPackActionConfig = z.infer<typeof WorldPackActionConfigSchema>;
export type WorldPackDecisionRuleConditionConfig = z.infer<typeof WorldPackDecisionRuleConditionSchema>;
export type WorldPackDecisionRuleDecideConfig = z.infer<typeof WorldPackDecisionRuleDecideSchema>;
export type WorldPackDecisionRuleConfig = z.infer<typeof WorldPackDecisionRuleConfigSchema>;
export type WorldPack = z.infer<typeof WorldPackSchema>;

export const parseWorldPack = (value: unknown, sourceLabel = 'world pack'): WorldPack => {
  const result = WorldPackSchema.safeParse(value);
  if (!result.success) {
    const validationError = fromError(result.error);
    throw new Error(`[WorldPackLoader] Invalid ${sourceLabel}: ${validationError.message}`);
  }

  return result.data;
};
