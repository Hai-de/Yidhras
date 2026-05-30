import type { DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts';

import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';

const DEFAULT_MAX_PATTERN_LENGTH = 4096;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_MATCH_COUNT = 100_000;

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

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

const hasNestedQuantifiers = (pattern: string): boolean => {
  return /\([^)]*\*[^)]*\)[\s]*[*+{]/.test(pattern) || /\([^)]*\+[^)]*\)[\s]*[*+{]/.test(pattern);
};

const cleanRegex = async (input: DataCleanerInput): Promise<DataCleanerOutput> => {
    const { text, options } = input;
    const pattern = typeof options?.['pattern'] === 'string' && options['pattern'].length > 0 ? options['pattern'] : '.*';
    const replacement = typeof options?.['replacement'] === 'string' ? options['replacement'] : '';
    const flags = typeof options?.['flags'] === 'string' ? options['flags'] : 'g';
    const maxPatternLength = readPositiveNumber(options?.['max_pattern_length'], DEFAULT_MAX_PATTERN_LENGTH);
    const timeoutMs = readPositiveNumber(options?.['timeout_ms'], DEFAULT_TIMEOUT_MS);
    const maxMatchCount = readPositiveNumber(options?.['max_match_count'], DEFAULT_MAX_MATCH_COUNT);
    const allowNestedQuantifiers = options?.['allow_nested_quantifiers'] === true;

    if (pattern.length > maxPatternLength) {
      throw new Error(
        `Pattern length ${pattern.length} exceeds maximum ${maxPatternLength}. ` +
        'This limit protects against ReDoS attacks. ' +
        'You can increase max_pattern_length in options if you trust the pattern source.'
      );
    }

    if (hasNestedQuantifiers(pattern) && !allowNestedQuantifiers) {
      throw new Error(
        'Pattern contains nested quantifiers that may cause catastrophic backtracking (ReDoS). ' +
        'This is blocked by default for safety. ' +
        'To allow this pattern, set options.allow_nested_quantifiers to true and set a reasonable timeout_ms. ' +
        'For untrusted input, consider using a linear-time regex engine like re2.'
      );
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regular expression: ${message}`);
    }

    const result = await enforceTimeout(
      (async () => {
        let matchCount = 0;
        const cleaned = text.replace(regex, (..._args) => {
          matchCount++;
          if (matchCount > maxMatchCount) {
            throw new Error(
              `Match count ${matchCount} exceeds maximum ${maxMatchCount}. ` +
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
            replacement,
            max_match_count: maxMatchCount,
            allow_nested_quantifiers: allowNestedQuantifiers
          }
        };
      })(),
      timeoutMs
    );

    return result;
};

export function activate(host: ServerPluginHostApi): void {
  host.registerHandler('data_cleaner.regex.clean', cleanRegex);
  host.registerDataCleaner({
    type: 'data_cleaner',
    name: 'regex',
    key: 'data_cleaner.regex',
    version: '1.0.0',
    trigger: 'on_tick',
    priority: 90,
    invoke: 'data_cleaner.regex.clean'
  });
}
