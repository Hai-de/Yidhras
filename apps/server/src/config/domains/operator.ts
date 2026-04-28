import { z } from 'zod';

const OperatorAuthConfigSchema = z
  .object({
    jwt_secret: z.string().trim().min(16),
    jwt_expires_in: z.string().trim().min(1),
    bcrypt_rounds: z.number().int().min(4).max(16)
  })
  .strict();

const OperatorRootConfigSchema = z
  .object({
    default_password: z.string().trim().min(8)
  })
  .strict();

export const OperatorConfigSchema = z
  .object({
    auth: OperatorAuthConfigSchema,
    root: OperatorRootConfigSchema
  })
  .strict();

export type OperatorConfig = z.infer<typeof OperatorConfigSchema>;

export const OPERATOR_DEFAULTS: OperatorConfig = {
  auth: {
    jwt_secret: 'changeme-please-replace-with-a-secure-random-string',
    jwt_expires_in: '24h',
    bcrypt_rounds: 12
  },
  root: {
    default_password: 'changeme-root-password'
  }
};
