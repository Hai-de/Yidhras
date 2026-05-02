import type { DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts';

import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';
import type { DataCleaner } from '../../../../src/plugins/extensions/data_cleaner_registry.js';

const cleaner: DataCleaner = {
  key: 'data_cleaner.string',
  version: '1.0.0',

  async clean(input: DataCleanerInput): Promise<DataCleanerOutput> {
    const { text, options } = input;
    const mode = (options?.mode as string) ?? 'trim';

    let cleaned = text;
    switch (mode) {
      case 'trim':
        cleaned = text.trim();
        break;
      case 'lowercase':
        cleaned = text.toLowerCase();
        break;
      case 'uppercase':
        cleaned = text.toUpperCase();
        break;
      case 'collapse_whitespace':
        cleaned = text.replace(/\s+/g, ' ').trim();
        break;
      case 'strip_html':
        cleaned = text.replace(/<[^>]*>/g, '');
        break;
      case 'strip_control':
        cleaned = text.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
        break;
      case 'strip_punctuation':
        cleaned = text.replace(/[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]/g, '');
        break;
      default:
        cleaned = text.trim();
    }

    return { cleaned, metadata: { mode } };
  }
};

export function activate(host: ServerPluginHostApi): void {
  host.registerDataCleaner(cleaner);
}
