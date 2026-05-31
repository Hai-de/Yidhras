import type { AgentRepository } from './AgentRepository.js';
import type { IdentityOperatorRepository } from './IdentityOperatorRepository.js';
import type { InferenceWorkflowRepository } from './InferenceWorkflowRepository.js';
import type { MemoryRepository } from './MemoryRepository.js';
import type { NarrativeEventRepository } from './NarrativeEventRepository.js';
import type { PluginRepository } from './PluginRepository.js';
import type { RelationshipGraphRepository } from './RelationshipGraphRepository.js';
import type { SocialRepository } from './SocialRepository.js';
import type { WorkflowRunRepository } from '../workflow/workflow_run_repository.js';
import type { WorkflowStepRunRepository } from '../workflow/workflow_step_repository.js';

export interface Repositories {
  readonly inference: InferenceWorkflowRepository;
  readonly identityOperator: IdentityOperatorRepository;
  readonly memory: MemoryRepository;
  readonly narrative: NarrativeEventRepository;
  readonly relationship: RelationshipGraphRepository;
  readonly plugin: PluginRepository;
  readonly agent: AgentRepository;
  readonly social: SocialRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly workflowSteps: WorkflowStepRunRepository;
}
