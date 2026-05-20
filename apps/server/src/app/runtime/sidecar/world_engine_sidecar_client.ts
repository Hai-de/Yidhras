import type {
  PreparedWorldStep,
  WorldEngineCommitResult,
  WorldEngineHealthSnapshot,
  WorldEngineLoadResult,
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
  worldStateQueryResultSchema
} from '@yidhras/contracts';

import { ApiError } from '../../../utils/api_error.js';
import { createLogger } from '../../../utils/logger.js';
import type { WorldEnginePort } from '../world_engine_ports.js';
import {
  StdioJsonRpcTransport,
  type StdioJsonRpcTransportOptions} from './stdio_jsonrpc_transport.js';

const logger = createLogger('world-engine-sidecar');

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, 'PACK_SCOPE_DENIED', 'pack_id is required');
  }
  return normalized;
};

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

export interface WorldEngineSidecarClientOptions {
  binaryPath?: string;
  timeoutMs?: number;
  autoRestart?: boolean;
}

/**
 * Thin subclass of StdioJsonRpcTransport with world-engine defaults.
 */
class WorldEngineTransport extends StdioJsonRpcTransport {
  constructor(options?: WorldEngineSidecarClientOptions) {
    const opts: StdioJsonRpcTransportOptions = {
      binaryPath: options?.binaryPath ?? '',
      projectDir: 'rust/world-engine',
      timeoutMs: options?.timeoutMs ?? 5000,
      heartbeatIntervalMs: 10000,
      heartbeatMethod: 'world.health.get',
      heartbeatFailureThreshold: 2,
      maxRestartAttempts: 3,
      restartBackoffBaseMs: 500,
      errorCodePrefix: 'WORLD_ENGINE_SIDECAR',
      logLabel: 'world-engine-sidecar',
      autoRestart: options?.autoRestart ?? true
    };
    super(opts);
  }
}

export class WorldEngineSidecarClient implements WorldEnginePort {
  private handshake: WorldProtocolHandshakeResponse | null = null;
  private readonly transport: WorldEngineSidecarTransport;
  private readonly loadedPacks = new Map<
    string,
    Parameters<WorldEnginePort['loadPack']>[0]
  >();

  constructor(transportOrOptions?: WorldEngineSidecarTransport | WorldEngineSidecarClientOptions) {
    if (transportOrOptions && this.isTransport(transportOrOptions)) {
      this.transport = transportOrOptions;
      return;
    }

    const transport = new WorldEngineTransport(transportOrOptions);

    // 监听不健康事件以触发上层恢复
    transport.on('unhealthy', () => {
      logger.error('transport unhealthy, triggering recovery');
      void this.handleTransportUnhealthy();
    });

    // 监听重连成功事件以恢复 packs
    transport.on('restarted', () => {
      logger.warn('transport restarted, reloading packs');
      void this.handleTransportRestarted();
    });

    this.transport = transport;
  }

  public async start(): Promise<void> {
    await this.transport.start();
    const request: WorldProtocolHandshakeRequest = worldProtocolHandshakeRequestSchema.parse({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      transport: 'stdio_jsonrpc',
      host_capabilities: ['typescript_host', 'prepared_commit']
    });
    this.handshake = await this.transport.send(
      'world.protocol.handshake',
      request,
      (v) => worldProtocolHandshakeResponseSchema.parse(v)
    );
    // 版本协商
    const sidecarVersion: string = this.handshake.protocol_version;
    if (sidecarVersion !== WORLD_ENGINE_PROTOCOL_VERSION) {
      throw new ApiError(
        500,
        'WORLD_ENGINE_PROTOCOL_MISMATCH',
        `Protocol version mismatch: host ${WORLD_ENGINE_PROTOCOL_VERSION}, sidecar ${sidecarVersion}`
      );
    }
  }

  public async stop(): Promise<void> {
    this.handshake = null;
    this.loadedPacks.clear();
    await this.transport.stop();
  }

  public async loadPack(
    input: Parameters<WorldEnginePort['loadPack']>[0]
  ): Promise<WorldEngineLoadResult> {
    await this.ensureStarted();
    const packId = normalizePackId(input.pack_id);
    const result = await this.call(
      'world.pack.load',
      {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: packId,
        pack_ref: input.pack_ref,
        mode: input.mode ?? 'active',
        hydrate: input.hydrate,
        correlation_id: input.correlation_id,
        idempotency_key: input.idempotency_key
      },
      (v) => worldEngineLoadResultSchema.parse(v)
    );
    // 记录已加载的 pack 以供 crash 后恢复
    this.loadedPacks.set(packId, input);
    return result;
  }

