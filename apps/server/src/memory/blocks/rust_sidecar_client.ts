import {
  StdioJsonRpcTransport,
  type StdioJsonRpcTransportOptions} from '../../app/runtime/sidecar/stdio_jsonrpc_transport.js';
import type {
  MemoryTriggerSourceEvaluateInput,
  MemoryTriggerSourceEvaluateResult
} from './types.js';

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
  send<T>(
    method: string,
    params: Record<string, unknown>,
    parse: (value: unknown) => T
  ): Promise<T>;
}

export interface MemoryTriggerSidecarClientOptions {
  binaryPath?: string;
  timeoutMs?: number;
  autoRestart?: boolean;
}

/**
 * Thin subclass of StdioJsonRpcTransport with memory-trigger defaults.
 */
class MemoryTriggerTransport extends StdioJsonRpcTransport {
  constructor(options?: MemoryTriggerSidecarClientOptions) {
    const opts: StdioJsonRpcTransportOptions = {
      binaryPath: options?.binaryPath ?? '',
      projectDir: 'rust/memory-trigger',
      timeoutMs: options?.timeoutMs ?? 500,
      heartbeatIntervalMs: 5000,
      heartbeatMethod: 'memory_trigger.health.get',
      heartbeatFailureThreshold: 2,
      maxRestartAttempts: 3,
      restartBackoffBaseMs: 500,
      errorCodePrefix: 'MEMORY_TRIGGER_SIDECAR',
      logLabel: 'memory-trigger-sidecar',
      autoRestart: options?.autoRestart ?? true
    };
    super(opts);
  }
}

export class MemoryTriggerSidecarClient {
  private started = false;
  private handshake: MemoryTriggerSidecarHandshakeResponse | null = null;

  constructor(
    private readonly transport: MemoryTriggerSidecarTransport = new MemoryTriggerTransport()
  ) {
    if (transport instanceof StdioJsonRpcTransport) {
      transport.on('restarted', () => {
        this.started = false;
        this.handshake = null;
        void this.start();
      });
      transport.on('unhealthy', () => {
        this.started = false;
        this.handshake = null;
      });
    }
  }

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
    return this.transport.send(
      'memory_trigger.protocol.handshake',
      {},
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      (value) => value as MemoryTriggerSidecarHandshakeResponse
    );
  }

  public async getHealth(): Promise<MemoryTriggerSidecarHealthSnapshot> {
    await this.transport.start();
    return this.transport.send(
      'memory_trigger.health.get',
      {},
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      (value) => value as MemoryTriggerSidecarHealthSnapshot
    );
  }

  public async evaluateSource(
    input: MemoryTriggerSourceEvaluateInput
  ): Promise<MemoryTriggerSourceEvaluateResult> {
    await this.ensureStarted();
    return this.transport.send(
      'memory_trigger.source.evaluate',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- provider payload serialization
      input as unknown as Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      (value) => value as MemoryTriggerSourceEvaluateResult
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
  return new MemoryTriggerSidecarClient(new MemoryTriggerTransport(options));
};
