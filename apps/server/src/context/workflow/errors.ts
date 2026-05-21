import type { InferenceStrategy } from '../../inference/types.js';
import type { PromptWorkflowTaskType } from './types.js';

export interface PromptWorkflowProfileErrorDetails {
  task_type: PromptWorkflowTaskType;
  strategy: InferenceStrategy;
  pack_id: string;
  profile_id?: string | null;
}

export class PromptWorkflowProfileNotFoundError extends Error {
  readonly code = 'PROMPT_WORKFLOW_PROFILE_NOT_FOUND';
  readonly details: PromptWorkflowProfileErrorDetails;

  constructor(details: PromptWorkflowProfileErrorDetails) {
    super(`Prompt workflow profile not found: ${details.profile_id ?? ''}`);
    this.name = 'PromptWorkflowProfileNotFoundError';
    this.details = details;
  }
}

export class PromptWorkflowProfileSelectionError extends Error {
  readonly code = 'PROMPT_WORKFLOW_PROFILE_SELECTION_FAILED';
  readonly details: PromptWorkflowProfileErrorDetails;

  constructor(details: PromptWorkflowProfileErrorDetails) {
    super(
      `No prompt workflow profile matched task_type=${details.task_type}, strategy=${details.strategy}, pack_id=${details.pack_id}`
    );
    this.name = 'PromptWorkflowProfileSelectionError';
    this.details = details;
  }
}
