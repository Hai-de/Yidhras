import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveFromWorkspaceRoot } from '../../../config/loader.js';
import { ApiError } from '../../../utils/api_error.js';
import { createLogger } from '../../../utils/logger.js';
import { getErrorMessage } from '../../http/errors.js';

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

export interface StdioJsonRpcTransportOptions {
  /** 预编译二进制路径。空字符串表示使用 cargo run */
  binaryPath: string;
  /** cargo 项目根目录（相对于 workspace root 或 process.cwd） */
  projectDir: string;
  /** cargo run 的额外参数（如 ['--', '--pack-id', 'xxx']） */
  cargoArgs?: string[];
  /** 单次 RPC 请求超时（毫秒），默认 5000 */
  timeoutMs?: number;
  /** 心跳间隔（毫秒），0 表示禁用。默认 0 */
  heartbeatIntervalMs?: number;
  /** 心跳用的 RPC 方法名 */
  heartbeatMethod?: string;
  /** 连续心跳失败几次触发 unhealthy 事件。默认 2 */
  heartbeatFailureThreshold?: number;
  /** 进程 crash 后最大重连次数。默认 3 */
  maxRestartAttempts?: number;
  /** 重连退避基数（毫秒）。默认 500 */
  restartBackoffBaseMs?: number;
  /** ApiError code 前缀（如 'WORLD_ENGINE_SIDECAR'） */
  errorCodePrefix: string;
  /** 日志标签 */
  logLabel: string;
  /** 是否自动重启崩溃的进程 */
  autoRestart?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 0;
const DEFAULT_HEARTBEAT_FAILURE_THRESHOLD = 2;
const DEFAULT_MAX_RESTART_ATTEMPTS = 3;
const DEFAULT_RESTART_BACKOFF_BASE_MS = 500;

export type UnhealthyReason = 'heartbeat_failure' | 'process_exit' | 'start_failure';

export interface UnhealthyEvent {
  reason: UnhealthyReason;
  consecutiveFailures: number;
  message: string;
}

const resolveCargoCommand = (): string => {
  if (process.env.CARGO_BIN?.trim()) {
    return process.env.CARGO_BIN.trim();
  }
  return 'cargo';
};

/**
 * 共享的 stdio JSON-RPC 传输层基类。
 *
 * 提供：
 * - 子进程 spawn（binary 或 cargo run）
 * - NDJSON 帧解析（\n 分隔）
 * - 请求/响应映射（JSON-RPC id 关联）
 * - 每请求超时
 * - 心跳 + 不健康检测
 * - 进程 crash 后自动重连（带指数退避）
 * - 背压处理（stdin drain 事件）
 * - 优雅关闭（先关 stdin，再 SIGKILL）
 */
export class StdioJsonRpcTransport extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private readBuffer = '';
  private stopped = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatFailures = 0;
  private restartAttempts = 0;
  private stopping = false;
  private readonly logger;

  protected readonly options: Required<StdioJsonRpcTransportOptions>;

  constructor(options: StdioJsonRpcTransportOptions) {
    super();
    this.options = {
      binaryPath: options.binaryPath,
      projectDir: options.projectDir,
      cargoArgs: options.cargoArgs ?? [],
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      heartbeatMethod: options.heartbeatMethod ?? '',
      heartbeatFailureThreshold: options.heartbeatFailureThreshold ?? DEFAULT_HEARTBEAT_FAILURE_THRESHOLD,
      maxRestartAttempts: options.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS,
      restartBackoffBaseMs: options.restartBackoffBaseMs ?? DEFAULT_RESTART_BACKOFF_BASE_MS,
      errorCodePrefix: options.errorCodePrefix,
      logLabel: options.logLabel,
      autoRestart: options.autoRestart ?? true
    };
    this.logger = createLogger(this.options.logLabel);
  }

  // ─── public API ────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await -- async needed for interface contract
  public async start(): Promise<void> {
    if (this.child) {
      return;
    }
    this.stopped = false;
    this.stopping = false;
    this.spawnProcess();
    this.startHeartbeat();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.stopping = true;
    this.stopHeartbeat();
    await this.shutdownProcess();
  }

