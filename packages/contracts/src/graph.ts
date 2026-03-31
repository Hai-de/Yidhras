import { z } from 'zod'

export const graphViewSchema = z.enum(['mesh', 'tree'])
export const graphNodeKindSchema = z.enum(['agent', 'atmosphere', 'relay', 'container'])

export const graphViewQuerySchema = z.object({
  view: graphViewSchema.optional(),
  root_id: z.string().optional(),
  depth: z.string().optional(),
  kinds: z.union([graphNodeKindSchema, z.array(graphNodeKindSchema)]).optional(),
  include_inactive: z.enum(['true', 'false']).optional(),
  include_unresolved: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  q: z.string().optional()
})
