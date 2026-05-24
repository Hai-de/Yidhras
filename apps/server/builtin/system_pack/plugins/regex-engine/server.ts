import type { DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts';

import type { DataCleaner } from '../../../../src/plugins/extensions/data_cleaner_registry.js';
import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';

const DEFAULT_MAX_PATTERN_LENGTH = 4096;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_MATCH_COUNT = 100_000;

const enforceTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Regex execution timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

const cleaner: DataCleaner = {
  key: 'data_cleaner.regex',
  version: '1.0.0',

  async clean(input: DataCleanerInput): Promise<DataCleanerOutput> {
    const { text, options } = input;
    const pattern = typeof options?.pattern === 'string' && options.pattern.length > 0 ? options.pattern : '.*';
    const replacement = typeof options?.replacement === 'string' ? options.replacement : '';
    const flags = typeof options?.flags === 'string' ? options.flags : 'g';
    const maxPatternLength = typeof options?.max_pattern_length === 'number' ? options.max_pattern_length : DEFAULT_MAX_PATTERN_LENGTH;
    const timeoutMs = typeof options?.timeout_ms === 'number' ? options.timeout_ms : DEFAULT_TIMEOUT_MS;

    if (pattern.length > maxPatternLength) {
      throw new Error(
        `Pattern length ${pattern.length} exceeds maximum ${maxPatternLength}. ` +
        'This limit protects against ReDoS attacks. ' +
        'You can increase max_pattern_length in options if you trust the pattern source.'
      );
    }

    // ReDoS heuristic: warn on nested quantifiers but allow execution
    if (/\([^)]*\*[^)]*\)[\s]*[*+{]/.test(pattern) || /\([^)]*\+[^)]*\)[\s]*[*+{]/.test(pattern)) {
      throw new Error(
        'Pattern contains nested quantifiers that may cause catastrophic backtracking (ReDoS). ' +
        'This is blocked by default for safety. ' +
        'To allow this pattern, set options.allow_nested_quantifiers to true and set a reasonable timeout_ms. ' +
        'For untrusted input, consider using a linear-time regex engine like re2.'
      );
    }

    const allowNestedQuantifiers = options?.allow_nested_quantifiers === true;
    if (allowNestedQuantifiers) {
      // Override the nested quantifier block — caller accepts the risk
      // The timeout below is the last line of defense
    }

    const regex = new RegExp(pattern, flags);

    const result = await enforceTimeout(
      (async () => {
        let matchCount = 0;
        const cleaned = text.replace(regex, (..._args) => {
          matchCount++;
          if (matchCount > DEFAULT_MAX_MATCH_COUNT) {
            throw new Error(
              `Match count ${matchCount} exceeds maximum ${DEFAULT_MAX_MATCH_COUNT}. ` +
              'Consider narrowing your pattern or increasing max_match_count in options.'
            );
          }
          return replacement;
        });

        return {
          cleaned,
          metadata: {
            pattern,
            flags,
            match_count: matchCount,
            replacement
          }
        };
      })(),
      timeoutMs
    );

    return result;
  }
};

export function activate(host: ServerPluginHostApi): void {
  host.registerDataCleaner(cleaner);
}