  public async send<T>(
    method: string,
    params: Record<string, unknown>,
    parse: (value: unknown) => T
  ): Promise<T> {
    const result = await this.sendRaw(method, params);
    return parse(result);
  }

  // ─── process lifecycle ─────────────────────────────────────────

  private spawnProcess(): void {
    const configuredBinaryPath = this.options.binaryPath.trim();
    const resolvedBinaryPath =
      configuredBinaryPath.length > 0
        ? resolveFromWorkspaceRoot(configuredBinaryPath)
        : null;

    if (resolvedBinaryPath) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- admin-configured path
      if (!existsSync(resolvedBinaryPath)) {
        throw new ApiError(
          500,
          `${this.options.errorCodePrefix}_NOT_READY`,
          `${this.options.logLabel} binary does not exist`,
          { binary_path: resolvedBinaryPath }
        );
      }

      this.child = spawn(resolvedBinaryPath, [], {
        cwd: path.dirname(resolvedBinaryPath),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } else {
      const projectDir = this.resolveProjectDir();
      const cargoArgs = ['run', '--quiet'];
      if (this.options.cargoArgs.length > 0) {
        cargoArgs.push('--', ...this.options.cargoArgs);
      }
      this.child = spawn(resolveCargoCommand(), cargoArgs, {
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
        this.logger.warn(message);
      }
    });
    this.child.on('exit', () => {
      this.onProcessExit();
    });
    this.child.on('error', (error) => {
      this.onProcessError(error);
    });
  }

  private async shutdownProcess(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;

    // 拒绝所有新的 send() 调用会在 sendRaw 入口检查
    // 先优雅地关 stdin —— Rust 侧看到 EOF 后自然退出
    try {
      child.stdin.end();
    } catch {
      // stdin 可能已经关闭
    }

    // 等待进程自然退出，最多 3 秒
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // 进程已退出
        }
        resolve();
      }, 3000);

      child.on('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
    });
  }

  // ─── NDJSON framing ────────────────────────────────────────────

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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- from-any: JSON.parse boundary
      parsed = JSON.parse(line) as JsonRpcResponse<unknown>;
    } catch (error) {
      this.logger.error('invalid JSON response', {
        error: getErrorMessage(error),
        line: line.slice(0, 200)
      });
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
      pending.reject(this.toApiError(parsed.error));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    pending.resolve((parsed as JsonRpcSuccess<unknown>).result);
  }

  // ─── RPC send ──────────────────────────────────────────────────

  private async sendRaw(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child || this.stopping) {
      throw new ApiError(
        500,
        `${this.options.errorCodePrefix}_NOT_READY`,
        `${this.options.logLabel} is not running`
      );
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
        reject(
          new ApiError(
            504,
            `${this.options.errorCodePrefix}_TIMEOUT`,
            `${this.options.logLabel} request timed out`,
            { method, timeout_ms: this.options.timeoutMs }
          )
        );
      }, this.options.timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      const ok = this.child!.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          const pendingRequest = this.pending.get(id);
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeout);
          }
          this.pending.delete(id);
          reject(
            new ApiError(
              500,
              `${this.options.errorCodePrefix}_NOT_READY`,
              `Failed to write to ${this.options.logLabel}`,
              { cause: error instanceof Error ? error.message : String(error) }
            )
          );
        }
      });

      // 背压处理：写入缓冲区满时暂停
      if (!ok) {
        this.child!.stdin.once('drain', () => {
          // drain 后继续，不需要额外操作 —— write callback 已排队
        });
      }
    });

    return result;
  }

  // ─── heartbeat ─────────────────────────────────────────────────

  private startHeartbeat(): void {
    if (this.options.heartbeatIntervalMs <= 0 || !this.options.heartbeatMethod) {
      return;
    }

    this.heartbeatFailures = 0;
    this.heartbeatTimer = setInterval(() => {
      void this.runHeartbeat();
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatFailures = 0;
  }

  private async runHeartbeat(): Promise<void> {
    try {
      await this.sendRaw(this.options.heartbeatMethod, {});
      this.heartbeatFailures = 0;
    } catch {
      this.heartbeatFailures++;
      if (this.heartbeatFailures >= this.options.heartbeatFailureThreshold) {
        this.stopHeartbeat();
        this.emit('unhealthy', {
          reason: 'heartbeat_failure',
          consecutiveFailures: this.heartbeatFailures,
          message: `${this.options.logLabel} heartbeat failed ${this.heartbeatFailures} times consecutively`
        } satisfies UnhealthyEvent);
      }
    }
  }

  // ─── crash recovery ────────────────────────────────────────────

  private onProcessExit(): void {
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const request of pending) {
      clearTimeout(request.timeout);
      request.reject(
        new ApiError(
          500,
          `${this.options.errorCodePrefix}_EXITED`,
          `${this.options.logLabel} exited unexpectedly`
        )
      );
    }

    this.stopHeartbeat();
    this.child = null;

    if (this.stopped) {
      return;
    }

    // 自动重连
    if (this.options.autoRestart) {
      void this.attemptRestart();
    } else {
      this.emit('unhealthy', {
        reason: 'process_exit',
        consecutiveFailures: 1,
        message: `${this.options.logLabel} exited unexpectedly and autoRestart is disabled`
      } satisfies UnhealthyEvent);
    }
  }

  private onProcessError(error: Error): void {
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const request of pending) {
      clearTimeout(request.timeout);
      request.reject(
        new ApiError(
          500,
          `${this.options.errorCodePrefix}_NOT_READY`,
          `Failed to start ${this.options.logLabel}`,
          { cause: error.message }
        )
      );
    }

    this.stopHeartbeat();
    this.child = null;

    if (this.stopped) {
      return;
    }

    this.logger.error('process error', { error: error.message });

    if (this.options.autoRestart) {
      void this.attemptRestart();
    } else {
      this.emit('unhealthy', {
        reason: 'start_failure',
        consecutiveFailures: 1,
        message: `${this.options.logLabel} process error: ${error.message}`
      } satisfies UnhealthyEvent);
    }
  }

  private async attemptRestart(): Promise<void> {
    while (this.restartAttempts < this.options.maxRestartAttempts && !this.stopped) {
      this.restartAttempts++;
      const delay = this.options.restartBackoffBaseMs * Math.pow(2, this.restartAttempts - 1);

      this.logger.warn(
        `restart attempt ${this.restartAttempts}/${this.options.maxRestartAttempts} in ${delay}ms`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      if (this.stopped) {
        return;
      }

      try {
        this.spawnProcess();
        this.restartAttempts = 0;
        this.startHeartbeat();
        this.emit('restarted', { attempt: this.restartAttempts });
        return;
      } catch (error) {
        this.logger.error(
          `restart attempt ${this.restartAttempts} failed: ${getErrorMessage(error)}`
        );
      }
    }

    if (!this.stopped) {
      this.emit('unhealthy', {
        reason: 'start_failure',
        consecutiveFailures: this.restartAttempts,
        message: `${this.options.logLabel} failed to restart after ${this.options.maxRestartAttempts} attempts`
      } satisfies UnhealthyEvent);
    }
  }

  // ─── helpers ───────────────────────────────────────────────────

  private resolveProjectDir(): string {
    const packageRelativePath = path.resolve(process.cwd(), this.options.projectDir);
    if (existsSync(packageRelativePath)) {
      return packageRelativePath;
    }

    return path.resolve(process.cwd(), 'apps/server', this.options.projectDir);
  }

  private toApiError(error: JsonRpcFailure['error']): ApiError {
    const message =
      typeof error.message === 'string'
        ? error.message
        : `${this.options.logLabel} request failed`;
    const code =
      typeof error.message === 'string' && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : `${this.options.errorCodePrefix}_ERROR`;
    const status =
      code === 'PACK_NOT_LOADED'
        ? 404
        : code === 'PREPARED_STEP_CONFLICT'
          ? 409
          : 500;
    return new ApiError(status, code, message, error.data);
  }
}
