import { tokenize } from '../../core/lexer.js';
import { parse } from '../../core/parser.js';
import { renderAst } from '../../core/renderer.js';
import type { BlockHandlerFn, ModifierFn, ParserDiagnostic, ParserInstance, RenderScope, SyntaxConfig } from '../../core/types.js';
import { BUILTIN_BLOCK_HANDLERS, BUILTIN_MODIFIERS, DEFAULT_SYNTAX } from '../../defaults.js';

const mergeSyntax = (base: SyntaxConfig, override?: Partial<SyntaxConfig>): SyntaxConfig => {
  if (!override) {
    return base;
  }
  return {
    delimiters: { ...base.delimiters, ...override.delimiters },
    modifiers: { ...base.modifiers, ...override.modifiers },
    blocks: { ...base.blocks, ...override.blocks }
  };
};

export const render = (
  template: string,
  variables: Record<string, unknown>,
  syntaxOverride?: Partial<SyntaxConfig>
): string => {
  const syntax = mergeSyntax(DEFAULT_SYNTAX, syntaxOverride);
  const tokens = tokenize(template, syntax);
  const { nodes } = parse(tokens, syntax);
  const scope: RenderScope = {
    variables,
    modifiers: BUILTIN_MODIFIERS,
    blockHandlers: BUILTIN_BLOCK_HANDLERS,
    depth: 0,
    maxDepth: 32
  };
  return renderAst(nodes, scope);
};

export const parseTemplate = (
  template: string,
  syntaxOverride?: Partial<SyntaxConfig>
): { nodes: import('../../core/types.js').AstNode[]; diagnostics: ParserDiagnostic[] } => {
  const syntax = mergeSyntax(DEFAULT_SYNTAX, syntaxOverride);
  const tokens = tokenize(template, syntax);
  return parse(tokens, syntax);
};

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
  };
  return renderAst(nodes as import('../../core/types.js').AstNode[], scope);
};

export const createParser = (config: {
  syntax?: Partial<SyntaxConfig>;
  modifiers?: Record<string, ModifierFn>;
  blockHandlers?: Record<string, BlockHandlerFn>;
}): ParserInstance => {
  const baseSyntax = mergeSyntax(DEFAULT_SYNTAX, config.syntax);
  const modifiers = { ...BUILTIN_MODIFIERS, ...config.modifiers };
  const blockHandlers = { ...BUILTIN_BLOCK_HANDLERS, ...config.blockHandlers };

  return {
    render: (template: string, variables: Record<string, unknown>, syntaxOverride?: Partial<SyntaxConfig>) => {
      const syntax = mergeSyntax(baseSyntax, syntaxOverride);
      const tokens = tokenize(template, syntax);
      const { nodes } = parse(tokens, syntax);
      const scope: RenderScope = { variables, modifiers, blockHandlers, depth: 0, maxDepth: 32 };
      return renderAst(nodes, scope);
    },
    parse: (template: string, syntaxOverride?: Partial<SyntaxConfig>) => {
      const syntax = mergeSyntax(baseSyntax, syntaxOverride);
      const tokens = tokenize(template, syntax);
      return parse(tokens, syntax);
    },
    renderAst: (nodes, variables: Record<string, unknown>) => {
      const scope: RenderScope = { variables, modifiers, blockHandlers, depth: 0, maxDepth: 32 };
      return renderAst(nodes, scope);
    }
  };
};

export type { ParserDiagnostic };
