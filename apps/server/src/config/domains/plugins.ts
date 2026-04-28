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
        capability_level: z.enum(['readonly', 'pack_scoped', 'full']),
        max_manifest_size_bytes: z.number().int().positive(),
        max_manifest_depth: z.number().int().positive(),
        max_routes: z.number().int().positive(),
        max_context_sources: z.number().int().positive(),
        warn_on_full_access: z.boolean()
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
    capability_level: 'full',
    max_manifest_size_bytes: 1048576,
    max_manifest_depth: 20,
    max_routes: 16,
    max_context_sources: 32,
    warn_on_full_access: true
  }
};
