// === Token types ===

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
    | 'COMMENT_CLOSE';
  content?: string | undefined;
  keyword?: string | undefined;
  position: number;
}

// === Value types ===

export type MacroPrimitive = string | number | boolean | null;
export type MacroValue = MacroPrimitive | MacroValue[] | { [key: string]: MacroValue };

// === AST types ===

export type AstNode = TextNode | VariableNode | MacroNode | BlockNode;

export interface TextNode {
  type: 'text';
  content: string;
}

export interface VariableNode {
  type: 'variable';
  name: string;
  modifiers: ModifierSpec[];
}

export interface MacroNode {
  type: 'macro';
  name: string;
  args: Record<string, MacroValue>;
  body?: AstNode[] | undefined;
}

export interface BlockNode {
  type: 'block';
  keyword: string;
  condition: string;
  body: AstNode[];
  elseBody?: AstNode[] | undefined;
}

export interface ModifierSpec {
  name: string;
  args: MacroValue[];
}

// === Render scope (used internally by renderer) ===

export type ModifierFn = (value: unknown, ...args: MacroValue[]) => unknown;

export type MacroHandlerFn = (
  name: string,
  args: Record<string, MacroValue>,
  scope: RenderScope
) => MacroValue;

export type BlockHandlerFn = (
  condition: string,
  body: AstNode[],
  elseBody: AstNode[] | undefined,
  scope: RenderScope,
  renderFn: (nodes: AstNode[], scope: RenderScope) => string
) => string;

export interface PRNGLike {
  next(): number;
  getSeed(): string;
}

export interface RenderScope {
  variables: Record<string, unknown>;
  modifiers: Record<string, ModifierFn>;
  blockHandlers: Record<string, BlockHandlerFn>;
  macroHandlers?: Record<string, MacroHandlerFn> | undefined;
  prng?: PRNGLike | undefined;
  depth: number;
  maxDepth: number;
}

// === Syntax config ===

export interface SyntaxConfig {
  delimiters: {
    variable: { open: string; close: string };
    macro: { open: string; close: string };
    blockOpen: { open: string; close: string };
    blockClose: { open: string; close: string };
    comment: { open: string; close: string };
    escape: string;
  };
  modifiers: {
    chainSeparator: string;
    argOpen: string;
    argClose: string;
    namedArgSep: string;
  };
  blocks: {
    keywords: string[];
    elseKeyword: string;
    asKeyword: string;
  };
}

// === Diagnostic types ===

export interface ParserDiagnostic {
  kind: 'warning' | 'error';
  message: string;
  offset?: number | undefined;
}

// === Parser instance (public API) ===

export interface ParserInstance {
  render: (template: string, variables: Record<string, unknown>, syntax?: Partial<SyntaxConfig>) => string;
  parse: (template: string, syntax?: Partial<SyntaxConfig>) => { nodes: AstNode[]; diagnostics: ParserDiagnostic[] };
  renderAst: (nodes: AstNode[], variables: Record<string, unknown>) => string;
}

// === RenderContext (extended scope for domain frontends) ===

export interface ScopeFrame {
  variables: Record<string, unknown>;
  label?: string | undefined;
}

export interface RenderDiagnostics {
  traces: VariableResolutionTrace[];
  missing_paths: string[];
  restricted_paths: string[];
  blocks: BlockExecutionTrace[];
  namespaces_used?: string[] | undefined;
  output_length?: number | undefined;
  template_source?: string | undefined;
  errors: TemplateError[];
}

export interface VariableResolutionTrace {
  expression: string;
  resolved_path: string;
  resolved: boolean;
  missing: boolean;
  restricted?: boolean | undefined;
  value_preview?: string | undefined;
  fallback_applied?: boolean | undefined;
  source?: string | undefined;
  notes?: string[] | undefined;
}

export interface BlockExecutionTrace {
  kind: string;
  expression: string;
  executed: boolean;
  iteration_count?: number | undefined;
  alias?: string | undefined;
}

export interface TemplateError {
  code: string;
  path?: string | undefined;
  message: string;
  offset?: number | undefined;
}

export interface RenderResult {
  text: string;
  diagnostics: RenderDiagnostics;
}

export type VariableResolver = (
  path: string,
  pipeline: ModifierSpec[],
  context: RenderContext
) => ResolvedVariable;

export interface ResolvedVariable {
  value: unknown;
  missing: boolean;
  restricted?: boolean | undefined;
  trace?: VariableResolutionTrace | undefined;
}

export type BlockHandlerKind = 'conditional' | 'iteration' | 'context' | 'custom';

export interface BlockHandlerRegistration {
  kind: BlockHandlerKind;
  fn: BlockHandlerFn;
}

export interface RenderContext {
  variables: Record<string, unknown>;
  resolve: VariableResolver;
  modifiers: Record<string, ModifierFn>;
  blockHandlers: Record<string, BlockHandlerRegistration>;
  scopeStack: ScopeFrame[];
  depth: number;
  maxDepth: number;
  maxLength: number;
  diagnostics: RenderDiagnostics;
}
