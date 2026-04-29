import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveFromWorkspaceRoot } from '../../../config/loader.js';
import { ApiError } from '../../../utils/api_error.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('scheduler-decision-sidecar');
import type {
  SchedulerDecisionKernelPort,
  SchedulerKernelEvaluateInput,
  SchedulerKernelEvaluateOutput
} from '../scheduler_decision_kernel_port.js';

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timeout: NodeJS.Timeout;
}

export interface SchedulerDecisionSidecarHealthSnapshot {
  protocol_version: string;
  status: string;
  transport: string;
  uptime_ms: number;
}

export interface SchedulerDecisionSidecarTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T>;
}

export interface SchedulerDecisionSidecarClientOptions {
  binaryPath?: string;
  timeoutMs?: number;
  autoRestart?: boolean;
}

const resolveSidecarProjectDir = (): string => {
  const packageRelativePath = path.resolve(process.cwd(), 'rust/scheduler_decision_sidecar');
  if (existsSync(packageRelativePath)) {
    return packageRelativePath;
  }

  return path.resolve(process.cwd(), 'apps/server/rust/scheduler_decision_sidecar');
};

const resolveCargoCommand = (): string => {
  if (process.env.CARGO_BIN?.trim()) {
    return process.env.CARGO_BIN.trim();
  }
  return 'cargo';
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const toApiError = (error: JsonRpcFailure['error']): ApiError => {
  return new ApiError(500, 'SCHEDULER_DECISION_SIDECAR_ERROR', error.message || 'Scheduler decision sidecar request failed', {
    code: error.code,
    data: error.data
  });
};

class ProcessSchedulerDecisionSidecarTransport implements SchedulerDecisionSidecarTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private readBuffer = '';

  constructor(private readonly options: Required<SchedulerDecisionSidecarClientOptions>) {}

  public start(): Promise<void> {
    if (this.child) {
      return Promise.resolve();
    }

    const configuredBinaryPath = this.options.binaryPath.trim();
    const resolvedBinaryPath = configuredBinaryPath.length > 0
      ? resolveFromWorkspaceRoot(configuredBinaryPath)
      : null;

    if (resolvedBinaryPath) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- binary path from admin configuration
      if (!existsSync(resolvedBinaryPath)) {
        return Promise.reject(new ApiError(500, 'SCHEDULER_DECISION_SIDECAR_NOT_READY', 'Scheduler decision sidecar binary does not exist', {
          binary_path: resolvedBinaryPath
        }));
      }

      this.child = spawn(resolvedBinaryPath, [], {
        cwd: path.dirname(resolvedBinaryPath),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } else {
      const projectDir = resolveSidecarProjectDir();
      this.child = spawn(resolveCargoCommand(), ['run', '--quiet'], {
        cwd: projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.handleStdout(chunk);
    });
    this.child.stderr.on('data', (chunk: string) => {
      const message = chunk.toString().trim();
      if (message.length > 0) {
        logger.warn(message);
      }
    });
    this.child.on('exit', () => {
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      this.child = null;
      for (const request of pending) {
        clearTimeout(request.timeout);
        request.reject(new ApiError(500, 'SCHEDULER_DECISION_SIDECAR_EXITED', 'Scheduler decision sidecar exited unexpectedly'));
      }
    });
    this.child.on('error', error => {
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      this.child = null;
      for (const request of pending) {
        clearTimeout(request.timeout);
        request.reject(new ApiError(500, 'SCHEDULER_DECISION_SIDECAR_NOT_READY', 'Failed to start scheduler decision sidecar', {
          cause: error.message
        }));
      }
    });

    return Promise.resolve();
  }

  public async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;

    child.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* 进程已退出 */ }
        resolve();
      }, 3000);

      child.on('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
    });
  }

  public async send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    if (!this.child) {
      throw new ApiError(500, 'SCHEDULER_DECISION_SIDECAR_NOT_READY', 'Scheduler decision sidecar is not running');
    }

    const id = `rpc-${++this.requestId}`;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    });

    const result = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        if (this.options.autoRestart) {
          void this.stop();
        }
        reject(new ApiError(504, 'SCHEDULER_DECISION_SIDECAR_TIMEOUT', 'Scheduler decision sidecar request timed out', {
          method,
          timeout_ms: this.options.timeoutMs
        }));
      }, this.options.timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.child?.stdin.write(`${payload}\n`, error => {
        if (error) {
          const pendingRequest = this.pending.get(id);
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeout);
          }
          this.pending.delete(id);
          reject(new ApiError(500, 'SCHEDULER_DECISION_SIDECAR_NOT_READY', 'Failed to write to scheduler decision sidecar', {
            cause: getErrorMessage(error)
          }));
        }
      });
    });

    return parse(result);
  }

  private handleStdout(chunk: string): void {
    this.readBuffer += chunk;
    let newlineIndex = this.readBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.readBuffer.slice(0, newlineIndex).trim();
      this.readBuffer = this.readBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.handleResponseLine(line);
      }
      newlineIndex = this.readBuffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    let parsed: JsonRpcResponse<unknown>;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse<unknown>;
    } catch (error) {
      logger.error('invalid JSON response', { error: getErrorMessage(error), line: line.slice(0, 200) });
      return;
    }

    const id = parsed.id ?? null;
    if (typeof id !== 'string') {
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);

    if ('error' in parsed && parsed.error) {
      pending.reject(toApiError(parsed.error));
      return;
    }

    pending.resolve((parsed as JsonRpcSuccess<unknown>).result);
  }
}

export class SchedulerDecisionSidecarClient implements SchedulerDecisionKernelPort {
  private started = false;

  constructor(
    private readonly transport: SchedulerDecisionSidecarTransport = new ProcessSchedulerDecisionSidecarTransport({
      binaryPath: '',
      timeoutMs: 500,
      autoRestart: true
    })
  ) {}

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }
    await this.transport.start();
    await this.getHealth();
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.started = false;
    await this.transport.stop();
  }

  public async getHealth(): Promise<SchedulerDecisionSidecarHealthSnapshot> {
    await this.transport.start();
    return this.transport.send('scheduler.health.get', {}, value => value as SchedulerDecisionSidecarHealthSnapshot);
  }

  public async evaluate(input: SchedulerKernelEvaluateInput): Promise<SchedulerKernelEvaluateOutput> {
    await this.ensureStarted();
    return this.transport.send('scheduler.kernel.evaluate', input as unknown as Record<string, unknown>, value => value as SchedulerKernelEvaluateOutput);
  }

  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.start();
    }
  }
}

export const createSchedulerDecisionSidecarClient = (
  options: SchedulerDecisionSidecarClientOptions
): SchedulerDecisionSidecarClient => {
  return new SchedulerDecisionSidecarClient(
    new ProcessSchedulerDecisionSidecarTransport({
      binaryPath: options.binaryPath ?? '',
      timeoutMs: options.timeoutMs ?? 500,
      autoRestart: options.autoRestart ?? true
    })
  );
};
