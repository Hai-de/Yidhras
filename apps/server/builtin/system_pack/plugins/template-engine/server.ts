import type { DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts';

import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';
import { render } from '../../../../src/template_engine/frontends/data_cleaner/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const cleanTemplate = async (input: DataCleanerInput): Promise<DataCleanerOutput> => {
  const { text, options } = input;
  const variables = isRecord(options?.['variables']) ? options['variables'] : {};

  let rendered: string;
  let renderError: string | undefined;
  try {
    rendered = render(text, variables);
  } catch (error: unknown) {
    renderError = error instanceof Error ? error.message : String(error);
    rendered = text;
  }

  return {
    cleaned: rendered,
    metadata: {
      variable_count: Object.keys(variables).length,
      input_length: text.length,
      output_length: rendered.length,
      render_error: renderError
    }
  };
};

export function activate(host: ServerPluginHostApi): void {
  host.registerHandler('data_cleaner.template.clean', cleanTemplate);
  host.registerDataCleaner({
    type: 'data_cleaner',
    name: 'template',
    key: 'data_cleaner.template',
    version: '1.0.0',
    trigger: 'on_tick',
    priority: 80,
    invoke: 'data_cleaner.template.clean'
  });
}
