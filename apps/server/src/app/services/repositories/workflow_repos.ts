import type { InferenceWorkflowRepository } from './InferenceWorkflowRepository.js';
import type { WorkflowRunRepository } from '../workflow/workflow_run_repository.js';
import type { WorkflowStepRunRepository } from '../workflow/workflow_step_repository.js';

export interface WorkflowRepositories {
  readonly inference: InferenceWorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly workflowSteps: WorkflowStepRunRepository;
}
