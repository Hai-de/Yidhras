import { describe, expect, it } from 'vitest'

import { tokenize } from '../../src/template_engine/core/lexer.js'
import { parse } from '../../src/template_engine/core/parser.js'
import { renderAst } from '../../src/template_engine/core/renderer.js'
import type { AstNode, RenderScope } from '../../src/template_engine/core/types.js'
import { BUILTIN_BLOCK_HANDLERS, BUILTIN_MODIFIERS } from '../../src/template_engine/defaults.js'
import { createParser, parseTemplate, render } from '../../src/template_engine/frontends/data_cleaner/index.js'
import { expectArrayElement, expectDefined } from '../helpers/assertions.js'

const defaultScope: RenderScope = {
  variables: {},
  modifiers: BUILTIN_MODIFIERS,
  blockHandlers: BUILTIN_BLOCK_HANDLERS,
  depth: 0,
  maxDepth: 32
}

const scopeWith = (variables: Record<string, unknown>): RenderScope => ({
  ...defaultScope,
  variables
})

describe('Lexer', () => {
  it('T1: tokenizes plain text with no delimiters', () => {
    const tokens = tokenize('hello world')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ type: 'TEXT', content: 'hello world' })
  })

  it('T2: tokenizes a variable interpolation', () => {
    const tokens = tokenize('hello {name}')
    expect(tokens).toHaveLength(4)
    expect(tokens[0]).toMatchObject({ type: 'TEXT', content: 'hello ' })
    expect(tokens[1]).toMatchObject({ type: 'VAR_OPEN' })
    expect(tokens[2]).toMatchObject({ type: 'TEXT', content: 'name' })
    expect(tokens[3]).toMatchObject({ type: 'VAR_CLOSE' })
  })

  it('T3: tokenizes multiple variables', () => {
    const tokens = tokenize('{a} and {b}')
    expect(tokens.filter((t) => t.type === 'VAR_OPEN')).toHaveLength(2)
    expect(tokens.filter((t) => t.type === 'VAR_CLOSE')).toHaveLength(2)
  })

  it('T4: tokenizes macro reference', () => {
    const tokens = tokenize('before {{macro_name}} after')
    expect(tokens.some((t) => t.type === 'MACRO_OPEN')).toBe(true)
    expect(tokens.some((t) => t.type === 'MACRO_CLOSE')).toBe(true)
  })

  it('T5: tokenizes block open and close', () => {
    const tokens = tokenize('{{#if show}}yes{{/if}}')
    expect(tokens.some((t) => t.type === 'BLOCK_OPEN')).toBe(true)
    expect(tokens.some((t) => t.type === 'BLOCK_CLOSE')).toBe(true)
  })

  it('T6: tokenizes comment', () => {
    const tokens = tokenize('before {!-- comment --} after')
    expect(tokens.some((t) => t.type === 'COMMENT_OPEN')).toBe(true)
    expect(tokens.some((t) => t.type === 'COMMENT_CLOSE')).toBe(true)
  })

  it('T7: handles empty template', () => {
    const tokens = tokenize('')
    expect(tokens).toHaveLength(0)
  })

  it('T8: handles escaped delimiter', () => {
    const tokens = tokenize('\\{not a var\\}')
    const textTokens = tokens.filter((t) => t.type === 'TEXT')
    const joined = textTokens.map((t) => t.content ?? '').join('')
    expect(joined).toContain('{')
    expect(joined).toContain('}')
    expect(tokens.filter((t) => t.type === 'VAR_OPEN')).toHaveLength(0)
  })

  it('T9: longest match priority — {{# wins over {{ and {', () => {
    const tokens = tokenize('{{#if x}}')
    expect(tokens.some((t) => t.type === 'BLOCK_OPEN')).toBe(true)
    expect(tokens.some((t) => t.type === 'MACRO_OPEN')).toBe(false)
    expect(tokens.some((t) => t.type === 'VAR_OPEN')).toBe(false)
  })
})

