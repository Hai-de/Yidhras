import type { ParserSyntaxConfig } from '@yidhras/contracts'

export const DEFAULT_SYNTAX: ParserSyntaxConfig = {
  delimiters: {
    variable: { open: '{', close: '}' },
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
    conditional: { keyword: 'if', elseKeyword: 'else' },
    iteration: { keyword: 'each' },
    context: { keyword: 'with' }
  }
}
