import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const AppConfigSchema = z
  .object({
    name: NonEmptyStringSchema,
    env: NonEmptyStringSchema,
    port: z.number().int().min(1).max(65535)
  })
  .strict();

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const APP_DEFAULTS: AppConfig = {
  name: 'Yidhras',
  env: 'development',
  port: 3001
};
