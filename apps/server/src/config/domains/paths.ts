import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

const AiModelsConfigPathSchema = z
  .string()
  .trim()
  .min(1)
  .default('apps/server/config/ai_models.yaml');

export const PathsConfigSchema = z
  .object({
    world_packs_dir: NonEmptyStringSchema,
    assets_dir: NonEmptyStringSchema,
    plugins_dir: NonEmptyStringSchema,
    ai_models_config: AiModelsConfigPathSchema
  })
  .strict();

export type PathsConfig = z.infer<typeof PathsConfigSchema>;

export const PATHS_DEFAULTS: PathsConfig = {
  world_packs_dir: 'data/world_packs',
  assets_dir: 'data/assets',
  plugins_dir: 'data/plugins',
  ai_models_config: 'apps/server/config/ai_models.yaml'
};
