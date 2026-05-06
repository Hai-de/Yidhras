import type { PermissionContext } from '../../../permission/types.js';
import { createLogger } from '../../../utils/logger.js';
import { tokenize } from '../../core/lexer.js';
import { parse } from '../../core/parser.js';
import type { AstNode, BlockHandlerFn, RenderDiagnostics, RenderResult, RenderScope, SyntaxConfig } from '../../core/types.js';
import { BUILTIN_MODIFIERS } from '../../defaults.js';
import { createNarrativeBlockHandlers } from './blocks.js';
import { createNarrativeVariableResolver } from './resolvers.js';
import type { PromptVariableContext } from './types.js';

const logger = createLogger('narrative-resolver');

const ILLEGAL_PATTERN = /\{\{[^\w.#|()\-\s"',/]+\}\}/g;

const NARRATIVE_SYNTAX: SyntaxConfig = {
  delimiters: {
    variable: { open: '{{', close: '}}' },
    macro: { open: '{{', close: '}}' },
    blockOpen: { open: '{{#', close: '}}' },
    blockClose: { open: '{{/', close: '}}' },
    comment: { open: '{!--', close: '--}' },
    escape: '\\'
  },
  modifiers: {
    chainSeparator: '|',
    argOpen: '(',
    argClose: ')',
    namedArgSep: '='
  },
  blocks: {
    keywords: ['if', 'each', 'with'],
    elseKeyword: 'else',
    asKeyword: 'as'
  }
};

const MAX_RECURSION_DEPTH = 32;
const MAX_TEMPLATE_OUTPUT_LENGTH = 32_000;

const toString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try { return JSON.stringify(value); } catch { return ''; }
};

const parseModifierExpression = (expression: string): { path: string; modifiers: { name: string; args: string[] }[] } => {
  const parts = expression.split('|');
  const path = (parts[0] ?? '').trim();
  const modifiers: { name: string; args: string[] }[] = [];

  for (let i = 1; i < parts.length; i++) {
    const part = (parts[i] ?? '').trim();
    const argOpenIdx = part.indexOf('(');
    if (argOpenIdx !== -1) {
      const modName = part.slice(0, argOpenIdx).trim();
      const argCloseIdx = part.indexOf(')', argOpenIdx);
      const argsStr = argCloseIdx !== -1 ? part.slice(argOpenIdx + 1, argCloseIdx) : part.slice(argOpenIdx + 1);
      const args = argsStr.split(',').map((a) => a.trim()).filter(Boolean);
      modifiers.push({ name: modName, args });
    } else {
      modifiers.push({ name: part, args: [] });
    }
  }

  return { path, modifiers };
};

const renderNarrativeAst = (
  nodes: AstNode[],
  scope: RenderScope & { variableContext?: PromptVariableContext },
  diagnostics: RenderDiagnostics
): string => {
  if (scope.depth >= scope.maxDepth) {
    diagnostics.errors.push({ code: 'RECURSION_DEPTH', message: 'Max recursion depth reached' });
    return '';
  }

  const parts: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        parts.push(node.content);
        break;
      }

      case 'macro': {
        const macroName = node.name;
        const parsed = parseModifierExpression(macroName);
        const result = createNarrativeVariableResolver(
          scope.variableContext!,
          scope.variables
        )(parsed.path, parsed.modifiers);

        if (result.trace) {
          diagnostics.traces.push(result.trace);
          if (result.missing) diagnostics.missing_paths.push(parsed.path);
          if (result.restricted) diagnostics.restricted_paths.push(parsed.path);
        }

        if (result.value !== undefined && result.value !== null) {
          parts.push(toString(result.value));
        }
        break;
      }

      case 'variable': {
        const parsed = { path: node.name, modifiers: node.modifiers };
        const result = createNarrativeVariableResolver(
          scope.variableContext!,
          scope.variables
        )(parsed.path, parsed.modifiers);

        if (result.trace) {
          diagnostics.traces.push(result.trace);
          if (result.missing) diagnostics.missing_paths.push(parsed.path);
          if (result.restricted) diagnostics.restricted_paths.push(parsed.path);
        }

        if (result.value !== undefined && result.value !== null) {
          parts.push(toString(result.value));
        }
        break;
      }

      case 'block': {
        const handler = scope.blockHandlers[node.keyword];
        if (handler) {
          const innerScope: RenderScope & { variableContext?: PromptVariableContext } = {
            ...scope,
            depth: scope.depth + 1,
            variableContext: scope.variableContext
          };
          const result = handler(
            node.condition,
            node.body,
            node.elseBody,
            innerScope,
            (childNodes, childScope) => renderNarrativeAst(childNodes, childScope, diagnostics)
          );
          parts.push(result);
        }
        break;
      }
    }
  }

  return parts.join('');
};

