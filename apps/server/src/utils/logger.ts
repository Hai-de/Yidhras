export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const LOG_LEVEL_VALUES: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

const isLogLevel = (value: string): value is LogLevel => {
  return LOG_LEVEL_VALUES.has(value);
};

const toLogLevel = (value: string, fallback: LogLevel = 'info'): LogLevel => {
  return isLogLevel(value) ? value : fallback;
};

// ── Log context ──────────────────────────────────────────────────────────────

export interface LogContext {
  /** Associated Error object — message, stack, and cause chain are extracted automatically. */
  error?: Error;
  /** Structured additional context attached to the log entry. */
  data?: Record<string, unknown>;
  /** Machine-readable error code (e.g. "AI_PROVIDER_FAIL"). */
  code?: string;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

// ── Request ID provider ─────────────────────────────────────────────────────

let requestIdStore: (() => string | undefined) | null = null;

export const setLoggerRequestIdProvider = (provider: () => string | undefined): void => {
  requestIdStore = provider;
};

// ── Runtime config (lazy-resolved, no circular deps) ─────────────────────────

let runtimeLogConfig: { level: LogLevel; format: 'text' | 'json' } | null = null;

export const setLoggerRuntimeConfig = (config: { level?: string; format?: string }): void => {
  runtimeLogConfig = {
    level: config.level !== undefined ? toLogLevel(config.level) : 'info',
    format: config.format === 'json' ? 'json' : 'text'
  };
};

// ── Per-module log level resolution ──────────────────────────────────────────

/**
 * Parse LOGGING_LEVEL env var supporting per-module prefixes:
 *
 *   LOGGING_LEVEL=info,ai=debug,inference=warn,plugins=error
 *
 * Matching uses longest-prefix match against the module name.
 */
const parseModuleLevels = (): Map<string, LogLevel> => {
  const map = new Map<string, LogLevel>();
  const raw = process.env['LOGGING_LEVEL'];
  if (!raw) return map;

  for (const segment of raw.split(',')) {
    const eqIdx = segment.lastIndexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const prefix = segment.slice(0, eqIdx).trim();
    const level = segment.slice(eqIdx + 1).trim();
    if (prefix && isLogLevel(level)) {
      map.set(prefix, level);
    }
  }
  return map;
};

const resolveModuleLogLevel = (module: string): LogLevel | null => {
  const moduleLevels = parseModuleLevels();
  if (moduleLevels.size === 0) return null;

  let bestMatch: { prefix: string; level: LogLevel } | null = null;
  for (const [prefix, level] of moduleLevels) {
    if (module.startsWith(prefix) && (!bestMatch || prefix.length > bestMatch.prefix.length)) {
      bestMatch = { prefix, level };
    }
  }
  return bestMatch?.level ?? null;
};

const resolveLoggingConfig = (): { level: LogLevel; format: 'text' | 'json' } | null => {
  const envLevelRaw = process.env['LOGGING_LEVEL'];
  const envFormatRaw = process.env['LOGGING_FORMAT'];

  if (envLevelRaw !== undefined || envFormatRaw !== undefined) {
    let resolvedLevel: LogLevel = 'info';
    if (envLevelRaw !== undefined) {
      const bareLevel = envLevelRaw.split(',')[0]!.trim().split('=')[0]!.trim();
      if (isLogLevel(bareLevel)) {
        resolvedLevel = bareLevel;
      }
    }
    return {
      level: resolvedLevel,
      format: envFormatRaw === 'json' ? 'json' : 'text'
    };
  }
  return runtimeLogConfig;
};

// ── Throttle config ──────────────────────────────────────────────────────────

interface ThrottleEntry {
  count: number;
  windowStart: number;
}

/**
 * Parse LOGGING_THROTTLE env var:
 *
 *   LOGGING_THROTTLE=error:5s/3,warn:10s/5
 *
 * Format: <level>:<window>s/<max>
 * Default: no throttling.
 */
const parseThrottleConfig = (): Map<LogLevel, { windowMs: number; maxCount: number }> => {
  const map = new Map<LogLevel, { windowMs: number; maxCount: number }>();
  const raw = process.env['LOGGING_THROTTLE'];
  if (!raw) return map;

  for (const segment of raw.split(',')) {
    const [levelPart, rulePart] = segment.split(':');
    if (!levelPart || !rulePart) continue;
    const level = levelPart.trim();
    if (!isLogLevel(level)) continue;

    const [windowPart, maxPart] = rulePart.trim().split('/');
    if (!windowPart || !maxPart) continue;
    const windowSec = parseFloat(windowPart.replace('s', ''));
    const maxCount = parseInt(maxPart, 10);
    if (isNaN(windowSec) || isNaN(maxCount)) continue;

    map.set(level, { windowMs: windowSec * 1000, maxCount });
  }
  return map;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const getRequestId = (): string | undefined => {
  return requestIdStore?.();
};

const causeToString = (cause: unknown): string => {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  if (typeof cause === 'number' || typeof cause === 'boolean') {
    return String(cause);
  }
  return 'Unknown cause';
};

const serializeError = (error: Error): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
  if (error.cause instanceof Error) {
    result['cause'] = serializeError(error.cause);
  } else if (error.cause !== undefined) {
    result['cause'] = causeToString(error.cause);
  }
  return result;
};

const formatText = (
  level: LogLevel,
  module: string,
  message: string,
  context?: LogContext
): string => {
  const ts = new Date().toISOString();
  const rid = getRequestId();
  const prefix = rid
    ? `[${ts}] [${level.toUpperCase()}] [${module}] [${rid}]`
    : `[${ts}] [${level.toUpperCase()}] [${module}]`;

  const parts: string[] = [prefix, message];

  if (context?.code) {
    parts.push(`(${context.code})`);
  }

  const extras: Record<string, unknown> = {};
  if (context?.error) {
    Object.assign(extras, serializeError(context.error));
  }
  if (context?.data) {
    Object.assign(extras, context.data);
  }
  if (Object.keys(extras).length > 0) {
    parts.push(JSON.stringify(extras));
  }

  return parts.join(' ');
};

const formatJson = (
  level: LogLevel,
  module: string,
  message: string,
  context?: LogContext
): string => {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    module,
    request_id: getRequestId() ?? null,
    message
  };

