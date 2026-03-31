import { z } from 'zod'

import { positiveBigIntStringSchema } from './scalars.js'

export const identityTypeSchema = z.enum([
  'user',
  'agent',
  'system',
  'plugin_reserved',
  'external_reserved'
])

export const identityBindingRoleSchema = z.enum(['active', 'atmosphere'])
export const identityBindingStatusSchema = z.enum(['active', 'inactive', 'expired'])

export const registerIdentityRequestSchema = z.object({
  id: z.string().min(1),
  type: identityTypeSchema,
  name: z.string().optional(),
  claims: z.unknown().optional(),
  metadata: z.unknown().optional()
})

export const createIdentityBindingRequestSchema = z
  .object({
    identity_id: z.string().min(1),
    agent_id: z.string().optional(),
    atmosphere_node_id: z.string().optional(),
    role: identityBindingRoleSchema,
    status: identityBindingStatusSchema.optional(),
    expires_at: z.union([positiveBigIntStringSchema, z.number().int().positive()]).optional()
  })

export const queryIdentityBindingsRequestSchema = z.object({
  identity_id: z.string().min(1),
  role: identityBindingRoleSchema.optional(),
  status: identityBindingStatusSchema.optional(),
  include_expired: z.boolean().optional(),
  agent_id: z.string().optional(),
  atmosphere_node_id: z.string().optional()
})

export const unbindIdentityBindingRequestSchema = z.object({
  binding_id: z.string().min(1),
  status: identityBindingStatusSchema.optional()
})

export const expireIdentityBindingRequestSchema = z.object({
  binding_id: z.string().min(1)
})
