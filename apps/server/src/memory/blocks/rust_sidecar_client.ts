import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '../../app/http/errors.js';
import { ApiError } from '../../utils/api_error.js';
import type {
  MemoryTriggerSourceEvaluateInput,
  MemoryTriggerSourceEvaluateResult
} from './types.js';

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

export interface MemoryTriggerSidecarHandshakeResponse {
  protocol_version: string;
  accepted: boolean;
  transport: string;
  engine_instance_id: string;
  supported_methods: string[];
  engine_capabilities: string[];
}

export interface MemoryTriggerSidecarHealthSnapshot {
  protocol_version: string;
  status: string;
  transport: string;
  uptime_ms: number;
}

export interface MemoryTriggerSidecarTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T>;
}

export interface MemoryTriggerSidecarClientOptions {
  binaryPath?: string;
  timeoutMs?: number;
  autoRestart?: boolean;
}

const resolveSidecarProjectDir = (): string => {
  const packageRelativePath = path.resolve(process.cwd(), 'rust/memory_trigger_sidecar');
  if (existsSync(packageRelativePath)) {
    return packageRelativePath;
  }

  return path.resolve(process.cwd(), 'apps/server/rust/memory_trigger_sidecar');
};

const resolveCargoCommand = (): string => {
  if (process.env.CARGO_BIN?.trim()) {
    return process.env.CARGO_BIN.trim();
  }

  return 'cargo';
};

const toApiError = (error: JsonRpcFailure['error']): ApiError => {
  return new ApiError(500, 'MEMORY_TRIGGER_SIDECAR_ERROR', error.message || 'Memory trigger sidecar request failed', {
    code: error.code,
    data: error.data
  });
};

class ProcessMemoryTriggerSidecarTransport implements MemoryTriggerSidecarTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private readBuffer = '';

  constructor(private readonly options: Required<MemoryTriggerSidecarClientOptions>) {}

  public async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const resolvedBinaryPath = this.options.binaryPath.trim().length > 0
      ? path.resolve(process.cwd(), this.options.binaryPath)
      : null;

    if (resolvedBinaryPath) {
      if (!existsSync(resolvedBinaryPath)) {
        throw new ApiError(500, 'MEMORY_TRIGGER_SIDECAR_NOT_READY', 'Memory trigger sidecar binary does not exist', {
          binary_path: resolvedBinaryPath
        });
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
    this.child.stdout.on('data', chunk => {
      this.handleStdout(chunk);
    });
    this.child.stderr.on('data', chunk => {
      const message = chunk.toString().trim();
      if (message.length > 0) {
        console.warn('[memory-trigger-sidecar]', message);
      }
    });
    this.child.on('exit', () => {
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      this.child = null;
      for (const request of pending) {
        clearTimeout(request.timeout);
        request.reject(new ApiError(500, 'MEMORY_TRIGGER_SIDECAR_EXITED', 'Memory trigger sidecar exited unexpectedly'));
      }
    });
    this.child.on('error', error => {
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      this.child = null;
      for (const request of pending) {
        clearTimeout(request.timeout);
        request.reject(new ApiError(500, 'MEMORY_TRIGGER_SIDECAR_NOT_READY', 'Failed to start memory trigger sidecar', {
          cause: error.message
        }));
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;
    child.kill();
  }

  public async send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    if (!this.child) {
      throw new ApiError(500, 'MEMORY_TRIGGER_SIDECAR_NOT_READY', 'Memory trigger sidecar is not running');
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
        reject(new ApiError(504, 'MEMORY_TRIGGER_SIDECAR_TIMEOUT', 'Memory trigger sidecar request timed out', {
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
          reject(new ApiError(500, 'MEMORY_TRIGGER_SIDECAR_NOT_READY', 'Failed to write to memory trigger sidecar', {
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
      console.error('[memory-trigger-sidecar] invalid JSON response', error, line);
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

export class MemoryTriggerSidecarClient {
  private started = false;
  private handshake: MemoryTriggerSidecarHandshakeResponse | null = null;

  constructor(
    private readonly transport: MemoryTriggerSidecarTransport = new ProcessMemoryTriggerSidecarTransport({
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
    this.handshake = await this.getHandshake();
    await this.getHealth();
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.started = false;
    this.handshake = null;
    await this.transport.stop();
  }

  public async getHandshake(): Promise<MemoryTriggerSidecarHandshakeResponse> {
    await this.transport.start();
    return this.transport.send('memory_trigger.protocol.handshake', {}, value => value as MemoryTriggerSidecarHandshakeResponse);
  }

  public async getHealth(): Promise<MemoryTriggerSidecarHealthSnapshot> {
    await this.transport.start();
    return this.transport.send('memory_trigger.health.get', {}, value => value as MemoryTriggerSidecarHealthSnapshot);
  }

  public async evaluateSource(input: MemoryTriggerSourceEvaluateInput): Promise<MemoryTriggerSourceEvaluateResult> {
    await this.ensureStarted();
    return this.transport.send(
      'memory_trigger.source.evaluate',
      input as unknown as Record<string, unknown>,
      value => value as MemoryTriggerSourceEvaluateResult
    );
  }

  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.start();
    }
  }
}

export const createMemoryTriggerSidecarClient = (
  options: MemoryTriggerSidecarClientOptions
): MemoryTriggerSidecarClient => {
  return new MemoryTriggerSidecarClient(
    new ProcessMemoryTriggerSidecarTransport({
      binaryPath: options.binaryPath ?? '',
      timeoutMs: options.timeoutMs ?? 500,
      autoRestart: options.autoRestart ?? true
    })
  );
};
