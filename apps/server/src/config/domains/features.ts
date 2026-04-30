import { z } from 'zod';

export const FeaturesConfigSchema = z
  .object({
    ai_gateway_enabled: z.boolean(),
    inference_trace: z.boolean(),
    notifications: z.boolean(),
    experimental: z
      .object({
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
    prompt_slot_permissions: false
  }
};
