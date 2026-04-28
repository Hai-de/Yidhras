import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveIntSchema = z.number().int().positive();

export const WorldEngineConfigSchema = z
  .object({
    timeout_ms: PositiveIntSchema,
    binary_path: NonEmptyStringSchema,
    auto_restart: z.boolean()
  })
  .strict();

export type WorldEngineConfig = z.infer<typeof WorldEngineConfigSchema>;

export const WORLD_ENGINE_DEFAULTS: WorldEngineConfig = {
  timeout_ms: 500,
  binary_path: 'apps/server/rust/world_engine_sidecar/target/debug/world_engine_sidecar',
  auto_restart: true
};
