import { DEFAULT_SYNTAX } from '../defaults.js';
import type { AstNode, BlockNode, MacroNode, MacroValue, ModifierSpec, ParserDiagnostic, SyntaxConfig, Token, VariableNode } from './types.js';

// === Macro expression tokenizer ===

type ExprTokenType =
  | 'IDENT'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'NULL'
  | 'STRING'
  | 'EQ'
  | 'COMMA'
  | 'COLON'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'LBRACE'
  | 'RBRACE';

interface ExprToken {
  type: ExprTokenType;
  value?: string | number | boolean;
  position: number;
}

const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isIdentCont = (ch: string): boolean => /[\w.]/.test(ch);
const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

const tokenizeExpr = (input: string): { tokens: ExprToken[]; diagnostics: ParserDiagnostic[] } => {
  const tokens: ExprToken[] = [];
  const diagnostics: ParserDiagnostic[] = [];
  let pos = 0;

  const peek = (offset = 0): string => input[pos + offset] ?? '';
  const advance = (): string => input[pos++] ?? '';

  while (pos < input.length) {
    const ch = peek();

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance();
      continue;
    }

    // Single-char delimiters
    if (ch === '=') { tokens.push({ type: 'EQ', position: pos }); advance(); continue; }
    if (ch === ',') { tokens.push({ type: 'COMMA', position: pos }); advance(); continue; }
    if (ch === ':') { tokens.push({ type: 'COLON', position: pos }); advance(); continue; }
    if (ch === '[') { tokens.push({ type: 'LBRACKET', position: pos }); advance(); continue; }
    if (ch === ']') { tokens.push({ type: 'RBRACKET', position: pos }); advance(); continue; }
    if (ch === '{') { tokens.push({ type: 'LBRACE', position: pos }); advance(); continue; }
    if (ch === '}') { tokens.push({ type: 'RBRACE', position: pos }); advance(); continue; }

    // String literals (double-quoted)
    if (ch === '"') {
      const start = pos;
      advance(); // skip opening "
      let value = '';
      while (pos < input.length && peek() !== '"') {
        if (peek() === '\\' && peek(1) === '"') {
          advance(); // skip backslash
          value += advance(); // the escaped quote
        } else {
          value += advance();
        }
      }
      if (pos < input.length) {
        advance(); // skip closing "
      } else {
        diagnostics.push({ kind: 'warning', message: 'Unterminated string literal', offset: start });
      }
      tokens.push({ type: 'STRING', value, position: start });
      continue;
    }

    // String literals (single-quoted)
    if (ch === "'") {
      const start = pos;
      advance();
      let value = '';
      while (pos < input.length && peek() !== "'") {
        if (peek() === '\\' && peek(1) === "'") {
          advance();
          value += advance();
        } else {
          value += advance();
        }
      }
      if (pos < input.length) {
        advance();
      } else {
        diagnostics.push({ kind: 'warning', message: 'Unterminated string literal', offset: start });
      }
      tokens.push({ type: 'STRING', value, position: start });
      continue;
    }

    // Numbers (including negative)
    if (ch === '-' && isDigit(peek(1))) {
      const start = pos;
      let numStr = advance(); // the minus sign
      while (pos < input.length && isDigit(peek())) {
        numStr += advance();
      }
      if (peek() === '.' && isDigit(peek(1))) {
        numStr += advance(); // dot
        while (pos < input.length && isDigit(peek())) {
          numStr += advance();
        }
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), position: start });
      continue;
    }

    if (isDigit(ch)) {
      const start = pos;
      let numStr = advance();
      while (pos < input.length && isDigit(peek())) {
        numStr += advance();
      }
      if (peek() === '.' && isDigit(peek(1))) {
        numStr += advance();
        while (pos < input.length && isDigit(peek())) {
          numStr += advance();
        }
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), position: start });
      continue;
    }

    // Identifiers, keywords
    if (isIdentStart(ch)) {
      const start = pos;
      let ident = advance();
      while (pos < input.length && isIdentCont(peek())) {
        ident += advance();
      }
      if (ident === 'true') {
        tokens.push({ type: 'BOOLEAN', value: true, position: start });
      } else if (ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: false, position: start });
      } else if (ident === 'null') {
        tokens.push({ type: 'NULL', position: start });
      } else {
        tokens.push({ type: 'IDENT', value: ident, position: start });
      }
      continue;
    }

    // Unknown character — skip with warning
    diagnostics.push({ kind: 'warning', message: `Unexpected character '${ch}' in macro expression`, offset: pos });
    advance();
  }

  return { tokens, diagnostics };
};

