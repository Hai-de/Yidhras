import { tokenize } from '../../template_engine/core/lexer.js';
import { parse } from '../../template_engine/core/parser.js';
import { renderAst, resolveMacroArgs } from '../../template_engine/core/renderer.js';
import type { MacroValue, RenderScope, SyntaxConfig } from '../../template_engine/core/types.js';

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

const isSingleMacroTemplate = (
  template: string
): boolean => {
  const trimmed = template.trim();
  return trimmed.startsWith('{{') && trimmed.endsWith('}}')
    && trimmed.indexOf('{{', 2) === -1
    && trimmed.lastIndexOf('}}') === trimmed.length - 2;
};

const expandMacroValue = (
  template: string,
  scope: RenderScope
): MacroValue | string => {
  try {
    const tokens = tokenize(template, MACRO_ONLY_SYNTAX);
    const { nodes } = parse(tokens, MACRO_ONLY_SYNTAX);

    if (
      nodes.length === 1 &&
      nodes[0].type === 'macro' &&
      scope.macroHandlers?.[nodes[0].name]
    ) {
      const resolvedArgs = resolveMacroArgs(nodes[0].args, scope);
      return scope.macroHandlers[nodes[0].name](nodes[0].name, resolvedArgs, scope);
    }

    return renderAst(nodes, scope);
  } catch {
    return template;
  }
};

const expandValue = (value: unknown, scope: RenderScope): unknown => {
  if (typeof value === 'string' && TEMPLATE_PATTERN.test(value)) {
    if (isSingleMacroTemplate(value)) {
      const result = expandMacroValue(value, scope);
      if (typeof result !== 'string') {
        return result;
      }
      return result;
    }
    return expandMacroValue(value, scope);
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
