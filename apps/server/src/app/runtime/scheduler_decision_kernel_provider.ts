import {
  createTsSchedulerDecisionKernel,
  evaluateSchedulerDecisionKernel
} from './scheduler_decision_kernel.js';
import type {
  SchedulerDecisionKernelPort,
  SchedulerKernelEvaluateInput,
  SchedulerKernelEvaluateOutput
} from './scheduler_decision_kernel_port.js';
import { createSchedulerDecisionSidecarClient } from './sidecar/scheduler_decision_sidecar_client.js';

export type SchedulerDecisionKernelMode = 'ts' | 'rust_shadow' | 'rust_primary';

export interface SchedulerDecisionKernelEvaluationMetadata {
  provider: SchedulerDecisionKernelMode | 'rust_fallback_to_ts';
  fallback: boolean;
  fallback_reason: string | null;
  parity_status: 'match' | 'diff' | 'skipped';
  parity_diff_count: number;
}

export interface SchedulerDecisionKernelEvaluationResult {
  output: SchedulerKernelEvaluateOutput;
  metadata: SchedulerDecisionKernelEvaluationMetadata;
}

export interface SchedulerDecisionKernelProvider extends SchedulerDecisionKernelPort {
  evaluateWithMetadata(input: SchedulerKernelEvaluateInput): Promise<SchedulerDecisionKernelEvaluationResult>;
}

export interface SchedulerDecisionKernelProviderOptions {
  mode: SchedulerDecisionKernelMode;
  timeoutMs: number;
  binaryPath: string;
  autoRestart: boolean;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => canonicalize(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }

  return value;
};

const isCanonicalEqual = (left: unknown, right: unknown): boolean => {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
};

const countOutputDiffs = (
  left: SchedulerKernelEvaluateOutput,
  right: SchedulerKernelEvaluateOutput
): number => {
  let diffCount = 0;
  if (!isCanonicalEqual(left.summary, right.summary)) {
    diffCount += 1;
  }
  if (!isCanonicalEqual(left.job_drafts, right.job_drafts)) {
    diffCount += 1;
  }
  if (!isCanonicalEqual(left.candidate_decisions, right.candidate_decisions)) {
    diffCount += 1;
  }
  return diffCount;
};

class TsSchedulerDecisionKernelProvider implements SchedulerDecisionKernelProvider {
  private readonly kernel = createTsSchedulerDecisionKernel();

  public async evaluate(input: SchedulerKernelEvaluateInput): Promise<SchedulerKernelEvaluateOutput> {
    return this.kernel.evaluate(input);
  }

  public async evaluateWithMetadata(input: SchedulerKernelEvaluateInput): Promise<SchedulerDecisionKernelEvaluationResult> {
    const output = await this.evaluate(input);
    return {
      output,
      metadata: {
        provider: 'ts',
        fallback: false,
        fallback_reason: null,
        parity_status: 'skipped',
        parity_diff_count: 0
      }
    };
  }
}

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

class RustShadowSchedulerDecisionKernelProvider implements SchedulerDecisionKernelProvider {
  private readonly tsKernel = createTsSchedulerDecisionKernel();
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
    const tsOutput = await this.tsKernel.evaluate(input);
    try {
      const rustOutput = await this.rustKernel.evaluate(input);
      const diffCount = countOutputDiffs(tsOutput, rustOutput);
      return {
        output: tsOutput,
        metadata: {
          provider: 'rust_shadow',
          fallback: false,
          fallback_reason: null,
          parity_status: diffCount === 0 ? 'match' : 'diff',
          parity_diff_count: diffCount
        }
      };
    } catch (error) {
      return {
        output: tsOutput,
        metadata: {
          provider: 'rust_shadow',
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
  switch (options.mode) {
    case 'rust_primary':
      return new RustPrimarySchedulerDecisionKernelProvider(options);
    case 'rust_shadow':
      return new RustShadowSchedulerDecisionKernelProvider(options);
    case 'ts':
    default:
      return new TsSchedulerDecisionKernelProvider();
  }
};

export const getSchedulerDecisionKernelParityPreview = (
  input: SchedulerKernelEvaluateInput
): SchedulerKernelEvaluateOutput => {
  return evaluateSchedulerDecisionKernel(input);
};
