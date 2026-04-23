import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type {
  PreparedWorldStep,
  WorldEngineCommitResult,
  WorldEngineHealthSnapshot,
  WorldEngineLoadResult,
  WorldEnginePackMode,
  WorldEnginePackStatus,
  WorldProtocolHandshakeRequest,
  WorldProtocolHandshakeResponse,
  WorldRuleExecuteObjectiveRequest,
  WorldRuleExecuteObjectiveResult,
  WorldStateQuery,
  WorldStateQueryResult,
  WorldStepAbortRequest,
  WorldStepCommitRequest,
  WorldStepPrepareRequest
} from '@yidhras/contracts';
import {
  preparedWorldStepSchema,
  WORLD_ENGINE_PROTOCOL_VERSION,
  worldEngineCommitResultSchema,
  worldEngineHealthSnapshotSchema,
  worldEngineLoadResultSchema,
  worldEnginePackStatusSchema,
  worldProtocolHandshakeRequestSchema,
  worldProtocolHandshakeResponseSchema,
  worldRuleExecuteObjectiveResultSchema,
  worldStateQueryResultSchema,
} from '@yidhras/contracts';

import { resolveFromWorkspaceRoot } from '../../../config/loader.js';
import { ApiError } from '../../../utils/api_error.js';
import type { WorldEnginePort } from '../world_engine_ports.js';

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

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, 'PACK_SCOPE_DENIED', 'pack_id is required');
  }
  return normalized;
};

const toApiError = (error: JsonRpcFailure['error']): ApiError => {
  const message = typeof error.message === 'string' ? error.message : 'World engine sidecar request failed';
  const code = typeof error.message === 'string' && /^[A-Z_]+$/.test(error.message)
    ? error.message
    : 'WORLD_ENGINE_SIDECAR_ERROR';
  const status = code === 'PACK_NOT_LOADED' ? 404 : code === 'PREPARED_STEP_CONFLICT' ? 409 : 500;
  return new ApiError(status, code, message, error.data);
};

const resolveSidecarProjectDir = (): string => {
  const packageRelativePath = path.resolve(process.cwd(), 'rust/world_engine_sidecar');
  if (existsSync(packageRelativePath)) {
    return packageRelativePath;
  }

  return path.resolve(process.cwd(), 'apps/server/rust/world_engine_sidecar');
};

const resolveCargoCommand = (): string => {
  if (process.env.CARGO_BIN?.trim()) {
    return process.env.CARGO_BIN.trim();
  }
  return 'cargo';
};

export interface WorldEngineSidecarClientOptions {
  binaryPath?: string;
  timeoutMs?: number;
  autoRestart?: boolean;
}

/**
 * Transport-level implementation detail for the TS host runtime kernel.
 *
 * This abstraction exists so the host can talk to the Rust sidecar under a
 * bounded protocol. It is not intended to become an upper-layer ABI for
 * plugins, routes or workflow consumers.
 */
export interface WorldEngineSidecarTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T>;
}

