import { z } from 'zod';

const ExperimentalMultiPackRuntimeSchema = z
  .object({
    enabled: z.boolean(),
    operator_api_enabled: z.boolean(),
    ui_enabled: z.boolean()
  })
  .strict();

export const FeaturesConfigSchema = z
  .object({
    ai_gateway_enabled: z.boolean(),
    inference_trace: z.boolean(),
    notifications: z.boolean(),
    experimental: z
      .object({
        multi_pack_runtime: ExperimentalMultiPackRuntimeSchema,
        prompt_slot_permissions: z.boolean().optional().default(false)
      })
      .strict()
  })
  .strict();

export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;

export const FEATURES_DEFAULTS: FeaturesConfig = {
  ai_gateway_enabled: false,
  inference_trace: true,
  notifications: true,
  experimental: {
    prompt_slot_permissions: false,
    multi_pack_runtime: {
      enabled: false,
      operator_api_enabled: false,
      ui_enabled: false
    }
  }
};