export const renderNarrativeTemplate = (input: {
  template: string;
  variableContext: PromptVariableContext;
  extraContext?: Record<string, unknown>;
  permission?: PermissionContext;
  templateSource?: string;
}): RenderResult => {
  try {
    if (ILLEGAL_PATTERN.test(input.template)) {
      logger.warn('Illegal pattern found in template');
      return {
        text: '',
        diagnostics: {
          template_source: input.templateSource,
          traces: [],
          missing_paths: [],
          restricted_paths: [],
          blocks: [],
          errors: [{ code: 'INVALID_TEMPLATE', message: 'Illegal pattern found in template' }]
        }
      };
    }

    const tokens = tokenize(input.template, NARRATIVE_SYNTAX);
    const { nodes, diagnostics: parseDiagnostics } = parse(tokens, NARRATIVE_SYNTAX);

    const errors = parseDiagnostics
      .filter((d) => d.kind === 'error')
      .map((d) => ({
        code: d.message.includes('Block close keyword') ? 'UNMATCHED_BLOCK' as const
              : d.message.includes('Block without keyword') ? 'MALFORMED_BLOCK' as const
              : 'UNEXPECTED_CLOSE' as const,
        message: d.message,
        offset: d.offset
      }));

    const diagnostics: RenderDiagnostics = {
      template_source: input.templateSource,
      traces: [],
      missing_paths: [],
      restricted_paths: [],
      blocks: [],
      errors
    };

    const narrativeBlockHandlers = createNarrativeBlockHandlers();

    const blockHandlerWrappers: Record<string, BlockHandlerFn> = {};
    for (const [keyword, handler] of Object.entries(narrativeBlockHandlers)) {
      blockHandlerWrappers[keyword] = (
        condition: string,
        body: AstNode[],
        elseBody: AstNode[] | undefined,
        scope,
        renderFn
      ) => {
        const extendedScope = {
          ...scope,
          variableContext: input.variableContext
        };
        return handler(condition, body, elseBody, extendedScope, renderFn);
      };
    }

    const scope: RenderScope & { variableContext?: PromptVariableContext } = {
      variables: input.extraContext ?? {},
      modifiers: BUILTIN_MODIFIERS,
      blockHandlers: blockHandlerWrappers,
      depth: 0,
      maxDepth: MAX_RECURSION_DEPTH,
      variableContext: input.variableContext
    };

    const renderedText = renderNarrativeAst(nodes, scope, diagnostics);

    if (renderedText.length > MAX_TEMPLATE_OUTPUT_LENGTH) {
      diagnostics.errors.push({ code: 'OUTPUT_LIMIT', message: 'Template output exceeded maximum length' });
      return { text: '', diagnostics };
    }

    diagnostics.output_length = renderedText.length;

    return { text: renderedText, diagnostics };
  } catch (error) {
    logger.error('Critical Error during template render', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      text: '',
      diagnostics: {
        template_source: input.templateSource,
        traces: [],
        missing_paths: [],
        restricted_paths: [],
        blocks: [],
        errors: [{ code: 'RENDER_ERROR', message: error instanceof Error ? error.message : String(error) }]
      }
    };
  }
};
