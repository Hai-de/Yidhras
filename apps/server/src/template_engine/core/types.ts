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
  content?: string;
  keyword?: string;
  position: number;
}

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
  args: Record<string, string>;
  body?: AstNode[];
}

export interface BlockNode {
  type: 'block';
  keyword: string;
  condition: string;
  body: AstNode[];
  elseBody?: AstNode[];
}

export interface ModifierSpec {
  name: string;
  args: string[];
}

// === Render scope (used internally by renderer) ===

export type ModifierFn = (value: unknown, ...args: string[]) => unknown;

export type MacroHandlerFn = (
  name: string,
  args: Record<string, string>,
  scope: RenderScope
) => string;

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
  macroHandlers?: Record<string, MacroHandlerFn>;
  prng?: PRNGLike;
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
  offset?: number;
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
  label?: string;
}

export interface RenderDiagnostics {
  traces: VariableResolutionTrace[];
  missing_paths: string[];
  restricted_paths: string[];
  blocks: BlockExecutionTrace[];
  namespaces_used?: string[];
  output_length?: number;
  template_source?: string;
  errors: TemplateError[];
}

export interface VariableResolutionTrace {
  expression: string;
  resolved_path: string;
  resolved: boolean;
  missing: boolean;
  restricted?: boolean;
  value_preview?: string;
  fallback_applied?: boolean;
  source?: string;
  notes?: string[];
}

export interface BlockExecutionTrace {
  kind: string;
  expression: string;
  executed: boolean;
  iteration_count?: number;
  alias?: string;
}

export interface TemplateError {
  code: string;
  path?: string;
  message: string;
  offset?: number;
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
  restricted?: boolean;
  trace?: VariableResolutionTrace;
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
