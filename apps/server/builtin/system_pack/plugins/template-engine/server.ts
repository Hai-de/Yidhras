import type { DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts'

import type { DataCleaner } from '../../../../src/plugins/extensions/data_cleaner_registry.js'
import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js'
import { render } from '../../../../src/template_engine/frontends/data_cleaner/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const cleaner: DataCleaner = {
  key: 'data_cleaner.template',
  version: '1.0.0',

  async clean(input: DataCleanerInput): Promise<DataCleanerOutput> {
    const { text, options } = input
    const variables = isRecord(options?.variables) ? options.variables : {}

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

export function activate(host: ServerPluginHostApi): void {
  host.registerDataCleaner(cleaner)
}
