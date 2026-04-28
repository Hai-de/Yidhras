import { z } from 'zod';

const PositiveIntSchema = z.number().int().positive();

export const ClockConfigSchema = z
  .object({
    monotonic_enabled: z.boolean(),
    max_step_ticks: PositiveIntSchema
  })
  .strict();

export type ClockConfig = z.infer<typeof ClockConfigSchema>;

export const CLOCK_DEFAULTS: ClockConfig = {
  monotonic_enabled: true,
  max_step_ticks: 100000
};
