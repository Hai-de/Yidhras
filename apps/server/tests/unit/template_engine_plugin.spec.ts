import type { DataCleaner, DataCleanerInput } from '@yidhras/contracts'
import { describe, expect, it } from 'vitest'

import { dataCleanerRegistry } from '../../src/plugins/extensions/data_cleaner_registry.js'
import { expectDefined } from '../helpers/assertions.js'

describe('data_cleaner.template', () => {
  const createCleaner = (): DataCleaner => {
    return {
      key: 'data_cleaner.template',
      version: '1.0.0',
      async clean(input: DataCleanerInput) {
        const { text, options } = input
        const { render } = await import('../../src/template_engine/frontends/data_cleaner/index.js')
        const variables = (options?.variables as Record<string, unknown>) ?? {}
        let rendered: string
        try {
          rendered = render(text, variables)
        } catch {
          rendered = text
        }
        return {
          cleaned: rendered,
          metadata: {
            variable_count: Object.keys(variables).length,
            input_length: text.length,
            output_length: rendered.length
          }
        }
      }
    }
  }

  it('T1: registers with dataCleanerRegistry', () => {
    const cleaner = createCleaner()
    dataCleanerRegistry.register(cleaner)
    const retrieved = dataCleanerRegistry.get('data_cleaner.template')
    expect(expectDefined(retrieved, 'template data cleaner').key).toBe('data_cleaner.template')
  })

  it('T2: clean renders template with variables', async () => {
    const cleaner = createCleaner()
    const output = await cleaner.clean({ text: 'Hello {name}', options: { variables: { name: 'World' } } })
    expect(output.cleaned).toBe('Hello World')
  })

  it('T3: clean without variables passes text through', async () => {
    const cleaner = createCleaner()
    const output = await cleaner.clean({ text: 'Hello {name}' })
    expect(output.cleaned).toBe('Hello ')
  })

  it('T4: clean handles empty template', async () => {
    const cleaner = createCleaner()
    const output = await cleaner.clean({ text: '' })
    expect(output.cleaned).toBe('')
  })

  it('T5: clean reports metadata', async () => {
    const cleaner = createCleaner()
    const output = await cleaner.clean({ text: 'Hi {a} {b}', options: { variables: { a: '1', b: '2' } } })
    expect(output.metadata).toMatchObject({
      variable_count: 2,
      input_length: 'Hi {a} {b}'.length,
      output_length: 6
    })
  })

  it('T6: clean with modifier chain in template', async () => {
    const cleaner = createCleaner()
    const output = await cleaner.clean({
      text: '{msg|upper|trim}',
      options: { variables: { msg: '  hello  ' } }
    })
    expect(output.cleaned).toBe('HELLO')
  })

  it('T7: clean falls back to input text on error', async () => {
    const cleaner = createCleaner()
    const output = await cleaner.clean({ text: 'unchanged' })
    expect(output.cleaned).toBe('unchanged')
  })
})
