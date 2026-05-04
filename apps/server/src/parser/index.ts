import type { ParserOutput, ParserSyntaxConfig } from '@yidhras/contracts'

import { BUILTIN_BLOCK_HANDLERS, BUILTIN_MODIFIERS } from './builtins.js'
import { tokenize } from './lexer.js'
import { parse } from './parser.js'
import { renderAst } from './renderer.js'
import { DEFAULT_SYNTAX } from './syntax_defaults.js'
import type { BlockHandlerFn, ModifierFn, ParserDiagnostic, ParserInstance, RenderScope } from './types.js'

const mergeSyntax = (base: ParserSyntaxConfig, override?: Partial<ParserSyntaxConfig>): ParserSyntaxConfig => {
  if (!override) {
    return base
  }
  return {
    delimiters: { ...base.delimiters, ...override.delimiters },
    modifiers: { ...base.modifiers, ...override.modifiers },
    blocks: { ...base.blocks, ...override.blocks }
  }
}

export const render = (
  template: string,
  variables: Record<string, unknown>,
  syntaxOverride?: Partial<ParserSyntaxConfig>
): string => {
  const syntax = mergeSyntax(DEFAULT_SYNTAX, syntaxOverride)
  const tokens = tokenize(template, syntax)
  const { nodes } = parse(tokens, syntax)
  const scope: RenderScope = {
    variables,
    modifiers: BUILTIN_MODIFIERS,
    blockHandlers: BUILTIN_BLOCK_HANDLERS,
    depth: 0,
    maxDepth: 32
  }
  return renderAst(nodes, scope)
}

export const parseTemplate = (
  template: string,
  syntaxOverride?: Partial<ParserSyntaxConfig>
): ParserOutput => {
  const syntax = mergeSyntax(DEFAULT_SYNTAX, syntaxOverride)
  const tokens = tokenize(template, syntax)
  const { nodes, diagnostics } = parse(tokens, syntax)
  return {
    nodes,
    diagnostics
  }
}

export const renderAstPublic = (
  nodes: unknown[],
  variables: Record<string, unknown>
): string => {
  const scope: RenderScope = {
    variables,
    modifiers: BUILTIN_MODIFIERS,
    blockHandlers: BUILTIN_BLOCK_HANDLERS,
    depth: 0,
    maxDepth: 32
  }
  return renderAst(nodes as import('./types.js').AstNode[], scope)
}

export const createParser = (config: {
  syntax?: Partial<ParserSyntaxConfig>
  modifiers?: Record<string, ModifierFn>
  blockHandlers?: Record<string, BlockHandlerFn>
}): ParserInstance => {
  const baseSyntax = mergeSyntax(DEFAULT_SYNTAX, config.syntax)
  const modifiers = { ...BUILTIN_MODIFIERS, ...config.modifiers }
  const blockHandlers = { ...BUILTIN_BLOCK_HANDLERS, ...config.blockHandlers }

  return {
    render: (template: string, variables: Record<string, unknown>, syntaxOverride?: Partial<ParserSyntaxConfig>) => {
      const syntax = mergeSyntax(baseSyntax, syntaxOverride)
      const tokens = tokenize(template, syntax)
      const { nodes } = parse(tokens, syntax)
      const scope: RenderScope = { variables, modifiers, blockHandlers, depth: 0, maxDepth: 32 }
      return renderAst(nodes, scope)
    },
    parse: (template: string, syntaxOverride?: Partial<ParserSyntaxConfig>) => {
      const syntax = mergeSyntax(baseSyntax, syntaxOverride)
      const tokens = tokenize(template, syntax)
      return parse(tokens, syntax)
    },
    renderAst: (nodes, variables: Record<string, unknown>) => {
      const scope: RenderScope = { variables, modifiers, blockHandlers, depth: 0, maxDepth: 32 }
      return renderAst(nodes, scope)
    }
  }
}

export type { ParserDiagnostic }