// === Recursive-descent value parser ===

const parseValue = (
  tokens: ExprToken[],
  idx: number
): { value: MacroValue; nextIdx: number } | null => {
  if (idx >= tokens.length) {
    return null;
  }

  const token = tokens[idx]!;

  switch (token.type) {
    case 'NUMBER':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- token value guaranteed by tokenizer
      return { value: token.value as number, nextIdx: idx + 1 };

    case 'BOOLEAN':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- token value guaranteed by tokenizer
      return { value: token.value as boolean, nextIdx: idx + 1 };

    case 'NULL':
      return { value: null, nextIdx: idx + 1 };

    case 'STRING':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- token value guaranteed by tokenizer
      return { value: token.value as string, nextIdx: idx + 1 };

    case 'IDENT':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- token value guaranteed by tokenizer
      return { value: token.value as string, nextIdx: idx + 1 };

    case 'LBRACKET':
      return parseArray(tokens, idx);

    case 'LBRACE':
      return parseObject(tokens, idx);

    default:
      return null;
  }
};

const parseArray = (
  tokens: ExprToken[],
  idx: number
): { value: MacroValue[]; nextIdx: number } | null => {
  // idx points at LBRACKET
  let i = idx + 1;
  const items: MacroValue[] = [];

  // Empty array
  if (i < tokens.length && tokens[i]!.type === 'RBRACKET') {
    return { value: items, nextIdx: i + 1 };
  }

  while (i < tokens.length) {
    const result = parseValue(tokens, i);
    if (!result) {
      return null;
    }
    items.push(result.value);
    i = result.nextIdx;

    if (i < tokens.length && tokens[i]!.type === 'COMMA') {
      i++;
      continue;
    }

    if (i < tokens.length && tokens[i]!.type === 'RBRACKET') {
      return { value: items, nextIdx: i + 1 };
    }

    return null;
  }

  return null;
};

