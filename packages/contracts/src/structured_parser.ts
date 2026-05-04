import { z } from 'zod'

const nonEmptyStringSchema = z.string().trim().min(1)

const delimiterPairSchema = z.object({
  open: nonEmptyStringSchema,
  close: nonEmptyStringSchema
})

export const parserSyntaxDelimitersSchema = z.object({
  variable: delimiterPairSchema,
  macro: delimiterPairSchema,
  blockOpen: delimiterPairSchema,
  blockClose: delimiterPairSchema,
  comment: delimiterPairSchema,
  escape: z.string().length(1)
})

export const parserSyntaxModifiersSchema = z.object({
  chainSeparator: z.string().min(1).max(2),
  argOpen: z.string().length(1),
  argClose: z.string().length(1),
  namedArgSep: z.string().length(1)
})

export const parserSyntaxBlocksSchema = z.object({
  conditional: z.object({
    keyword: nonEmptyStringSchema,
    elseKeyword: nonEmptyStringSchema
  }),
  iteration: z.object({
    keyword: nonEmptyStringSchema
  }),
  context: z.object({
    keyword: nonEmptyStringSchema
  })
})

export const parserSyntaxConfigSchema = z.object({
  delimiters: parserSyntaxDelimitersSchema,
  modifiers: parserSyntaxModifiersSchema,
  blocks: parserSyntaxBlocksSchema
})

export const parserModifierSchema = z.object({
  name: nonEmptyStringSchema,
  args: z.array(z.string()).optional()
})

export const parserInputSchema = z.object({
  template: z.string(),
  syntax: parserSyntaxConfigSchema.partial().optional()
})

export const parserRenderInputSchema = parserInputSchema.extend({
  variables: z.record(z.string(), z.unknown())
})

export const parserOutputSchema = z.object({
  nodes: z.array(z.unknown()),
  diagnostics: z.array(
    z.object({
      kind: z.enum(['warning', 'error']),
      message: z.string(),
      offset: z.number().int().nonnegative().optional()
    })
  )
})

export type ParserSyntaxDelimiters = z.infer<typeof parserSyntaxDelimitersSchema>
export type ParserSyntaxModifiers = z.infer<typeof parserSyntaxModifiersSchema>
export type ParserSyntaxBlocks = z.infer<typeof parserSyntaxBlocksSchema>
export type ParserSyntaxConfig = z.infer<typeof parserSyntaxConfigSchema>
export type ParserModifier = z.infer<typeof parserModifierSchema>
export type ParserInput = z.infer<typeof parserInputSchema>
export type ParserRenderInput = z.infer<typeof parserRenderInputSchema>
export type ParserOutput = z.infer<typeof parserOutputSchema>
