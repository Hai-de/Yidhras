import { createMemoryTriggerSidecarClient } from './rust_sidecar_client.js';
import { applyMemoryActivationToRuntimeState, evaluateMemoryBlockActivation } from './trigger_engine.js';
import type {
  MemoryBlockRecord,
  MemoryTriggerEngineEvaluationMetadata,
  MemoryTriggerSourceEvaluateInput,
  MemoryTriggerSourceEvaluateResult
} from './types.js';

export interface MemoryTriggerEngineProviderOptions {
  timeoutMs: number;
  binaryPath: string;
  autoRestart: boolean;
}

export interface MemoryTriggerEngineEvaluationResult {
  result: MemoryTriggerSourceEvaluateResult;
  metadata: MemoryTriggerEngineEvaluationMetadata;
}

/**
 * @deprecated TS fallback for the memory trigger engine.
 * Provided solely as a safety net when the Rust sidecar fails.
 * Not maintained for feature development — will be removed in a future release.
 * Do NOT add new features or behavioral changes to this function.
 */
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

const TS_FALLBACK_DEPRECATION_WARNING =
  '[DEPRECATED] Memory trigger engine fell back to TS implementation. ' +
  'The TS fallback is not maintained and may be removed in a future release. ' +
  'Investigate the Rust sidecar error that triggered this fallback.';

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
      console.warn(TS_FALLBACK_DEPRECATION_WARNING);
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

export interface MemoryTriggerEngineProvider {
  evaluateWithMetadata(input: MemoryTriggerSourceEvaluateInput): Promise<MemoryTriggerEngineEvaluationResult>;
}

export const createMemoryTriggerEngineProvider = (
  options: MemoryTriggerEngineProviderOptions
): MemoryTriggerEngineProvider => {
  return new RustPrimaryMemoryTriggerEngineProvider(options);
};

export const buildMemoryTriggerSourceEvaluateInput = (input: {
  evaluation_context: MemoryTriggerSourceEvaluateInput['evaluation_context'];
  candidates: MemoryBlockRecord[];
}): MemoryTriggerSourceEvaluateInput => ({
  protocol_version: 'memory_trigger/v1alpha1',
  evaluation_context: input.evaluation_context,
  candidates: input.candidates
});