import { z } from 'zod';

const nonEmptyStringSchema = z.string().min(1);

const btConditionScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const btConditionExprSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.record(z.string(), btConditionScalarSchema)
);

const btConditionSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.union([btConditionExprSchema, btCompoundConditionSchema])
);

// @ts-expect-error -- EOPT strict mode
const btCompoundConditionSchema: z.ZodType<{ all?: Record<string, unknown>[]; any?: Record<string, unknown>[] }> = z.lazy(() =>
  z.object({
    all: z.array(btConditionSchema).optional(),
    any: z.array(btConditionSchema).optional()
  }).refine(
    (val) => val.all !== undefined || val.any !== undefined,
    { message: 'Compound condition must have at least one of "all" or "any"' }
  )
);

const btDecoratorDefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inverter')
  }).strict(),
  z.object({
    type: z.literal('cooldown'),
    cooldown_ticks: z.number().int().positive()
  }).strict(),
  z.object({
    type: z.literal('probability'),
    weight: z.number().min(0).max(1)
  }).strict()
]);

const btActionDefSchema = z.object({
  semantic_intent: nonEmptyStringSchema.optional(),
  kernel: nonEmptyStringSchema.optional(),
  proposed_method: nonEmptyStringSchema.optional(),
  target_ref: z.object({
    entity_id: nonEmptyStringSchema,
    kind: nonEmptyStringSchema
  }).optional(),
  reasoning: z.string().optional(),
  desired_effect: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  call_handler: nonEmptyStringSchema.optional()
}).refine(
  (val) => val.semantic_intent !== undefined || val.kernel !== undefined,
  { message: 'Action must have at least one of "semantic_intent" or "kernel"' }
);

export const btNodeDefSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.enum(['selector', 'sequence', 'condition', 'action', 'llm_decision']).optional(),
    children: z.array(z.lazy(() => btNodeDefSchema)).optional(),
    decorators: z.array(btDecoratorDefSchema).optional(),
    child: z.lazy(() => btNodeDefSchema).optional(),
    condition: btConditionSchema.optional(),
    action: btActionDefSchema.optional(),
    prompt_template: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    $ref: z.string().optional()
  }).refine(
    (val) => {
      if (val.$ref !== undefined) return true;
      if (val.type === 'selector' || val.type === 'sequence') {
        return val.children !== undefined && val.children.length > 0;
      }
      return true;
    },
    { message: 'Selector and Sequence nodes must have non-empty children' }
  ).refine(
    (val) => {
      if (val.type === 'condition') return val.condition !== undefined;
      if (val.type === 'action') return val.action !== undefined;
      if (val.type === 'llm_decision') return val.prompt_template !== undefined;
      return true;
    },
    { message: 'Leaf nodes must have their required fields (condition/action/prompt_template)' }
  )
);

export const btTreeMapSchema = z.record(nonEmptyStringSchema, btNodeDefSchema);

export const actorInferenceSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('behavior_tree'),
    behavior_tree: nonEmptyStringSchema
  }).strict(),
  z.object({
    provider: z.literal('openai_compatible'),
    model: nonEmptyStringSchema
  }).strict(),
  z.object({
    provider: z.literal('anthropic'),
    model: nonEmptyStringSchema
  }).strict()
]);

export type ActorInferenceConfig = z.infer<typeof actorInferenceSchema>;