describe('Parser', () => {
  const runParse = (template: string) => {
    const tokens = tokenize(template)
    return parse(tokens)
  }

  it('T1: parses plain text into a text node', () => {
    const { nodes } = runParse('hello')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toEqual({ type: 'text', content: 'hello' })
  })

  it('T2: parses a simple variable', () => {
    const { nodes } = runParse('{name}')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ type: 'variable', name: 'name', modifiers: [] })
  })

  it('T3: parses a variable with modifier chain', () => {
    const { nodes } = runParse('{name|upper|trim}')
    const node = nodes[0]
    expect(node).toMatchObject({
      type: 'variable',
      name: 'name',
      modifiers: [{ name: 'upper', args: [] }, { name: 'trim', args: [] }]
    })
  })

  it('T4: parses a variable with modifier args', () => {
    const { nodes } = runParse('{name|truncate(10)}')
    const node = nodes[0]
    expect(node).toMatchObject({
      type: 'variable',
      name: 'name',
      modifiers: [{ name: 'truncate', args: [10] }]
    })
  })

  it('T5: parses a macro reference', () => {
    const { nodes } = runParse('{{greeting}}')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ type: 'macro', name: 'greeting' })
  })

  it('T6: parses a macro with named args', () => {
    const { nodes } = runParse('{{slot name=system_core}}')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: 'macro',
      name: 'slot',
      args: { name: 'system_core' }
    })
  })

  it('T7: parses if block', () => {
    const { nodes } = runParse('{{#if show}}visible{{/if}}')
    expect(nodes).toHaveLength(1)
    const block = nodes[0]
    expect(block).toMatchObject({ type: 'block', keyword: 'if', condition: 'show' })
    expect((block as { body: AstNode[] }).body).toHaveLength(1)
    expect((block as { body: AstNode[] }).body[0]).toMatchObject({ type: 'text', content: 'visible' })
  })

  it('T8: parses if/else block', () => {
    const { nodes } = runParse('{{#if cond}}yes{{#else}}no{{/if}}')
    expect(nodes).toHaveLength(1)
    const block = nodes[0]
    expect(block).toMatchObject({ type: 'block', keyword: 'if', condition: 'cond' })
    expect((block as { body: AstNode[] }).body).toHaveLength(1)
    const elseBody = expectDefined((block as { elseBody?: AstNode[] }).elseBody, 'if block else body')
    expect(expectArrayElement(elseBody, 0, 'if block else body')).toMatchObject({ type: 'text', content: 'no' })
  })

  it('T9: parses each block', () => {
    const { nodes } = runParse('{{#each items}}{item}{{/each}}')
    expect(nodes).toHaveLength(1)
    const block = nodes[0]
    expect(block).toMatchObject({ type: 'block', keyword: 'each', condition: 'items' })
    expect((block as { body: AstNode[] }).body).toHaveLength(1)
    expect((block as { body: AstNode[] }).body[0]).toMatchObject({ type: 'variable', name: 'item' })
  })

  it('T10: skips comments', () => {
    const { nodes } = runParse('before{!-- comment --}after')
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ type: 'text', content: 'before' })
    expect(nodes[1]).toMatchObject({ type: 'text', content: 'after' })
  })

  it('T11: detects mismatched block close keyword', () => {
    const { diagnostics } = runParse('{{#if x}}body{{/each}}')
    expect(diagnostics.some((d) => d.kind === 'error')).toBe(true)
  })

  it('T12: mixed text and variables', () => {
    const { nodes } = runParse('Hello {name}, welcome to {place|upper}')
    expect(nodes).toHaveLength(4)
    expect(nodes[0]).toMatchObject({ type: 'text', content: 'Hello ' })
    expect(nodes[1]).toMatchObject({ type: 'variable', name: 'name' })
    expect(nodes[2]).toMatchObject({ type: 'text', content: ', welcome to ' })
    expect(nodes[3]).toMatchObject({ type: 'variable', name: 'place', modifiers: [{ name: 'upper', args: [] }] })
  })
})

