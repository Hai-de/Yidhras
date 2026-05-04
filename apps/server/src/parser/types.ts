import type { ParserSyntaxConfig } from '@yidhras/contracts'

export interface Token {
  type:
    | 'TEXT'
    | 'VAR_OPEN'
    | 'VAR_CLOSE'
    | 'MACRO_OPEN'
    | 'MACRO_CLOSE'
    | 'BLOCK_OPEN'
    | 'BLOCK_CLOSE'
    | 'COMMENT_OPEN'
    | 'COMMENT_CLOSE'
  content?: string
  keyword?: string
  position: number
}

export type AstNode = TextNode | VariableNode | MacroNode | BlockNode

export interface TextNode {
  type: 'text'
  content: string
}

export interface VariableNode {
  type: 'variable'
  name: string
  modifiers: ModifierSpec[]
}

export interface MacroNode {
  type: 'macro'
  name: string
  args: Record<string, string>
  body?: AstNode[]
}

export interface BlockNode {
  type: 'block'
  keyword: string
  condition: string
  body: AstNode[]
  elseBody?: AstNode[]
}

export interface ModifierSpec {
  name: string
  args: string[]
}

export interface RenderScope {
  variables: Record<string, unknown>
  modifiers: Record<string, ModifierFn>
  blockHandlers: Record<string, BlockHandlerFn>
  depth: number
  maxDepth: number
}

export type ModifierFn = (value: unknown, ...args: string[]) => unknown

export type BlockHandlerFn = (
  condition: string,
  body: AstNode[],
  elseBody: AstNode[] | undefined,
  scope: RenderScope,
  renderFn: (nodes: AstNode[], scope: RenderScope) => string
) => string

export interface ParserDiagnostic {
  kind: 'warning' | 'error'
  message: string
  offset?: number
}

export interface ParserInstance {
  render: (template: string, variables: Record<string, unknown>, syntax?: Partial<ParserSyntaxConfig>) => string
  parse: (template: string, syntax?: Partial<ParserSyntaxConfig>) => { nodes: AstNode[]; diagnostics: ParserDiagnostic[] }
  renderAst: (nodes: AstNode[], variables: Record<string, unknown>) => string
}
