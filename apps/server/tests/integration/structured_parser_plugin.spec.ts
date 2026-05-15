import { describe, expect, it } from 'vitest'

import type { ServerPluginHostApi } from '../../src/plugins/runtime.js'
import { dataCleanerRegistry } from '../../src/plugins/extensions/data_cleaner_registry.js'

const buildHost = () => ({
  registerDataCleaner: (cleaner: Parameters<typeof dataCleanerRegistry.register>[0]) => {
    dataCleanerRegistry.register(cleaner)
  }
})

describe('template-engine plugin integration', () => {
  it('registers data_cleaner.template via plugin activation', async () => {
    const { activate } = await import(
      '../../builtin/system_pack/plugins/template-engine/server.js'
    )

    const host = buildHost()
    activate(host as unknown as ServerPluginHostApi)

    const cleaner = dataCleanerRegistry.get('data_cleaner.template')
    expect(cleaner).toBeDefined()
    expect(cleaner!.key).toBe('data_cleaner.template')
    expect(cleaner!.version).toBe('1.0.0')
  })

  it('renders template through activated cleaner', async () => {
    const { activate } = await import(
      '../../builtin/system_pack/plugins/template-engine/server.js'
    )

    activate(buildHost() as unknown as ServerPluginHostApi)

    const cleaner = dataCleanerRegistry.get('data_cleaner.template')!
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

    activate(buildHost() as unknown as ServerPluginHostApi)

    const cleaner = dataCleanerRegistry.get('data_cleaner.template')!
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

    activate(buildHost() as unknown as ServerPluginHostApi)

    const cleaner = dataCleanerRegistry.get('data_cleaner.template')!
    const output = await cleaner.clean({
      text: 'static content {missing_var}',
      options: {}
    })

    expect(output.cleaned).toBe('static content ')
  })
})