class ProcessWorldEngineSidecarTransport implements WorldEngineSidecarTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private readBuffer = '';

  constructor(private readonly options: Required<WorldEngineSidecarClientOptions>) {}

  public async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const configuredBinaryPath = this.options.binaryPath.trim();
    const resolvedBinaryPath = configuredBinaryPath.length > 0
      ? resolveFromWorkspaceRoot(configuredBinaryPath)
      : null;

    if (resolvedBinaryPath) {
      if (!existsSync(resolvedBinaryPath)) {
        throw new ApiError(500, 'WORLD_ENGINE_SIDECAR_NOT_READY', 'World engine sidecar binary does not exist', {
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
        console.warn('[world-engine-sidecar]', message);
      }
    });
    this.child.on('exit', () => {
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      this.child = null;
      for (const request of pending) {
        clearTimeout(request.timeout);
        request.reject(new ApiError(500, 'WORLD_ENGINE_SIDECAR_EXITED', 'World engine sidecar exited unexpectedly'));
      }
    });
    this.child.on('error', error => {
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      this.child = null;
      for (const request of pending) {
        clearTimeout(request.timeout);
        request.reject(new ApiError(500, 'WORLD_ENGINE_SIDECAR_NOT_READY', 'Failed to start world engine sidecar', {
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
      throw new ApiError(500, 'WORLD_ENGINE_SIDECAR_NOT_READY', 'World engine sidecar is not running');
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
        reject(new ApiError(504, 'WORLD_ENGINE_SIDECAR_TIMEOUT', 'World engine sidecar request timed out', {
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
          reject(new ApiError(500, 'WORLD_ENGINE_SIDECAR_NOT_READY', 'Failed to write to world engine sidecar', {
            cause: error instanceof Error ? error.message : String(error)
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
      console.error('[world-engine-sidecar] invalid JSON response', error, line);
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

export class WorldEngineSidecarClient implements WorldEnginePort {
  private handshake: WorldProtocolHandshakeResponse | null = null;

  private readonly transport: WorldEngineSidecarTransport;

  constructor(transportOrOptions?: WorldEngineSidecarTransport | WorldEngineSidecarClientOptions) {
    if (transportOrOptions && this.isTransport(transportOrOptions)) {
      this.transport = transportOrOptions;
      return;
    }

    this.transport = new ProcessWorldEngineSidecarTransport({
      binaryPath: transportOrOptions?.binaryPath ?? '',
      timeoutMs: transportOrOptions?.timeoutMs ?? 500,
      autoRestart: transportOrOptions?.autoRestart ?? true
    });
  }

  public async start(): Promise<void> {
    await this.transport.start();
    const request: WorldProtocolHandshakeRequest = worldProtocolHandshakeRequestSchema.parse({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      transport: 'stdio_jsonrpc',
      host_capabilities: ['typescript_host', 'prepared_commit']
    });
    this.handshake = await this.transport.send('world.protocol.handshake', request, worldProtocolHandshakeResponseSchema.parse);
  }

  public async stop(): Promise<void> {
    this.handshake = null;
    await this.transport.stop();
  }

  public async loadPack(input: Parameters<WorldEnginePort['loadPack']>[0]): Promise<WorldEngineLoadResult> {
    await this.ensureStarted();
    return this.call('world.pack.load', {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: normalizePackId(input.pack_id),
      pack_ref: input.pack_ref,
      mode: (input.mode ?? 'active') as WorldEnginePackMode,
      hydrate: input.hydrate,
      correlation_id: input.correlation_id,
      idempotency_key: input.idempotency_key
    }, worldEngineLoadResultSchema.parse);
  }

  public async unloadPack(input: Parameters<WorldEnginePort['unloadPack']>[0]): Promise<void> {
    await this.ensureStarted();
    await this.call('world.pack.unload', {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: normalizePackId(input.pack_id),
      correlation_id: input.correlation_id,
      idempotency_key: input.idempotency_key
    }, value => value);
  }

  public async prepareStep(input: WorldStepPrepareRequest): Promise<PreparedWorldStep> {
    await this.ensureStarted();
    return this.call('world.step.prepare', input, preparedWorldStepSchema.parse);
  }

  public async commitPreparedStep(input: WorldStepCommitRequest): Promise<WorldEngineCommitResult> {
    await this.ensureStarted();
    return this.call('world.step.commit', input, worldEngineCommitResultSchema.parse);
  }

  public async abortPreparedStep(input: WorldStepAbortRequest): Promise<void> {
    await this.ensureStarted();
    await this.call('world.step.abort', input, value => value);
  }

  public async queryState(input: WorldStateQuery): Promise<WorldStateQueryResult> {
    await this.ensureStarted();
    return this.call('world.state.query', input, worldStateQueryResultSchema.parse);
  }

  public async getStatus(input: { pack_id: string; correlation_id?: string }): Promise<WorldEnginePackStatus> {
    await this.ensureStarted();
    return this.call('world.status.get', {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: normalizePackId(input.pack_id),
      correlation_id: input.correlation_id
    }, worldEnginePackStatusSchema.parse);
  }

  public async getHealth(): Promise<WorldEngineHealthSnapshot> {
    await this.ensureStarted();
    return this.call('world.health.get', {
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION
    }, worldEngineHealthSnapshotSchema.parse);
  }

  private async ensureStarted(): Promise<void> {
    if (!this.handshake) {
      await this.start();
    }
  }

  private async call<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    return this.transport.send(method, params, parse);
  }

  public async executeObjectiveRule(input: WorldRuleExecuteObjectiveRequest): Promise<WorldRuleExecuteObjectiveResult> {
    await this.ensureStarted();
    return this.call('world.rule.execute_objective', input, worldRuleExecuteObjectiveResultSchema.parse);
  }

  private isTransport(
    value: WorldEngineSidecarTransport | WorldEngineSidecarClientOptions
  ): value is WorldEngineSidecarTransport {
    return typeof (value as WorldEngineSidecarTransport).start === 'function'
      && typeof (value as WorldEngineSidecarTransport).stop === 'function'
      && typeof (value as WorldEngineSidecarTransport).send === 'function';
  }
}

export const createWorldEngineSidecarClient = (
  options: WorldEngineSidecarClientOptions
): WorldEngineSidecarClient => new WorldEngineSidecarClient(options);
