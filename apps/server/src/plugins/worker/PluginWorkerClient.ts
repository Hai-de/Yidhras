import { Worker } from 'node:worker_threads';

import type { DataContext, PortContext } from '../../app/context.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import {
  recordPluginWorkerCrash,
  recordPluginWorkerInvocationCompleted
} from '../../observability/metrics.js';
import { attachErrorMetadata } from '../../utils/error_source.js';
import { createLogger } from '../../utils/logger.js';
import type { ContributionDescriptor } from './contribution_descriptors.js';
import { PluginWorkerCrashError, PluginWorkerTimeoutError } from './errors.js';
import { handlePluginWorkerHostCall } from './host_call_handler.js';
import {
  type MainToWorkerMessage,
  parseWorkerToMainMessage,
  type PluginWorkerActivationInput,
  serializePluginError,
  type WorkerToMainMessage
} from './protocol.js';
import { resolvePluginWorkerEntry } from './worker_entry_resolver.js';

const logger = createLogger('plugin-worker-client');

const extractErrorMessage = (value: unknown): string => {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const msg = (value as Record<string, unknown>)['message'];
    if (typeof msg === 'string') return msg;
  }
  return 'Plugin worker request failed';
};

const extractErrorName = (value: unknown): string => {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const name = (value as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name;
  }
  return 'PluginWorkerRequestError';
};

const extractErrorStack = (value: unknown): string | undefined => {
  if (typeof value === 'object' && value !== null && 'stack' in value) {
    const stack = (value as Record<string, unknown>)['stack'];
    if (typeof stack === 'string') return stack;
  }
  return undefined;
};

type PendingKind = 'activation' | 'invoke' | 'deactivate' | 'host_result';

interface PendingRequest {
  kind: PendingKind;
  timer: NodeJS.Timeout;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface PluginWorkerRuntimeSnapshot {
  descriptors: ContributionDescriptor[];
  loadedServer: boolean;
  threadId: number;
  handlerNames: string[];
}

export class PluginWorkerClient {
  private readonly context: DataContext & PortContext;
  private readonly packId: string;
  private readonly pluginId: string;
  public readonly installationId: string;
  private readonly grantedCapabilities: string[];
  private readonly worker: Worker;
  private readonly onCrash?: (error: Error) => void;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly maxConsecutiveFailures: number;
  private sequence = 0;
  private alive = true;
  private crashRecorded = false;
  private consecutiveFailures = 0;

  constructor(input: {
    context: DataContext & PortContext;
    packId: string;
    pluginId: string;
    installationId: string;
    grantedCapabilities: string[];
    onCrash?: (error: Error) => void;
  }) {
    this.context = input.context;
    this.packId = input.packId;
    this.pluginId = input.pluginId;
    this.installationId = input.installationId;
    this.grantedCapabilities = input.grantedCapabilities;
// @ts-expect-error -- EOPT strict mode
    this.onCrash = input.onCrash;

    const isolation = getRuntimeConfig().plugins.isolation;
    this.maxConsecutiveFailures = isolation.max_consecutive_failures;
    const entry = resolvePluginWorkerEntry();
    this.worker = new Worker(entry.workerUrl, {
      resourceLimits: {
        maxOldGenerationSizeMb: isolation.resource_limits.max_old_generation_size_mb,
        maxYoungGenerationSizeMb: isolation.resource_limits.max_young_generation_size_mb,
        stackSizeMb: isolation.resource_limits.stack_size_mb
      },
      ...(entry.execArgv ? { execArgv: entry.execArgv } : {})
    });

    this.worker.on('message', raw => { this.handleMessage(raw); });
    this.worker.on('error', error => { this.handleCrash(error); });
    this.worker.on('exit', code => {
      this.alive = false;
      if (code !== 0) {
        this.handleCrash(new PluginWorkerCrashError(`Plugin worker exited with code ${code}`));
      }
    });
  }

  public get threadId(): number {
    return this.worker.threadId;
  }

  public isAlive(): boolean {
    return this.alive;
  }

  public activate(input: PluginWorkerActivationInput): Promise<PluginWorkerRuntimeSnapshot> {
    const timeoutMs = getRuntimeConfig().plugins.isolation.activation_timeout_ms;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    return this.request('activation', timeoutMs, {
      type: 'activate',
      requestId: this.nextRequestId('activate'),
      input
    }) as Promise<PluginWorkerRuntimeSnapshot>;
  }

  public invoke(
    contributionType: string,
    invoke: string,
    payload: unknown,
    options?: { timeoutMs?: number }
  ): Promise<unknown> {
    const timeoutMs = options?.timeoutMs ?? getRuntimeConfig().plugins.isolation.invocation_timeout_ms;
    const startedAt = Date.now();
    return this.request('invoke', timeoutMs, {
      type: 'invoke',
      requestId: this.nextRequestId('invoke'),
      input: { contributionType, invoke, payload }
    })
      .then(result => {
        this.consecutiveFailures = 0;
        recordPluginWorkerInvocationCompleted(
          this.packId,
          this.pluginId,
          this.installationId,
          contributionType,
          Date.now() - startedAt,
          'success'
        );
        return result;
      })
      .catch((error: unknown) => {
        this.consecutiveFailures += 1;
        recordPluginWorkerInvocationCompleted(
          this.packId,
          this.pluginId,
          this.installationId,
          contributionType,
          Date.now() - startedAt,
          'failed'
        );
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.handleCrash(new PluginWorkerCrashError(
            `Plugin worker exceeded max consecutive invocation failures (${this.maxConsecutiveFailures})`
          ));
        }
        throw error;
      });
  }

