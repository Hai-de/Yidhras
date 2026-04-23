import { createMemoryTriggerSidecarClient } from './rust_sidecar_client.js';
import { applyMemoryActivationToRuntimeState, evaluateMemoryBlockActivation } from './trigger_engine.js';
import type {
  MemoryBlockRecord,
  MemoryTriggerEngineEvaluationMetadata,
  MemoryTriggerEngineMode,
  MemoryTriggerSourceEvaluateInput,
  MemoryTriggerSourceEvaluateResult
} from './types.js';

export interface MemoryTriggerEngineProviderOptions {
  mode: MemoryTriggerEngineMode;
  timeoutMs: number;
  binaryPath: string;
  autoRestart: boolean;
}

export interface MemoryTriggerEngineEvaluationResult {
  result: MemoryTriggerSourceEvaluateResult;
  metadata: MemoryTriggerEngineEvaluationMetadata;
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

const countOutputDiffs = (left: MemoryTriggerSourceEvaluateResult, right: MemoryTriggerSourceEvaluateResult): number => {
  let diffCount = 0;
  if (!isCanonicalEqual(left.diagnostics, right.diagnostics)) {
    diffCount += 1;
  }
  if (!isCanonicalEqual(left.records, right.records)) {
    diffCount += 1;
  }
  return diffCount;
};

const evaluateWithTs = (input: MemoryTriggerSourceEvaluateInput): MemoryTriggerSourceEvaluateResult => {
  const statusCounts: MemoryTriggerSourceEvaluateResult['diagnostics']['status_counts'] = {
    active: 0,
    retained: 0,
    delayed: 0,
    cooling: 0,
    inactive: 0
  };
  let materializedCount = 0;
  let triggerRatePresentCount = 0;
  let triggerRateAppliedCount = 0;
  let triggerRateBlockedCount = 0;

  const records = input.candidates.map(record => {
    const evaluation = evaluateMemoryBlockActivation({
      block: record.block,
      behavior: record.behavior,
      state: record.state,
      context: input.evaluation_context
    });

    const nextRuntimeState = applyMemoryActivationToRuntimeState({
      behavior: record.behavior,
      evaluation,
      previousState: record.state,
      currentTick: input.evaluation_context.current_tick
    });

    const shouldMaterialize = evaluation.status === 'active' || evaluation.status === 'retained';
    if (shouldMaterialize) {
      materializedCount += 1;
    }
    statusCounts[evaluation.status] += 1;

    if (evaluation.trigger_diagnostics.trigger_rate.present) {
      triggerRatePresentCount += 1;
    }
    if (evaluation.trigger_diagnostics.trigger_rate.applied) {
      triggerRateAppliedCount += 1;
    }
    if (evaluation.trigger_diagnostics.trigger_rate.passed === false) {
      triggerRateBlockedCount += 1;
    }

    return {
      memory_id: record.block.id,
      evaluation,
      next_runtime_state: nextRuntimeState,
      should_materialize: shouldMaterialize,
      materialize_reason: evaluation.status === 'active' || evaluation.status === 'retained' ? evaluation.status : null,
      trigger_rate: evaluation.trigger_diagnostics.trigger_rate
    };
  });

  return {
    protocol_version: input.protocol_version,
    records,
    diagnostics: {
      candidate_count: input.candidates.length,
      materialized_count: materializedCount,
      status_counts: statusCounts,
      trigger_rate: {
        present_count: triggerRatePresentCount,
        applied_count: triggerRateAppliedCount,
        blocked_count: triggerRateBlockedCount
      }
    }
  };
};

class TsMemoryTriggerEngineProvider {
  public async evaluateWithMetadata(input: MemoryTriggerSourceEvaluateInput): Promise<MemoryTriggerEngineEvaluationResult> {
    return {
      result: evaluateWithTs(input),
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

class RustPrimaryMemoryTriggerEngineProvider {
  private readonly rustEngine;

  constructor(private readonly options: MemoryTriggerEngineProviderOptions) {
    this.rustEngine = createMemoryTriggerSidecarClient({
      binaryPath: options.binaryPath,
      timeoutMs: options.timeoutMs,
      autoRestart: options.autoRestart
    });
  }

  public async evaluateWithMetadata(input: MemoryTriggerSourceEvaluateInput): Promise<MemoryTriggerEngineEvaluationResult> {
    try {
      return {
        result: await this.rustEngine.evaluateSource(input),
        metadata: {
          provider: 'rust_primary',
          fallback: false,
          fallback_reason: null,
          parity_status: 'skipped',
          parity_diff_count: 0
        }
      };
    } catch (error) {
      return {
        result: evaluateWithTs(input),
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

class RustShadowMemoryTriggerEngineProvider {
  private readonly rustEngine;

  constructor(private readonly options: MemoryTriggerEngineProviderOptions) {
    this.rustEngine = createMemoryTriggerSidecarClient({
      binaryPath: options.binaryPath,
      timeoutMs: options.timeoutMs,
      autoRestart: options.autoRestart
    });
  }

  public async evaluateWithMetadata(input: MemoryTriggerSourceEvaluateInput): Promise<MemoryTriggerEngineEvaluationResult> {
    const tsResult = evaluateWithTs(input);
    try {
      const rustResult = await this.rustEngine.evaluateSource(input);
      const diffCount = countOutputDiffs(tsResult, rustResult);
      return {
        result: tsResult,
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
        result: tsResult,
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

export interface MemoryTriggerEngineProvider {
  evaluateWithMetadata(input: MemoryTriggerSourceEvaluateInput): Promise<MemoryTriggerEngineEvaluationResult>;
}

export const createMemoryTriggerEngineProvider = (
  options: MemoryTriggerEngineProviderOptions
): MemoryTriggerEngineProvider => {
  switch (options.mode) {
    case 'rust_primary':
      return new RustPrimaryMemoryTriggerEngineProvider(options);
    case 'rust_shadow':
      return new RustShadowMemoryTriggerEngineProvider(options);
    case 'ts':
    default:
      return new TsMemoryTriggerEngineProvider();
  }
};

export const buildMemoryTriggerSourceEvaluateInput = (input: {
  evaluation_context: MemoryTriggerSourceEvaluateInput['evaluation_context'];
  candidates: MemoryBlockRecord[];
}): MemoryTriggerSourceEvaluateInput => ({
  protocol_version: 'memory_trigger/v1alpha1',
  evaluation_context: input.evaluation_context,
  candidates: input.candidates
});
