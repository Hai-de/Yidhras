import { z } from 'zod'

export const ShellContextSchema = z.object({
  auth_token: z.string(),
  pack_id: z.string(),
  api_base_url: z.string()
})

export type ShellContext = z.infer<typeof ShellContextSchema>
