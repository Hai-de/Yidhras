import { createMemoryTriggerSidecarClient } from './rust_sidecar_client.js';
import type {
  MemoryBlockRecord,
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
  provider: 'rust_primary';
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
        provider: 'rust_primary'
      };
    } catch (error) {
      throw new Error(
        `Memory trigger Rust sidecar failed: ${error instanceof Error ? error.message : String(error)}`
      );
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