describe('Renderer', () => {
  it('T1: renders text nodes as-is', () => {
    const nodes: AstNode[] = [{ type: 'text', content: 'hello' }]
    const result = renderAst(nodes, defaultScope)
    expect(result).toBe('hello')
  })

  it('T2: substitutes variable values', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'name', modifiers: [] }]
    const result = renderAst(nodes, scopeWith({ name: 'Alice' }))
    expect(result).toBe('Alice')
  })

  it('T3: missing variable produces empty string', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'missing', modifiers: [] }]
    const result = renderAst(nodes, defaultScope)
    expect(result).toBe('')
  })

  it('T4: applies upper modifier', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'name', modifiers: [{ name: 'upper', args: [] }] }]
    const result = renderAst(nodes, scopeWith({ name: 'alice' }))
    expect(result).toBe('ALICE')
  })

  it('T5: applies lower modifier', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'name', modifiers: [{ name: 'lower', args: [] }] }]
    const result = renderAst(nodes, scopeWith({ name: 'ALICE' }))
    expect(result).toBe('alice')
  })

  it('T6: applies trim modifier', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'name', modifiers: [{ name: 'trim', args: [] }] }]
    const result = renderAst(nodes, scopeWith({ name: '  padded  ' }))
    expect(result).toBe('padded')
  })

  it('T7: applies capitalize modifier', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'name', modifiers: [{ name: 'capitalize', args: [] }] }]
    const result = renderAst(nodes, scopeWith({ name: 'alice' }))
    expect(result).toBe('Alice')
  })

  it('T8: applies pad modifier', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'name', modifiers: [{ name: 'pad', args: ['10'] }] }]
    const result = renderAst(nodes, scopeWith({ name: 'hi' }))
    expect(result).toBe('hi        ')
  })

  it('T9: applies truncate modifier', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'text', modifiers: [{ name: 'truncate', args: ['5'] }] }]
    const result = renderAst(nodes, scopeWith({ text: 'hello world' }))
    expect(result).toBe('hello')
  })

  it('T10: applies default modifier when value is empty', () => {
    const nodes: AstNode[] = [{ type: 'variable', name: 'missing', modifiers: [{ name: 'default', args: ['N/A'] }] }]
    const result = renderAst(nodes, defaultScope)
    expect(result).toBe('N/A')
  })

  it('T11: chains multiple modifiers', () => {
    const nodes: AstNode[] = [{
      type: 'variable',
      name: 'text',
      modifiers: [{ name: 'upper', args: [] }, { name: 'trim', args: [] }]
    }]
    const result = renderAst(nodes, scopeWith({ text: '  hello  ' }))
    expect(result).toBe('HELLO')
  })

  it('T12: renders if block when truthy', () => {
    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'if',
      condition: 'show',
      body: [{ type: 'text', content: 'visible' }]
    }]
    const result = renderAst(nodes, scopeWith({ show: true }))
    expect(result).toBe('visible')
  })

  it('T13: renders else body when falsy', () => {
    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'if',
      condition: 'show',
      body: [{ type: 'text', content: 'visible' }],
      elseBody: [{ type: 'text', content: 'hidden' }]
    }]
    const result = renderAst(nodes, scopeWith({ show: false }))
    expect(result).toBe('hidden')
  })

  it('T14: renders each block iterating over array', () => {
    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'each',
      condition: 'items',
      body: [{ type: 'variable', name: 'item', modifiers: [] }]
    }]
    const result = renderAst(nodes, scopeWith({ items: ['a', 'b', 'c'] }))
    expect(result).toBe('abc')
  })

  it('T15: renders nested blocks', () => {
    const nodes: AstNode[] = [{
      type: 'block',
      keyword: 'if',
      condition: 'outer',
      body: [{
        type: 'block',
        keyword: 'if',
        condition: 'inner',
        body: [{ type: 'text', content: 'nested' }]
      }]
    }]
    const result = renderAst(nodes, scopeWith({ outer: true, inner: true }))
    expect(result).toBe('nested')
  })
})

