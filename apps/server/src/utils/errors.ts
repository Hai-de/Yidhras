// ── Error codes ──────────────────────────────────────────────────────────────

export const ErrorCode = {
  // AI
  AI_PROVIDER_FAIL: 'AI_PROVIDER_FAIL',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_CIRCUIT_OPEN: 'AI_CIRCUIT_OPEN',
  AI_STREAM_FAIL: 'AI_STREAM_FAIL',
  AI_PARSE_FAIL: 'AI_PARSE_FAIL',
  AI_NO_PROVIDER: 'AI_NO_PROVIDER',

  // Inference
  INFERENCE_COMPACTION_FAIL: 'INFERENCE_COMPACTION_FAIL',
  INFERENCE_LOCK_CONTENTION: 'INFERENCE_LOCK_CONTENTION',
  INFERENCE_STRATEGY_FAIL: 'INFERENCE_STRATEGY_FAIL',

  // Plugin
  PLUGIN_LOAD_FAIL: 'PLUGIN_LOAD_FAIL',
  PLUGIN_EXECUTION_FAIL: 'PLUGIN_EXECUTION_FAIL',
  PLUGIN_WORKER_FAIL: 'PLUGIN_WORKER_FAIL',
  PLUGIN_TERMINATE_FAIL: 'PLUGIN_TERMINATE_FAIL',

  // Pack
  PACK_LOAD_FAIL: 'PACK_LOAD_FAIL',
  PACK_SCOPE_FAIL: 'PACK_SCOPE_FAIL',
  PACK_SNAPSHOT_FAIL: 'PACK_SNAPSHOT_FAIL',

  // Scheduler
  SCHEDULER_QUERY_FAIL: 'SCHEDULER_QUERY_FAIL',
  SCHEDULER_CURSOR_PARSE_FAIL: 'SCHEDULER_CURSOR_PARSE_FAIL',

  // Sidecar
  SIDECAR_TRANSPORT_FAIL: 'SIDECAR_TRANSPORT_FAIL',
  SIDECAR_COMMUNICATION_FAIL: 'SIDECAR_COMMUNICATION_FAIL',

  // Runtime
  RUNTIME_CLOCK_PARSE_FAIL: 'RUNTIME_CLOCK_PARSE_FAIL',
  RUNTIME_PERCEPTION_FAIL: 'RUNTIME_PERCEPTION_FAIL',

  // Storage
  STORAGE_QUERY_FAIL: 'STORAGE_QUERY_FAIL',
  STORAGE_PARSE_FAIL: 'STORAGE_PARSE_FAIL',

  // Context
  CONTEXT_TRANSFORM_FAIL: 'CONTEXT_TRANSFORM_FAIL',
  CONTEXT_OVERLAY_FAIL: 'CONTEXT_OVERLAY_FAIL',

  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PARSE_FAIL: 'PARSE_FAIL',

  // Captured (used by captureError fallback)
  CAPTURED_ERROR: 'CAPTURED_ERROR'
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Base error ───────────────────────────────────────────────────────────────

export interface AppErrorOptions {
  cause?: Error;
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;

  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    if (options?.context !== undefined) {
      this.context = options.context;
    }
  }
}

// ── Domain subclasses ────────────────────────────────────────────────────────

export class AIError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'AIError';
  }
}

export class InferenceError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'InferenceError';
  }
}

export class PluginError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'PluginError';
  }
}

export class PackError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'PackError';
  }
}

export class SchedulerError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'SchedulerError';
  }
}

export class SidecarError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'SidecarError';
  }
}

export class StorageError extends AppError {
  constructor(code: string, message: string, options?: AppErrorOptions) {
    super(code, message, options);
    this.name = 'StorageError';
  }
}