const parseObject = (
  tokens: ExprToken[],
  idx: number
): { value: Record<string, MacroValue>; nextIdx: number } | null => {
  // idx points at LBRACE
  let i = idx + 1;
  const obj: Record<string, MacroValue> = {};

  // Empty object
  if (i < tokens.length && tokens[i]!.type === 'RBRACE') {
    return { value: obj, nextIdx: i + 1 };
  }

  while (i < tokens.length) {
    if (tokens[i]!.type !== 'IDENT') {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const key = tokens[i]!.value as string;
    i++;

    if (i >= tokens.length || tokens[i]!.type !== 'COLON') {
      return null;
    }
    i++;

    const result = parseValue(tokens, i);
    if (!result) {
      return null;
    }
    obj[key] = result.value;
    i = result.nextIdx;

    if (i < tokens.length && tokens[i]!.type === 'COMMA') {
      i++;
      continue;
    }

    if (i < tokens.length && tokens[i]!.type === 'RBRACE') {
      return { value: obj, nextIdx: i + 1 };
    }

    return null;
  }

  return null;
};

// === Public parser functions ===

const parseModifierChain = (
  expression: string,
  syntax: SyntaxConfig
): { name: string; modifiers: ModifierSpec[] } => {
  const { modifiers: m } = syntax;
  const parts = expression.split(m.chainSeparator);
  const name = (parts[0] ?? '').trim();
  const modifiers: ModifierSpec[] = [];

  for (let i = 1; i < parts.length; i++) {
    const part = (parts[i] ?? '').trim();
    const argOpenIdx = part.indexOf(m.argOpen);
    if (argOpenIdx !== -1) {
      const modName = part.slice(0, argOpenIdx).trim();
      const argCloseIdx = part.indexOf(m.argClose, argOpenIdx);
      const argsStr = argCloseIdx !== -1 ? part.slice(argOpenIdx + 1, argCloseIdx) : part.slice(argOpenIdx + 1);

      // Parse modifier args as typed literals
      const { tokens: argTokens } = tokenizeExpr(argsStr);
      const args: MacroValue[] = [];
      let ti = 0;
      while (ti < argTokens.length) {
        const result = parseValue(argTokens, ti);
        if (result) {
          args.push(result.value);
          ti = result.nextIdx;
          // Skip comma between args
          if (ti < argTokens.length && argTokens[ti]!.type === 'COMMA') {
            ti++;
          }
        } else {
          // Fall back to raw string for unparseable args
          args.push(argsStr.slice(argTokens[ti]!.position ?? 0).trim());
          break;
        }
      }

      modifiers.push({ name: modName, args });
    } else {
      modifiers.push({ name: part, args: [] });
    }
  }

  return { name, modifiers };
};

const parseMacroExpression = (
  expression: string,
  _syntax: SyntaxConfig
): { name: string; args: Record<string, MacroValue> } => {
  // Heuristic: if the expression contains '=', use the typed literal parser.
  // Otherwise fall back to simple whitespace-split (for bare macros like {{seed}}
  // and variable refs like {{pack.variables.xxx}} in narrative context).
  if (!expression.includes('=')) {
    const words = expression.split(/\s+/).filter(Boolean);
    const name = words[0] ?? '';
    return { name, args: {} };
  }

  const { tokens } = tokenizeExpr(expression);

  if (tokens.length === 0 || tokens[0]!.type !== 'IDENT') {
    return { name: '', args: {} };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- token value guaranteed by tokenizer
  const name = tokens[0]!.value as string;
  const args: Record<string, MacroValue> = {};
  let i = 1;

  while (i < tokens.length) {
    if (tokens[i]!.type !== 'IDENT') {
      break;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- token value guaranteed by tokenizer
    const key = tokens[i]!.value as string;
    i++;

    if (i >= tokens.length || tokens[i]!.type !== 'EQ') {
      break;
    }
    i++; // skip EQ

    const result = parseValue(tokens, i);
    if (!result) {
      break;
    }
    args[key] = result.value;
    i = result.nextIdx;
  }

  return { name, args };
};

export const parse = (
  tokens: Token[],
  syntax: SyntaxConfig = DEFAULT_SYNTAX
): { nodes: AstNode[]; diagnostics: ParserDiagnostic[] } => {
  const diagnostics: ParserDiagnostic[] = [];
  let idx = 0;

  const peek = (): Token | undefined => tokens[idx];
  const advance = (): Token => {
    const t = tokens[idx];
    if (t) {
      idx++;
      return t;
    }
    return { type: 'TEXT', content: '', position: -1 };
  };
  const hasMore = (): boolean => idx < tokens.length;

  const parseNodes = (stopKeyword?: string): AstNode[] => {
    const body: AstNode[] = [];

    while (hasMore()) {
      const token = peek();
      if (!token) break;

      if (token.type === 'TEXT') {
        advance();
        if (token.content && token.content.length > 0) {
          body.push({ type: 'text', content: token.content });
        }
        continue;
      }

      if (token.type === 'VAR_OPEN') {
        advance();
        const parts: string[] = [];
        while (hasMore() && (peek()?.type !== 'VAR_CLOSE' && (peek()?.type !== 'MACRO_CLOSE' && peek()?.type !== 'VAR_CLOSE'))) {
          const inner = advance();
          if (inner.type === 'TEXT' && inner.content) {
            parts.push(inner.content);
          }
        }
        if (hasMore() && (peek()?.type === 'VAR_CLOSE' || (peek()?.type === 'MACRO_CLOSE' || peek()?.type === 'VAR_CLOSE'))) {
          advance();
        }
        const expression = parts.join('');
        const parsed = parseModifierChain(expression, syntax);
        if (parsed.name.length === 0) {
          diagnostics.push({
            kind: 'warning',
            message: 'Empty variable expression',
            offset: token.position
          });
        } else {
          const node: VariableNode = {
            type: 'variable',
            name: parsed.name,
            modifiers: parsed.modifiers
          };
          body.push(node);
        }
        continue;
      }

      if (token.type === 'MACRO_OPEN') {
        advance();
        const parts: string[] = [];
        while (hasMore() && (peek()?.type !== 'MACRO_CLOSE' && peek()?.type !== 'VAR_CLOSE')) {
          const inner = advance();
          if (inner.type === 'TEXT' && inner.content) {
            parts.push(inner.content);
          }
        }
        if (hasMore() && (peek()?.type === 'MACRO_CLOSE' || peek()?.type === 'VAR_CLOSE')) {
          advance();
        }
        const expression = parts.join('');
        const parsed = parseMacroExpression(expression, syntax);
        if (parsed.name.length === 0) {
          diagnostics.push({
            kind: 'warning',
            message: 'Empty macro expression',
            offset: token.position
          });
        } else {
          const node: MacroNode = {
            type: 'macro',
            name: parsed.name,
            args: parsed.args
          };
          body.push(node);
        }
        continue;
      }

      if (token.type === 'BLOCK_OPEN') {
        const nextToken = tokens[idx + 1];
        if (
          nextToken?.type === 'TEXT' &&
          nextToken.content?.trim() === syntax.blocks.elseKeyword &&
          stopKeyword
        ) {
          break;
        }

        advance();
        const headerParts: string[] = [];
        while (hasMore() && (peek()?.type !== 'MACRO_CLOSE' && peek()?.type !== 'VAR_CLOSE')) {
          const inner = advance();
          if (inner.type === 'TEXT' && inner.content) {
            headerParts.push(inner.content);
          }
        }
        if (hasMore() && (peek()?.type === 'MACRO_CLOSE' || peek()?.type === 'VAR_CLOSE')) {
          advance();
        }
        const header = headerParts.join('').trim();
        const headerWords = header.split(/\s+/);
        const keyword = headerWords[0] ?? '';
        const condition = headerWords.slice(1).join(' ');

        if (keyword.length === 0) {
          diagnostics.push({
            kind: 'error',
            message: 'Block without keyword',
            offset: token.position
          });
          continue;
        }

        const bodyNodes = parseNodes(keyword);

        let elseBody: AstNode[] | undefined;
        if (peek()?.type === 'BLOCK_OPEN') {
          const la = tokens[idx + 1];
          const la2 = tokens[idx + 2];
          if (
            la?.type === 'TEXT' &&
            la.content?.trim() === syntax.blocks.elseKeyword &&
            (la2?.type === 'MACRO_CLOSE' || la2?.type === 'VAR_CLOSE')
          ) {
            advance();
            advance();
            advance();
            elseBody = parseNodes(keyword);
          }
        }

        if (hasMore() && peek()?.type === 'BLOCK_CLOSE') {
          advance();
          const closeParts: string[] = [];
          while (hasMore() && (peek()?.type !== 'MACRO_CLOSE' && peek()?.type !== 'VAR_CLOSE')) {
            const inner = advance();
            if (inner.type === 'TEXT' && inner.content) {
              closeParts.push(inner.content);
            }
          }
          if (hasMore() && (peek()?.type === 'MACRO_CLOSE' || peek()?.type === 'VAR_CLOSE')) {
            advance();
          }
          const closeKeyword = closeParts.join('').trim();
          if (closeKeyword !== keyword) {
            diagnostics.push({
              kind: 'error',
              message: `Block close keyword "${closeKeyword}" does not match open keyword "${keyword}"`,
              offset: token.position
            });
          }
        }

        const node: BlockNode = { type: 'block', keyword, condition, body: bodyNodes, elseBody };
        body.push(node);
        continue;
      }

      if (token.type === 'BLOCK_CLOSE') {
        if (!stopKeyword) {
          diagnostics.push({
            kind: 'error',
            message: 'Unexpected block close without matching open',
            offset: token.position
          });
        }
        break;
      }

      if (token.type === 'COMMENT_OPEN') {
        advance();
        while (hasMore() && peek()?.type !== 'COMMENT_CLOSE') {
          advance();
        }
        if (hasMore() && peek()?.type === 'COMMENT_CLOSE') {
          advance();
        }
        continue;
      }

      advance();
    }

    return body;
  };

  const result = parseNodes();
  return { nodes: result, diagnostics };
};
