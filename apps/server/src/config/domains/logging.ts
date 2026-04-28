import { z } from 'zod';

export const LoggingConfigSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    format: z.enum(['text', 'json'])
  })
  .strict();

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const LOGGING_DEFAULTS: LoggingConfig = {
  level: 'info',
  format: 'text'
};