  public async unloadPack(
    input: Parameters<WorldEnginePort['unloadPack']>[0]
  ): Promise<void> {
    await this.ensureStarted();
    const packId = normalizePackId(input.pack_id);
    await this.call(
      'world.pack.unload',
      {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: packId,
        correlation_id: input.correlation_id,
        idempotency_key: input.idempotency_key
      },
      (value) => value
    );
    this.loadedPacks.delete(packId);
  }

  public async prepareStep(
    input: WorldStepPrepareRequest
  ): Promise<PreparedWorldStep> {
    await this.ensureStarted();
    return this.call('world.step.prepare', input, (v) => preparedWorldStepSchema.parse(v));
  }

  public async commitPreparedStep(
    input: WorldStepCommitRequest
  ): Promise<WorldEngineCommitResult> {
    await this.ensureStarted();
    return this.call('world.step.commit', input, (v) =>
      worldEngineCommitResultSchema.parse(v)
    );
  }

  public async abortPreparedStep(
    input: WorldStepAbortRequest
  ): Promise<void> {
    await this.ensureStarted();
    await this.call('world.step.abort', input, (value) => value);
  }

  public async queryState(input: WorldStateQuery): Promise<WorldStateQueryResult> {
    await this.ensureStarted();
    return this.call('world.state.query', input, (v) => worldStateQueryResultSchema.parse(v));
  }

  public async getStatus(
    input: { pack_id: string; correlation_id?: string }
  ): Promise<WorldEnginePackStatus> {
    await this.ensureStarted();
    return this.call(
      'world.status.get',
      {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: normalizePackId(input.pack_id),
        correlation_id: input.correlation_id
      },
      (v) => worldEnginePackStatusSchema.parse(v)
    );
  }

  public async getHealth(): Promise<WorldEngineHealthSnapshot> {
    await this.ensureStarted();
    return this.call(
      'world.health.get',
      {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION
      },
      (v) => worldEngineHealthSnapshotSchema.parse(v)
    );
  }

  public async executeObjectiveRule(
    input: WorldRuleExecuteObjectiveRequest
  ): Promise<WorldRuleExecuteObjectiveResult> {
    await this.ensureStarted();
    return this.call('world.rule.execute_objective', input, (v) =>
      worldRuleExecuteObjectiveResultSchema.parse(v)
    );
  }

  // ─── recovery ──────────────────────────────────────────────────

  private async handleTransportUnhealthy(): Promise<void> {
    this.handshake = null;
    try {
      await this.transport.stop();
    } catch {
      // transport may already be stopped
    }

    try {
      await this.transport.start();
      await this.start(); // re-handshake + version check
      await this.reloadAllPacks();
    } catch (error) {
      logger.error('failed to recover from unhealthy transport', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleTransportRestarted(): Promise<void> {
    try {
      await this.start(); // re-handshake
      await this.reloadAllPacks();
    } catch (error) {
      logger.error('failed to reload packs after transport restart', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async reloadAllPacks(): Promise<void> {
    const packs = Array.from(this.loadedPacks.entries());
    this.loadedPacks.clear();

    for (const [, loadInput] of packs) {
      try {
        await this.loadPack(loadInput);
        logger.info('reloaded pack after transport recovery', { packId: loadInput.pack_id });
      } catch (error) {
        logger.error('failed to reload pack after transport recovery', {
          packId: loadInput.pack_id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // ─── internals ─────────────────────────────────────────────────

  private async ensureStarted(): Promise<void> {
    if (!this.handshake) {
      await this.start();
    }
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    parse: (value: unknown) => T
  ): Promise<T> {
    return this.transport.send(method, params, parse);
  }

  private isTransport(
    value: WorldEngineSidecarTransport | WorldEngineSidecarClientOptions
  ): value is WorldEngineSidecarTransport {
    return (
      typeof (value as WorldEngineSidecarTransport).start === 'function' &&
      typeof (value as WorldEngineSidecarTransport).stop === 'function' &&
      typeof (value as WorldEngineSidecarTransport).send === 'function'
    );
  }
}

export const createWorldEngineSidecarClient = (
  options: WorldEngineSidecarClientOptions
): WorldEngineSidecarClient => new WorldEngineSidecarClient(options);