  public async deactivate(): Promise<void> {
    const timeoutMs = getRuntimeConfig().plugins.isolation.deactivate_timeout_ms;
    await this.request('deactivate', timeoutMs, {
      type: 'deactivate',
      requestId: this.nextRequestId('deactivate')
    });
  }

  public async terminate(reason: string): Promise<void> {
    this.alive = false;
    this.rejectAll(new PluginWorkerCrashError(`Plugin worker terminated: ${reason}`));
    await this.worker.terminate();
  }

  private nextRequestId(prefix: string): string {
    return `${prefix}:${this.installationId}:${Date.now()}:${++this.sequence}`;
  }

  private request(kind: PendingKind, timeoutMs: number, message: MainToWorkerMessage): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject(new PluginWorkerCrashError('Plugin worker is not alive'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new PluginWorkerTimeoutError(`${kind} timed out after ${timeoutMs}ms`));
        if (kind === 'activation' || kind === 'deactivate') {
          void this.terminate(`${kind} timeout`);
        }
      }, timeoutMs);

      this.pending.set(message.requestId, { kind, timer, resolve, reject });
      this.worker.postMessage(message);
    });
  }

  private handleMessage(raw: unknown): void {
    let message: WorkerToMainMessage;
    try {
      message = parseWorkerToMainMessage(raw);
    } catch (error) {
      logger.error('Invalid plugin worker message', { error: error instanceof Error ? error : new Error(String(error)), data: { pack_id: this.packId,
        plugin_id: this.pluginId,
        installation_id: this.installationId } });
      return;
    }

    switch (message.type) {
      case 'activation_result':
        this.resolvePending(message.requestId, message.ok, message.ok ? {
          descriptors: message.result.descriptors,
          loadedServer: message.result.loadedServer,
          threadId: this.threadId,
          handlerNames: message.result.handlerNames
        } : message.error);
        break;
      case 'invoke_result':
        this.resolvePending(message.requestId, message.ok, message.ok ? message.result : message.error);
        break;
      case 'deactivate_result':
        this.resolvePending(message.requestId, message.ok, message.ok ? undefined : message.error);
        break;
      case 'host_call':
        void this.handleHostCall(message);
        break;
      case 'log':
        logger[message.level](message.message, {
          data: {
            pack_id: this.packId,
            plugin_id: this.pluginId,
            installation_id: this.installationId,
            ...(message.fields ?? {})
          }
        });
        break;
    }
  }

  private resolvePending(requestId: string, ok: boolean, value: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (ok) {
      pending.resolve(value);
      return;
    }
    const next = new Error(extractErrorMessage(value));
    next.name = extractErrorName(value);
// @ts-expect-error -- EOPT strict mode
    next.stack = extractErrorStack(value);

    // 保留序列化时跨线程传输的 source_location 和 cause
    const errorPayload = (typeof value === 'object' && value !== null) ? value : null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting known optional fields from serialized cross-thread error
    const sourceLoc = errorPayload ? (errorPayload as Record<string, unknown>)['source_location'] : undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extracting known optional fields from serialized cross-thread error
    const causeVal = errorPayload ? (errorPayload as Record<string, unknown>)['cause'] : undefined;

    const meta: { source_location?: { file: string; line?: number; column?: number }; cause?: unknown } = {};
    if (sourceLoc && typeof sourceLoc === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural type extraction from cross-thread payload
      const sl = sourceLoc as Record<string, unknown>;
      if (typeof sl['file'] === 'string') {
        const loc: { file: string; line?: number; column?: number } = { file: sl['file'] };
        if (typeof sl['line'] === 'number') loc.line = sl['line'];
        if (typeof sl['column'] === 'number') loc.column = sl['column'];
        meta.source_location = loc;
      }
    }
    if (causeVal !== undefined) {
      meta.cause = causeVal;
    }
    attachErrorMetadata(next, meta);

    pending.reject(next);
  }

  private async handleHostCall(message: Extract<WorkerToMainMessage, { type: 'host_call' }>): Promise<void> {
    try {
      const result = await handlePluginWorkerHostCall(
        {
          appContext: this.context,
          packId: this.packId,
          pluginId: this.pluginId,
          installationId: this.installationId,
          grantedCapabilities: this.grantedCapabilities
        },
        message.method,
        message.payload
      );
      this.worker.postMessage({ type: 'host_result', requestId: message.requestId, ok: true, result } satisfies MainToWorkerMessage);
    } catch (error) {
      this.worker.postMessage({
        type: 'host_result',
        requestId: message.requestId,
        ok: false,
        error: serializePluginError(error)
      } satisfies MainToWorkerMessage);
    }
  }

  private handleCrash(error: Error): void {
    this.alive = false;
    if (!this.crashRecorded) {
      this.crashRecorded = true;
      recordPluginWorkerCrash(this.packId, this.pluginId, this.installationId);
    }
    logger.error('Plugin worker crashed', { error: error instanceof Error ? error : new Error(String(error)), data: { pack_id: this.packId,
      plugin_id: this.pluginId,
      installation_id: this.installationId } });
    this.onCrash?.(error);
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}
