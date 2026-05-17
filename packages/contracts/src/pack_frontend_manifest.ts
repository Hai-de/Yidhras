import { z } from 'zod'

export const PackFrontendTypeSchema = z.enum(['default', 'custom'])

export const PackFrontendManifestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('default') }),
  z.object({
    type: z.literal('custom'),
    entry: z.string()
  })
])

export type PackFrontendType = z.infer<typeof PackFrontendTypeSchema>
export type PackFrontendManifest = z.infer<typeof PackFrontendManifestSchema>
