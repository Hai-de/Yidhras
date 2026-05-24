import { z } from 'zod';

const PositiveIntSchema = z.number().int().positive();
const NonEmptyStringSchema = z.string().trim().min(1);
const MultiPackRuntimeStartModeSchema = z.enum(['manual', 'bootstrap_list']);

export const RuntimeMultiPackSchema = z
  .object({
    max_loaded_packs: PositiveIntSchema,
    start_mode: MultiPackRuntimeStartModeSchema,
    bootstrap_packs: z.array(NonEmptyStringSchema)
  })
  .strict();

export const RuntimeSnapshotSchema = z
  .object({
    auto_enabled: z.boolean().default(false),
    interval_ticks: PositiveIntSchema.default(1000),
    retention_count: PositiveIntSchema.max(100).default(20)
  })
  .strict();

export const RuntimeConfig_DomainSchema = z
  .object({
    multi_pack: RuntimeMultiPackSchema,
    metrics_port: z.number().int().min(1024).max(65535).default(9090),
    snapshot: RuntimeSnapshotSchema
  })
  .strict();

export type RuntimeConfig_Domain = z.infer<typeof RuntimeConfig_DomainSchema>;

export const RUNTIME_DEFAULTS: RuntimeConfig_Domain = {
  multi_pack: {
    max_loaded_packs: 2,
    start_mode: 'manual',
    bootstrap_packs: []
  },
  metrics_port: 9090,
  snapshot: {
    auto_enabled: false,
    interval_ticks: 1000,
    retention_count: 20
  }
};
