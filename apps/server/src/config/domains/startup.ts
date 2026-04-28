import { z } from 'zod';

export const StartupConfigSchema = z
  .object({
    allow_degraded_mode: z.boolean(),
    fail_on_missing_world_pack_dir: z.boolean(),
    fail_on_no_world_pack: z.boolean()
  })
  .strict();

export type StartupConfig = z.infer<typeof StartupConfigSchema>;

export const STARTUP_DEFAULTS: StartupConfig = {
  allow_degraded_mode: true,
  fail_on_missing_world_pack_dir: false,
  fail_on_no_world_pack: false
};
