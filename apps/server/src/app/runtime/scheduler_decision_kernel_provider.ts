import type {
  SchedulerDecisionKernelPort,
  SchedulerKernelEvaluateInput,
  SchedulerKernelEvaluateOutput
} from './scheduler_decision_kernel_port.js';
import { createSchedulerDecisionSidecarClient } from './sidecar/scheduler_decision_sidecar_client.js';

export interface SchedulerDecisionKernelProvider extends SchedulerDecisionKernelPort {
  evaluateWithMetadata(input: SchedulerKernelEvaluateInput): Promise<{ output: SchedulerKernelEvaluateOutput; provider: 'rust_primary' }>;
}

export interface SchedulerDecisionKernelProviderOptions {
  timeoutMs: number;
  binaryPath: string;
  autoRestart: boolean;
}

class RustPrimarySchedulerDecisionKernelProvider implements SchedulerDecisionKernelProvider {
  private readonly rustKernel;

  constructor(private readonly options: SchedulerDecisionKernelProviderOptions) {
    this.rustKernel = createSchedulerDecisionSidecarClient({
      binaryPath: options.binaryPath,
      timeoutMs: options.timeoutMs,
      autoRestart: options.autoRestart
    });
  }

  public async evaluate(input: SchedulerKernelEvaluateInput): Promise<SchedulerKernelEvaluateOutput> {
    return (await this.evaluateWithMetadata(input)).output;
  }

  public async evaluateWithMetadata(input: SchedulerKernelEvaluateInput): Promise<{ output: SchedulerKernelEvaluateOutput; provider: 'rust_primary' }> {
    try {
      const output = await this.rustKernel.evaluate(input);
      return { output, provider: 'rust_primary' };
    } catch (error) {
      throw new Error(
        `Scheduler Rust sidecar failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export const createSchedulerDecisionKernelProvider = (
  options: SchedulerDecisionKernelProviderOptions
): SchedulerDecisionKernelProvider => {
  return new RustPrimarySchedulerDecisionKernelProvider(options);
};
