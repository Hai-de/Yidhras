import type {
  SchedulerDecisionKernelPort,
  SchedulerKernelEvaluateInput,
  SchedulerKernelEvaluateOutput
} from '../scheduler_decision_kernel_port.js';
import {
  StdioJsonRpcTransport,
  type StdioJsonRpcTransportOptions} from './stdio_jsonrpc_transport.js';

export interface SchedulerDecisionSidecarHealthSnapshot {
  protocol_version: string;
  status: string;
  transport: string;
  uptime_ms: number;
}

export interface SchedulerDecisionSidecarTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send<T>(
    method: string,
    params: Record<string, unknown>,
    parse: (value: unknown) => T
  ): Promise<T>;
}

export interface SchedulerDecisionSidecarClientOptions {
  binaryPath?: string;
  timeoutMs?: number;
  autoRestart?: boolean;
  packId?: string;
}

/**
 * Thin subclass of StdioJsonRpcTransport with scheduler-decision defaults.
 */
class SchedulerDecisionTransport extends StdioJsonRpcTransport {
  constructor(options?: SchedulerDecisionSidecarClientOptions) {
    const opts: StdioJsonRpcTransportOptions = {
      binaryPath: options?.binaryPath ?? '',
      projectDir: 'rust/scheduler-decision',
      cargoArgs: options?.packId ? ['--pack-id', options.packId] : [],
      timeoutMs: options?.timeoutMs ?? 500,
      heartbeatIntervalMs: 5000,
      heartbeatMethod: 'scheduler.health.get',
      heartbeatFailureThreshold: 2,
      maxRestartAttempts: 3,
      restartBackoffBaseMs: 500,
      errorCodePrefix: 'SCHEDULER_DECISION_SIDECAR',
      logLabel: 'scheduler-decision-sidecar',
      autoRestart: options?.autoRestart ?? true
    };
    super(opts);
  }
}

export class SchedulerDecisionSidecarClient implements SchedulerDecisionKernelPort {
  private started = false;

  constructor(
    private readonly transport: SchedulerDecisionSidecarTransport = new SchedulerDecisionTransport()
  ) {
    // 监听重连，无状态 sidecar 只需重新 handshake
    if (transport instanceof StdioJsonRpcTransport) {
      transport.on('restarted', () => {
        this.started = false;
        void this.start();
      });
      transport.on('unhealthy', () => {
        this.started = false;
      });
    }
  }

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
    return this.transport.send(
      'scheduler.health.get',
      {},
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      (value) => value as SchedulerDecisionSidecarHealthSnapshot
    );
  }

  public async evaluate(
    input: SchedulerKernelEvaluateInput
  ): Promise<SchedulerKernelEvaluateOutput> {
    await this.ensureStarted();
    return this.transport.send(
      'scheduler.kernel.evaluate',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- double assertion boundary
      input as unknown as Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      (value) => value as SchedulerKernelEvaluateOutput
    );
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
  return new SchedulerDecisionSidecarClient(new SchedulerDecisionTransport(options));
};
