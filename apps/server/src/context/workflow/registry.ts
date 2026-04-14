import type { InferenceContext } from '../../inference/types.js';
import type {
  PromptWorkflowProfile,
  PromptWorkflowState,
  PromptWorkflowStepSpec
} from './types.js';

export interface PromptWorkflowStepExecutor {
  kind: PromptWorkflowStepSpec['kind'];
  execute(input: {
    context: InferenceContext;
    profile: PromptWorkflowProfile;
    spec: PromptWorkflowStepSpec;
    state: PromptWorkflowState;
  }): Promise<PromptWorkflowState>;
}

export interface PromptWorkflowStepRegistry {
  register(executor: PromptWorkflowStepExecutor): void;
  get(kind: PromptWorkflowStepSpec['kind']): PromptWorkflowStepExecutor | null;
  list(): PromptWorkflowStepExecutor[];
}

export const createPromptWorkflowStepRegistry = (
  executors: PromptWorkflowStepExecutor[] = []
): PromptWorkflowStepRegistry => {
  const executorMap = new Map<PromptWorkflowStepSpec['kind'], PromptWorkflowStepExecutor>();

  for (const executor of executors) {
    executorMap.set(executor.kind, executor);
  }

  return {
    register(executor) {
      executorMap.set(executor.kind, executor);
    },
    get(kind) {
      return executorMap.get(kind) ?? null;
    },
    list() {
      return Array.from(executorMap.values());
    }
  };
};
