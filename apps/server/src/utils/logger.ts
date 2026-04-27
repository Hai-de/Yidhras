export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

let requestIdStore: (() => string | undefined) | null = null;

export const setLoggerRequestIdProvider = (provider: () => string | undefined): void => {
  requestIdStore = provider;
};

/**
 * 惰性解析日志配置，避免循环依赖（logger → runtime_config → init → logger）。
 * 优先 process.env，其次通过 setLoggerRuntimeConfig() 注入的运行时配置。
 */
let runtimeLogConfig: { level: LogLevel; format: 'text' | 'json' } | null = null;

export const setLoggerRuntimeConfig = (config: { level?: string; format?: string }): void => {
  runtimeLogConfig = {
    level: (config.level && LEVEL_ORDER[config.level as LogLevel] !== undefined ? config.level as LogLevel : 'info'),
    format: config.format === 'json' ? 'json' : 'text'
  };
};

const resolveLoggingConfig = (): { level: LogLevel; format: 'text' | 'json' } | null => {
  const envLevel = process.env.LOGGING_LEVEL as LogLevel | undefined;
  const envFormat = process.env.LOGGING_FORMAT as 'text' | 'json' | undefined;
  if (envLevel || envFormat) {
    return {
      level: (envLevel && LEVEL_ORDER[envLevel] !== undefined ? envLevel : 'info'),
      format: (envFormat === 'json' ? 'json' : 'text')
    };
  }
  return runtimeLogConfig;
};

const getRequestId = (): string | undefined => {
  return requestIdStore?.();
};

const formatText = (level: LogLevel, module: string, message: string, data?: Record<string, unknown>): string => {
  const ts = new Date().toISOString();
  const rid = getRequestId();
  const prefix = rid ? `[${ts}] [${level.toUpperCase()}] [${module}] [${rid}]` : `[${ts}] [${level.toUpperCase()}] [${module}]`;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  return `${prefix} ${message}${suffix}`;
};

const formatJson = (level: LogLevel, module: string, message: string, data?: Record<string, unknown>): string => {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    module,
    request_id: getRequestId() ?? null,
    message,
    ...(data ?? {})
  });
};

export const createLogger = (module: string): Logger => {
  const shouldLog = (level: LogLevel): boolean => {
    const config = resolveLoggingConfig();
    if (!config) return true;
    return LEVEL_ORDER[level] >= LEVEL_ORDER[config.level];
  };

  const isJson = (): boolean => {
    const config = resolveLoggingConfig();
    return config?.format === 'json';
  };

  const log = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (!shouldLog(level)) return;

    const formatted = isJson()
      ? formatJson(level, module, message, data)
      : formatText(level, module, message, data);

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
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data)
  };
};
