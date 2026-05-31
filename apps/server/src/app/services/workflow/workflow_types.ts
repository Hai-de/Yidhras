import type { WorkflowInferencePort } from '../../../inference/workflow_inference_port.js';
import type { WorldPackWorkflowCondition } from '../../../packs/schema/constitution_schema.js';
import type { AppContext } from '../../context.js';
import type { PackRuntimePort } from '../pack/pack_runtime_ports.js';

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'narrativized' | 'timed_out';

export type WorkflowStepRunStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'narrativized'
  | 'timed_out';

export interface WorkflowAdvanceBudget {
  max_rounds_per_tick: number;
  max_steps_per_tick: number;
  max_wall_time_ms_per_tick: number;
}

export interface WorkflowAdvanceInput {
  context: AppContext;
  inferenceService: WorkflowInferencePort;
  packRuntime: PackRuntimePort;
  workerId: string;
  tick: bigint;
  budget: WorkflowAdvanceBudget;
}

export interface WorkflowAdvanceResult {
  advanced_run_count: number;
  executed_step_count: number;
  completed_run_count: number;
  failed_run_count: number;
  narrativized_run_count: number;
  budget_exhausted: boolean;
}

export interface TriggerWorkflowInput {
  context: AppContext;
  packRuntime: PackRuntimePort;
  workflow_name: string;
  trigger_type: 'manual' | 'event';
  trigger_ref: string | null;
  trigger_tick: bigint;
}

export interface WorkflowRecoveryInput {
  context: AppContext;
  packRuntime: PackRuntimePort;
  workerId: string;
  tick: bigint;
}

export interface WorkflowRecoveryResult {
  expired_run_count: number;
  expired_step_count: number;
  recovered_step_count: number;
  failed_step_count: number;
}

export interface WorkflowRunRecord {
  id: string;
  workflow_name: string;
  pack_id: string;
  status: WorkflowRunStatus;
  created_tick: bigint;
  last_advance_tick: bigint;
  max_ticks: number;
  trigger_type: 'manual' | 'event';
  trigger_ref: string | null;
  lock_worker_id: string | null;
  lock_expires_at: bigint | null;
  idempotency_key: string;
}

export interface WorkflowStepRunRecord {
  id: string;
  workflow_run_id: string;
  step_id: string;
  agent_id: string;
  partition_id: number;
  status: WorkflowStepRunStatus;
  dependency_step_ids: string[];
  input_step_ids: string[];
  result_json: WorkflowStepResultJson | null;
  error_json: Record<string, unknown> | null;
  action_intent_ids: string[];
  attempt: number;
  started_tick: bigint | null;
  completed_tick: bigint | null;
  lock_worker_id: string | null;
  lock_expires_at: bigint | null;
  idempotency_key: string;
}

export type WorkflowConditionEvaluationResult =
  | { outcome: 'true' }
  | { outcome: 'false' }
  | { outcome: 'condition_error'; code: string; message: string };

export interface WorkflowStepResultJson {
  reasoning: string | null;
  decision_summary: string | null;
  grounding_result: {
    type: 'exact' | 'translated' | 'narrativized' | 'blocked';
    semantic_intent: string | null;
  };
  inference_id: string | null;
  action_intent_ids: string[];
}

export interface PreviousAgentOutputSource {
  source_type: 'previous_agent_output';
  workflow_run_id: string;
  step_id: string;
  agent_id: string;
  content: {
    reasoning: string | null;
    decision_summary: string | null;
    grounding_result_type: 'exact' | 'translated' | 'narrativized' | 'blocked';
    semantic_intent: string | null;
  };
}

export interface WorkflowActionIntentSource {
  source_workflow_run_id: string;
  source_workflow_step_id: string;
  source_step_attempt: number;
}

export interface WorkflowConditionEvaluationInput {
  condition: WorldPackWorkflowCondition;
  completedStepResults: Map<string, WorkflowStepResultJson>;
}
