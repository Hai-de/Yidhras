import type { DataCleaner, DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts'
import { describe, expect, it } from 'vitest'

import { dataCleanerRegistry } from '../../src/plugins/extensions/data_cleaner_registry.js'
import type { ServerPluginHostApi } from '../../src/plugins/runtime.js'
import { expectDefined } from '../helpers/assertions.js'

const templateCleaner = () => expectDefined(dataCleanerRegistry.get('data_cleaner.template'), 'template cleaner')

const buildHost = (): ServerPluginHostApi => {
  const handlers = new Map<string, (input: unknown) => unknown | Promise<unknown>>()

  return {
    registerHandler(name, handler) {
      handlers.set(name, handler)
    },
    registerDataCleaner(descriptor) {
      const cleaner: DataCleaner = {
        key: descriptor.key,
        version: descriptor.version,
        async clean(input: DataCleanerInput): Promise<DataCleanerOutput> {
          const handler = handlers.get(descriptor.invoke)
          if (!handler) {
            throw new Error(`handler not registered: ${descriptor.invoke}`)
          }
          return await handler(input) as DataCleanerOutput
        }
      }
      dataCleanerRegistry.register(cleaner)
    },
    registerContextSource() {},
    registerPromptWorkflowStep() {},
    registerPackRoute() {},
    registerStepContributor() {},
    registerRuleContributor() {},
    registerQueryContributor() {},
    registerSlotConditionEvaluator() {},
    registerSlotContentTransformer() {},
    registerPerceptionResolver() {},
    async requestInference() {
      throw new Error('requestInference is not used by template plugin tests')
    }
  }
}

describe('template-engine plugin integration', () => {
  it('registers data_cleaner.template via plugin activation', async () => {
    const { activate } = await import(
      '../../builtin/system_pack/plugins/template-engine/server.js'
    )

    const host = buildHost()
    activate(host)

    const cleaner = templateCleaner()
    expect(cleaner.key).toBe('data_cleaner.template')
    expect(cleaner.version).toBe('1.0.0')
  })

  it('renders template through activated cleaner', async () => {
    const { activate } = await import(
      '../../builtin/system_pack/plugins/template-engine/server.js'
    )

    activate(buildHost())

    const cleaner = templateCleaner()
    const output = await cleaner.clean({
      text: 'Hello {name|upper}, welcome to {place}',
      options: { variables: { name: 'alice', place: 'Wonderland' } }
    })

    expect(output.cleaned).toBe('Hello ALICE, welcome to Wonderland')
  })

  it('handles if/else block rendering through the plugin', async () => {
    const { activate } = await import(
      '../../builtin/system_pack/plugins/template-engine/server.js'
    )

    activate(buildHost())

    const cleaner = templateCleaner()
    const output = await cleaner.clean({
      text: '{{#if show}}yes{{#else}}no{{/if}}',
      options: { variables: { show: true } }
    })

    expect(output.cleaned).toBe('yes')
  })

  it('passes through text when no variables match', async () => {
    const { activate } = await import(
      '../../builtin/system_pack/plugins/template-engine/server.js'
    )

    activate(buildHost())

    const cleaner = templateCleaner()
    const output = await cleaner.clean({
      text: 'static content {missing_var}',
      options: {}
    })

    expect(output.cleaned).toBe('static content ')
  })
})