describe('Public API', () => {
  it('T1: render() one-shot template rendering', () => {
    const result = render('Hello {name|upper}', { name: 'alice' })
    expect(result).toBe('Hello ALICE')
  })

  it('T2: render() with no variables leaves text unchanged', () => {
    const result = render('static text with {missing} var', {})
    expect(result).toBe('static text with  var')
  })

  it('T3: parseTemplate() returns AST and diagnostics', () => {
    const output = parseTemplate('{name|upper}')
    expect(output.nodes).toHaveLength(1)
    expect(output.diagnostics).toHaveLength(0)
  })

  it('T4: createParser() with custom modifier', () => {
    const parser = createParser({
      modifiers: {
        scream: (value: unknown) => String(value).toUpperCase() + '!!!'
      }
    })
    const result = parser.render('{msg|scream}', { msg: 'hello' })
    expect(result).toBe('HELLO!!!')
  })

  it('T5: createParser() with custom block handler', () => {
    const parser = createParser({
      blockHandlers: {
        greet: (_condition: string, body: AstNode[], _elseBody: AstNode[] | undefined, scope: RenderScope, renderFn) => {
          const inner = renderFn(body, scope)
          return `[GREETING: ${inner}]`
        }
      }
    })
    const result = parser.render('{{#greet}}hello{{/greet}}', {})
    expect(result).toBe('[GREETING: hello]')
  })

  it('T6: custom syntax delimiters', () => {
    const result = render('Hello <<name>>', { name: 'Bob' }, {
      delimiters: {
        variable: { open: '<<', close: '>>' },
        macro: { open: '<<<', close: '>>>' },
        blockOpen: { open: '<<<#', close: '>>>' },
        blockClose: { open: '<<</', close: '>>>' },
        comment: { open: '<<!--', close: '-->>' },
        escape: '\\'
      }
    })
    expect(result).toBe('Hello Bob')
  })

  it('T7: parse + renderAst two-step usage', () => {
    const parser = createParser({})
    const { nodes } = parser.parse('{name|upper}')
    const result = parser.renderAst(nodes, { name: 'charlie' })
    expect(result).toBe('CHARLIE')
  })

  it('T8: render handles boolean values', () => {
    const result = render('{flag}', { flag: true })
    expect(result).toBe('true')
  })

  it('T9: render handles number values', () => {
    const result = render('{count}', { count: 42 })
    expect(result).toBe('42')
  })
})

describe('Modifiers', () => {
  it('T1: trim removes leading and trailing whitespace', () => {
    expect(BUILTIN_MODIFIERS.trim('  hello  ')).toBe('hello')
  })

  it('T2: pad right-pads to specified length', () => {
    expect(BUILTIN_MODIFIERS.pad('hi', '5')).toBe('hi   ')
  })

  it('T3: pad does not shorten strings longer than target', () => {
    expect(BUILTIN_MODIFIERS.pad('hello', '3')).toBe('hello')
  })

  it('T4: truncate shortens to max length', () => {
    expect(BUILTIN_MODIFIERS.truncate('hello world', '5')).toBe('hello')
  })

  it('T5: truncate does not lengthen strings shorter than max', () => {
    expect(BUILTIN_MODIFIERS.truncate('hi', '5')).toBe('hi')
  })

  it('T6: default returns value when non-empty', () => {
    expect(BUILTIN_MODIFIERS.default('hello', 'fallback')).toBe('hello')
  })

  it('T7: default returns fallback when empty', () => {
    expect(BUILTIN_MODIFIERS.default('', 'fallback')).toBe('fallback')
  })

  it('T8: capitalize handles empty string', () => {
    expect(BUILTIN_MODIFIERS.capitalize('')).toBe('')
  })
})
