import { createLogger } from './logger.js';

const parseLogger = createLogger('json-parse');

/**
 * Safe JSON.parse wrapper with optional warning on failure.
 *
 * Use when deserializing stored data where corruption should be visible.
 * For AI response parsing where JSON extraction failure is expected,
 * set `warnOnFail: false`.
 */
 
export const tryParseJson = (
  value: string,
  options?: { module?: string; context?: string; warnOnFail?: boolean }
): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by runtime checks above
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch (err: unknown) {
    if (options?.warnOnFail) {
      const errObj = err instanceof Error ? err : undefined;
      const ctx: { error?: Error; data: Record<string, unknown> } = {
        data: {
          preview: value.slice(0, 200),
          parse_module: options.module ?? 'unknown',
          parse_context: options.context ?? 'unknown'
        }
      };
      if (errObj !== undefined) {
        ctx.error = errObj;
      }
      parseLogger.warn('JSON parse failed', ctx);
    }
    return null;
  }
};
