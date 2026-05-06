import { DEFAULT_SYNTAX } from '../defaults.js';
import type { SyntaxConfig, Token } from './types.js';

interface DelimiterDef {
  type: Token['type'];
  open: string;
  priority: number;
}

const buildOpenDefs = (syntax: SyntaxConfig): DelimiterDef[] => {
  const { delimiters: d } = syntax;
  return [
    { type: 'COMMENT_OPEN' as const, open: d.comment.open, priority: 5 },
    { type: 'BLOCK_OPEN' as const, open: d.blockOpen.open, priority: 4 },
    { type: 'BLOCK_CLOSE' as const, open: d.blockClose.open, priority: 3 },
    { type: 'VAR_OPEN' as const, open: d.variable.open, priority: 2 },
    { type: 'MACRO_OPEN' as const, open: d.macro.open, priority: 1 }
  ].sort((a, b) => b.open.length - a.open.length || b.priority - a.priority);
};

const buildCloseDefs = (syntax: SyntaxConfig): DelimiterDef[] => {
  const { delimiters: d } = syntax;
  return [
    { type: 'COMMENT_CLOSE' as const, open: d.comment.close, priority: 5 },
    { type: 'VAR_CLOSE' as const, open: d.variable.close, priority: 2 },
    { type: 'MACRO_CLOSE' as const, open: d.macro.close, priority: 1 }
  ].sort((a, b) => b.open.length - a.open.length || b.priority - a.priority);
};

export const tokenize = (
  template: string,
  syntax: SyntaxConfig = DEFAULT_SYNTAX
): Token[] => {
  const { delimiters } = syntax;
  const openDefs = buildOpenDefs(syntax);
  const closeDefs = buildCloseDefs(syntax);
  const escape = delimiters.escape;
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < template.length) {
    let matched = false;

    for (const def of openDefs) {
      if (template.startsWith(def.open, pos)) {
        const escaped = pos > 0 && template[pos - 1] === escape;
        if (escaped) {
          break;
        }
        tokens.push({ type: def.type, position: pos });
        pos += def.open.length;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    for (const def of closeDefs) {
      if (template.startsWith(def.open, pos)) {
        const escaped = pos > 0 && template[pos - 1] === escape;
        if (escaped) {
          break;
        }
        tokens.push({ type: def.type, position: pos });
        pos += def.open.length;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    const textStart = pos;
    while (pos < template.length) {
      let isDelim = false;
      const allDefs = [...openDefs, ...closeDefs];
      for (const def of allDefs) {
        if (template.startsWith(def.open, pos)) {
          const escaped = pos > 0 && template[pos - 1] === escape;
          if (!escaped) {
            isDelim = true;
            break;
          }
        }
      }
      if (isDelim) {
        break;
      }
      pos++;
    }

    const content = template.slice(textStart, pos);
    if (content.length > 0) {
      tokens.push({ type: 'TEXT', content, position: textStart });
    }
  }

  return tokens;
};
