import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const RuntimeConfigSchema = z
  .object({
    config_version: z.number().int().positive(),
    app: z
      .object({
        name: NonEmptyStringSchema,
        env: NonEmptyStringSchema,
        port: z.number().int().min(1).max(65535)
      })
      .strict(),
    paths: z
      .object({
        world_packs_dir: NonEmptyStringSchema,
        assets_dir: NonEmptyStringSchema,
        plugins_dir: NonEmptyStringSchema
      })
      .strict(),
    world: z
      .object({
        preferred_pack: NonEmptyStringSchema,
        bootstrap: z
          .object({
            enabled: z.boolean(),
            target_pack_dir: NonEmptyStringSchema,
            template_file: NonEmptyStringSchema,
            overwrite: z.boolean()
          })
          .strict()
      })
      .strict(),
    startup: z
      .object({
        allow_degraded_mode: z.boolean(),
        fail_on_missing_world_pack_dir: z.boolean(),
        fail_on_no_world_pack: z.boolean()
      })
      .strict(),
    scheduler: z
      .object({
        enabled: z.boolean()
      })
      .strict(),
    features: z
      .object({
        inference_trace: z.boolean(),
        notifications: z.boolean()
      })
      .strict()
  })
  .strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
