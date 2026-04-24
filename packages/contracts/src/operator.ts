import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

// --- 基础枚举 ---

export const operatorStatusSchema = z.enum(['active', 'disabled', 'suspended'])

export const operatorPackBindingTypeSchema = z.enum([
  'owner',
  'admin',
  'member',
  'spectator'
])

export const operatorAuditActionSchema = z.enum([
  'login',
  'logout',
  'bind_pack',
  'unbind_pack',
  'grant_capability',
  'revoke_grant',
  'capability_denied',
  'pack_access_denied',
  'create_operator',
  'update_operator',
  'delete_operator',
  'bind_agent',
  'unbind_agent'
])

// --- 认证 ---

export const loginRequestSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(128),
    pack_id: z.string().optional()
  })
  .strict()

// --- Operator CRUD ---

export const createOperatorRequestSchema = z
  .object({
    username: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'username must be alphanumeric with dashes and underscores'),
    password: z.string().min(8).max(128),
    display_name: z.string().max(128).optional(),
    is_root: z.boolean().optional()
  })
  .strict()

export const updateOperatorRequestSchema = z
  .object({
    status: operatorStatusSchema.optional(),
    password: z.string().min(8).max(128).optional(),
    display_name: z.string().max(128).optional(),
    is_root: z.boolean().optional()
  })
  .strict()

// --- Pack 绑定 ---

export const createPackBindingRequestSchema = z
  .object({
    operator_id: z.string().min(1),
    binding_type: operatorPackBindingTypeSchema
  })
  .strict()

export const updatePackBindingRequestSchema = z
  .object({
    binding_type: operatorPackBindingTypeSchema
  })
  .strict()

// --- Agent 绑定 ---

export const createAgentBindingRequestSchema = z
  .object({
    operator_id: z.string().min(1),
    role: z.enum(['active', 'atmosphere']).default('active')
  })
  .strict()

// --- 能力委托 ---

export const createOperatorGrantRequestSchema = z
  .object({
    receiver_identity_id: z.string().min(1),
    capability_key: z.string().min(1),
    scope_json: z.unknown().optional(),
    revocable: z.boolean().default(true),
    expires_at: nonNegativeBigIntStringSchema.nullable().optional()
  })
  .strict()

// --- 审计查询 ---

export const operatorAuditLogQuerySchema = z
  .object({
    operator_id: z.string().optional(),
    pack_id: z.string().optional(),
    action: operatorAuditActionSchema.optional(),
    from_date: nonNegativeBigIntStringSchema.optional(),
    to_date: nonNegativeBigIntStringSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional()
  })
  .strict()
