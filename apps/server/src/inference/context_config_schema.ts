import { z } from 'zod';

const nonEmptyStringSchema = z.string().trim().min(1);

const variableLayerConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    values: z.record(z.string(), z.unknown()).default({}),
    alias_values: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const variableContextConfigSchema = z
  .object({
    layers: z.record(z.string(), variableLayerConfigSchema).optional()
  })
  .strict();

const transmissionProfileDefaultsSchema = z
  .object({
    snr_fallback: z.number().min(0).max(1).optional(),
    delay_ticks_fallback: z.string().optional()
  })
  .strict();

const transmissionProfileThresholdsSchema = z
  .object({
    fragile_snr: z.number().min(0).max(1).optional()
  })
  .strict();

const transmissionProfileDropChancesSchema = z
  .object({
    fragile: z.number().min(0).max(1).optional(),
    best_effort: z.number().min(0).max(1).optional(),
    reliable: z.number().min(0).max(1).optional()
  })
  .strict();

const transmissionProfilePoliciesSchema = z
  .object({
    read_restricted_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional(),
    low_snr_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional(),
    default_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional()
  })
  .strict();

const transmissionProfileConfigSchema = z
  .object({
    defaults: transmissionProfileDefaultsSchema.optional(),
    thresholds: transmissionProfileThresholdsSchema.optional(),
    drop_chances: transmissionProfileDropChancesSchema.optional(),
    policies: transmissionProfilePoliciesSchema.optional()
  })
  .strict();

const policyEvaluationConfigSchema = z
  .object({
    resource: nonEmptyStringSchema,
    action: nonEmptyStringSchema,
    fields: z.array(nonEmptyStringSchema)
  })
  .strict();

const policySummaryConfigSchema = z
  .object({
    evaluations: z.array(policyEvaluationConfigSchema).optional()
  })
  .strict();

export const inferenceContextConfigSchema = z
  .object({
    config_version: z.number().int().positive(),
    variable_context: variableContextConfigSchema.optional(),
    transmission_profile: transmissionProfileConfigSchema.optional(),
    policy_summary: policySummaryConfigSchema.optional()
  })
  .strict();

export type InferenceContextConfig = z.infer<typeof inferenceContextConfigSchema>;
export type VariableLayerConfig = z.infer<typeof variableLayerConfigSchema>;
export type VariableContextConfig = z.infer<typeof variableContextConfigSchema>;
export type TransmissionProfileConfig = z.infer<typeof transmissionProfileConfigSchema>;
export type PolicySummaryConfig = z.infer<typeof policySummaryConfigSchema>;
export type PolicyEvaluationConfig = z.infer<typeof policyEvaluationConfigSchema>;
