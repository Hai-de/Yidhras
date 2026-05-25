import { z } from 'zod';

export const PluginsConfigSchema = z
  .object({
    enable_warning: z
      .object({
        enabled: z.boolean(),
        require_acknowledgement: z.boolean()
      })
      .strict(),
    sandbox: z
      .object({
        capability_level: z.enum(['readonly', 'pack_scoped']),
        max_manifest_size_bytes: z.number().int().positive(),
        max_manifest_depth: z.number().int().positive(),
        max_routes: z.number().int().positive(),
        max_context_sources: z.number().int().positive()
      })
      .strict(),
    isolation: z
      .object({
        mode: z.literal('worker'),
        activation_timeout_ms: z.number().int().positive(),
        invocation_timeout_ms: z.number().int().positive(),
        route_timeout_ms: z.number().int().positive(),
        deactivate_timeout_ms: z.number().int().positive(),
        max_consecutive_failures: z.number().int().positive(),
        resource_limits: z
          .object({
            max_old_generation_size_mb: z.number().int().positive(),
            max_young_generation_size_mb: z.number().int().positive(),
            stack_size_mb: z.number().positive()
          })
          .strict()
      })
      .strict(),
    dependency: z
      .object({
        strict: z.boolean()
      })
      .strict()
  })
  .strict();

export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;

export const PLUGINS_DEFAULTS: PluginsConfig = {
  enable_warning: {
    enabled: true,
    require_acknowledgement: true
  },
  sandbox: {
    capability_level: 'pack_scoped',
    max_manifest_size_bytes: 1048576,
    max_manifest_depth: 20,
    max_routes: 16,
    max_context_sources: 32
  },
  isolation: {
    mode: 'worker',
    activation_timeout_ms: 30000,
    invocation_timeout_ms: 5000,
    route_timeout_ms: 10000,
    deactivate_timeout_ms: 5000,
    max_consecutive_failures: 3,
    resource_limits: {
      max_old_generation_size_mb: 128,
      max_young_generation_size_mb: 32,
      stack_size_mb: 4
    }
  },
  dependency: {
    strict: false
  }
};
