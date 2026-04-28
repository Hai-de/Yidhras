import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const WorldConfigSchema = z
  .object({
    preferred_pack: NonEmptyStringSchema,
    preferred_opening: NonEmptyStringSchema.optional(),
    bootstrap: z
      .object({
        enabled: z.boolean(),
        target_pack_dir: NonEmptyStringSchema,
        template_file: NonEmptyStringSchema,
        overwrite: z.boolean()
      })
      .strict()
  })
  .strict();

export type WorldConfig = z.infer<typeof WorldConfigSchema>;

export const WORLD_DEFAULTS: WorldConfig = {
  preferred_pack: 'example_pack',
  bootstrap: {
    enabled: true,
    target_pack_dir: 'example_pack',
    template_file: 'data/configw/templates/world-pack/example_pack.yaml',
    overwrite: false
  }
};
