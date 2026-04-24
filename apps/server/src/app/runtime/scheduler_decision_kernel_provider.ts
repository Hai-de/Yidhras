import { createTsSchedulerDecisionKernel } from './scheduler_decision_kernel.js';
import type {
  SchedulerDecisionKernelPort,
  SchedulerKernelEvaluateInput,
  SchedulerKernelEvaluateOutput
} from './scheduler_decision_kernel_port.js';
import { createSchedulerDecisionSidecarClient } from './sidecar/scheduler_decision_sidecar_client.js';

export interface SchedulerDecisionKernelEvaluationMetadata {
  provider: 'rust_primary' | 'rust_fallback_to_ts';
  fallback: boolean;
  fallback_reason: string | null;
  parity_status: 'skipped';
  parity_diff_count: 0;
}

export interface SchedulerDecisionKernelEvaluationResult {
  output: SchedulerKernelEvaluateOutput;
  metadata: SchedulerDecisionKernelEvaluationMetadata;
}

export interface SchedulerDecisionKernelProvider extends SchedulerDecisionKernelPort {
  evaluateWithMetadata(input: SchedulerKernelEvaluateInput): Promise<SchedulerDecisionKernelEvaluationResult>;
}

export interface SchedulerDecisionKernelProviderOptions {
  timeoutMs: number;
  binaryPath: string;
  autoRestart: boolean;
}

const TS_FALLBACK_DEPRECATION_WARNING =
  '[DEPRECATED] Scheduler decision kernel fell back to TS implementation. ' +
  'The TS fallback is not maintained and may be removed in a future release. ' +
  'Investigate the Rust sidecar error that triggered this fallback.';

class RustPrimarySchedulerDecisionKernelProvider implements SchedulerDecisionKernelProvider {
  private readonly fallbackKernel = createTsSchedulerDecisionKernel();
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

  public async evaluateWithMetadata(input: SchedulerKernelEvaluateInput): Promise<SchedulerDecisionKernelEvaluationResult> {
    try {
      const output = await this.rustKernel.evaluate(input);
      return {
        output,
        metadata: {
          provider: 'rust_primary',
          fallback: false,
          fallback_reason: null,
          parity_status: 'skipped',
          parity_diff_count: 0
        }
      };
    } catch (error) {
      console.warn(TS_FALLBACK_DEPRECATION_WARNING);
      const fallbackOutput = await this.fallbackKernel.evaluate(input);
      return {
        output: fallbackOutput,
        metadata: {
          provider: 'rust_fallback_to_ts',
          fallback: true,
          fallback_reason: error instanceof Error ? error.message : String(error),
          parity_status: 'skipped',
          parity_diff_count: 0
        }
      };
    }
  }
}

export const createSchedulerDecisionKernelProvider = (
  options: SchedulerDecisionKernelProviderOptions
): SchedulerDecisionKernelProvider => {
  return new RustPrimarySchedulerDecisionKernelProvider(options);
};