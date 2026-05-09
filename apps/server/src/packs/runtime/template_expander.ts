import { tokenize } from '../../template_engine/core/lexer.js';
import { parse } from '../../template_engine/core/parser.js';
import { renderAst } from '../../template_engine/core/renderer.js';
import type { RenderScope,SyntaxConfig  } from '../../template_engine/core/types.js';

const TEMPLATE_PATTERN = /\{\{/;

const MACRO_ONLY_SYNTAX: SyntaxConfig = {
  delimiters: {
    variable: { open: '\0', close: '\0' },
    macro: { open: '{{', close: '}}' },
    blockOpen: { open: '\0', close: '\0' },
    blockClose: { open: '\0', close: '\0' },
    comment: { open: '\0', close: '\0' },
    escape: '\\'
  },
  modifiers: {
    chainSeparator: '|',
    argOpen: '(',
    argClose: ')',
    namedArgSep: '='
  },
  blocks: {
    keywords: [],
    elseKeyword: '\0',
    asKeyword: '\0'
  }
};

const renderTemplate = (template: string, scope: RenderScope): string => {
  try {
    const tokens = tokenize(template, MACRO_ONLY_SYNTAX);
    const { nodes } = parse(tokens, MACRO_ONLY_SYNTAX);
    return renderAst(nodes, scope);
  } catch {
    return template;
  }
};

const expandValue = (value: unknown, scope: RenderScope): unknown => {
  if (typeof value === 'string' && TEMPLATE_PATTERN.test(value)) {
    return renderTemplate(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandValue(v, scope));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandValue(v, scope);
    }
    return result;
  }
  return value;
};

export const expandStateJson = (
  stateJson: Record<string, unknown>,
  scope: RenderScope
): Record<string, unknown> => {
  return expandValue(stateJson, scope) as Record<string, unknown>;
};
