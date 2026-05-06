import { DEFAULT_SYNTAX } from '../defaults.js';
import type { AstNode, BlockNode, MacroNode, ModifierSpec, ParserDiagnostic, SyntaxConfig, Token, VariableNode  } from './types.js';

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
      const args = argsStr.split(',').map((a) => a.trim()).filter(Boolean);
      modifiers.push({ name: modName, args });
    } else {
      modifiers.push({ name: part, args: [] });
    }
  }

  return { name, modifiers };
};

const parseMacroExpression = (
  expression: string,
  syntax: SyntaxConfig
): { name: string; args: Record<string, string> } => {
  const { modifiers: m } = syntax;
  const words = expression.split(/\s+/).filter(Boolean);
  const name = words[0] ?? '';
  const args: Record<string, string> = {};

  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    const sepIdx = word.indexOf(m.namedArgSep);
    if (sepIdx !== -1) {
      const key = word.slice(0, sepIdx).trim();
      const value = word.slice(sepIdx + 1).trim();
      args[key] = value;
    }
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
        while (hasMore() && (peek()!.type !== 'VAR_CLOSE' && (peek()!.type !== 'MACRO_CLOSE' && peek()!.type !== 'VAR_CLOSE'))) {
          const inner = advance();
          if (inner.type === 'TEXT' && inner.content) {
            parts.push(inner.content);
          }
        }
        if (hasMore() && (peek()!.type === 'VAR_CLOSE' || (peek()!.type === 'MACRO_CLOSE' || peek()!.type === 'VAR_CLOSE'))) {
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
        while (hasMore() && (peek()!.type !== 'MACRO_CLOSE' && peek()!.type !== 'VAR_CLOSE')) {
          const inner = advance();
          if (inner.type === 'TEXT' && inner.content) {
            parts.push(inner.content);
          }
        }
        if (hasMore() && (peek()!.type === 'MACRO_CLOSE' || peek()!.type === 'VAR_CLOSE')) {
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
        while (hasMore() && (peek()!.type !== 'MACRO_CLOSE' && peek()!.type !== 'VAR_CLOSE')) {
          const inner = advance();
          if (inner.type === 'TEXT' && inner.content) {
            headerParts.push(inner.content);
          }
        }
        if (hasMore() && (peek()!.type === 'MACRO_CLOSE' || peek()!.type === 'VAR_CLOSE')) {
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

        if (hasMore() && peek()!.type === 'BLOCK_CLOSE') {
          advance();
          const closeParts: string[] = [];
          while (hasMore() && (peek()!.type !== 'MACRO_CLOSE' && peek()!.type !== 'VAR_CLOSE')) {
            const inner = advance();
            if (inner.type === 'TEXT' && inner.content) {
              closeParts.push(inner.content);
            }
          }
          if (hasMore() && (peek()!.type === 'MACRO_CLOSE' || peek()!.type === 'VAR_CLOSE')) {
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
        while (hasMore() && peek()!.type !== 'COMMENT_CLOSE') {
          advance();
        }
        if (hasMore() && peek()!.type === 'COMMENT_CLOSE') {
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