  if (context?.code) {
    entry['code'] = context.code;
  }
  if (context?.error) {
    entry['error'] = serializeError(context.error);
  }
  if (context?.data) {
    for (const [key, value] of Object.entries(context.data)) {
      entry[key] = value;
    }
  }

  return JSON.stringify(entry);
};

// ── Factory ──────────────────────────────────────────────────────────────────

export const createLogger = (module: string): Logger => {
  const throttleConfig = parseThrottleConfig();
  const throttleState = new Map<string, ThrottleEntry>();

  const shouldLog = (level: LogLevel): boolean => {
    const moduleLevel = resolveModuleLogLevel(module);
    if (moduleLevel !== null) {
      return LEVEL_ORDER[level] >= LEVEL_ORDER[moduleLevel];
    }

    const config = resolveLoggingConfig();
    if (!config) return true;
    // eslint-disable-next-line security/detect-object-injection -- internal enum
    return LEVEL_ORDER[level] >= LEVEL_ORDER[config.level];
  };

  const checkThrottle = (level: LogLevel, message: string): boolean => {
    const rule = throttleConfig.get(level);
    if (!rule) return true;

    const key = `${level}:${message}`;
    const now = Date.now();
    const entry = throttleState.get(key);

    if (!entry || now - entry.windowStart >= rule.windowMs) {
      throttleState.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count < rule.maxCount) {
      entry.count++;
      return true;
    }

    return false;
  };

  const isJson = (): boolean => {
    const config = resolveLoggingConfig();
    return config?.format === 'json';
  };

  const log = (level: LogLevel, message: string, context?: LogContext): void => {
    if (!shouldLog(level)) return;
    if (!checkThrottle(level, message)) return;

    const formatted = isJson()
      ? formatJson(level, module, message, context)
      : formatText(level, module, message, context);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
        break;
    }
  };

  return {
    debug: (msg, ctx) => { log('debug', msg, ctx); },
    info: (msg, ctx) => { log('info', msg, ctx); },
    warn: (msg, ctx) => { log('warn', msg, ctx); },
    error: (msg, ctx) => { log('error', msg, ctx); }
  };
};
