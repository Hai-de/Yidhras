import type { ContextRun } from '../context/types.js';
import type { IdentityContext } from '../identity/types.js';
import type { MemoryContextPack } from '../memory/types.js';
import type {
  PromptMacroDiagnostics,
  PromptVariableContext,
  PromptVariableContextSummary,
  VariablePool
} from '../narrative/types.js';
import type { WorldPackAiConfig, WorldPackValue } from '../packs/schema/constitution_schema.js';
import type { PromptFragment } from './prompt_fragments.js';

export type InferenceStrategy = 'mock' | 'rule_based' | 'model_routed';
export type InferenceActorRole = 'active' | 'atmosphere';

/**
 * DecisionJob.status only describes the decision-generation workflow stage.
 * It does not imply that the resulting ActionIntent has already been dispatched.
 */
export type InferenceJobStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * ActionIntent.status only describes world-side execution / dispatch outcome.
 */
export type InferenceActionIntentStatus = 'pending' | 'dispatching' | 'completed' | 'failed' | 'dropped';

export interface InferenceRequestInput {
  agent_id?: string;
  identity_id?: string;
  actor_entity_id?: string;
  strategy?: string;
  attributes?: Record<string, unknown>;
  idempotency_key?: string;
}

export type InferenceJobIntentClass = 'direct_inference' | 'scheduler_periodic' | 'scheduler_event_followup' | 'replay_recovery' | 'retry_recovery' | 'operator_forced';

export interface InferenceJobSnapshot {
  id: string;
  source_inference_id: string;
  pending_source_key?: string | null;
  action_intent_id: string | null;
  job_type: string;
  status: InferenceJobStatus;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  intent_class: InferenceJobIntentClass;
  updated_at: string;
  completed_at: string | null;
}

export type InferenceJobResultSource = 'not_available' | 'stored_trace' | 'fresh_run';

export interface InferenceJobSubmitResult {
  replayed: boolean;
  inference_id: string;
  job: InferenceJobSnapshot;
  result: InferenceRunResult | null;
  result_source: InferenceJobResultSource;
  workflow_snapshot: WorkflowSnapshot;
}

export interface InferenceJobRetryResult {
  replayed: boolean;
  inference_id: string;
  job: InferenceJobSnapshot;
  result: InferenceRunResult | null;
  result_source: InferenceJobResultSource;
  workflow_snapshot: WorkflowSnapshot;
}

export interface InferenceJobReplayInput {
  reason?: string;
  idempotency_key?: string;
  overrides?: {
    strategy?: InferenceStrategy;
    attributes?: Record<string, unknown>;
    agent_id?: string;
    identity_id?: string;
    actor_entity_id?: string;
  };
}

export interface InferenceJobReplayMetadata {
  source_job_id: string;
  source_trace_id: string | null;
  reason: string | null;
  override_applied: boolean;
  override_snapshot: {
    strategy?: InferenceStrategy;
    attributes?: Record<string, unknown>;
  } | null;
  parent_job: {
    id: string;
    status: InferenceJobStatus;
    created_at: string;
    completed_at: string | null;
  } | null;
  child_jobs: Array<{
    id: string;
    status: InferenceJobStatus;
    created_at: string;
    replay_reason: string | null;
  }>;
}

export interface InferenceJobReplaySubmitResult extends InferenceJobSubmitResult {
  replay: InferenceJobReplayMetadata;
}

export interface InferenceBindingRef {
  binding_id: string;
  role: InferenceActorRole;
  status: string;
  agent_id: string | null;
  atmosphere_node_id: string | null;
}

export interface InferenceActorRef {
  identity_id: string;
  identity_type: IdentityContext['type'];
  entity_kind?: string;
  role: InferenceActorRole;
  agent_id: string | null;
  atmosphere_node_id: string | null;
}

export interface InferenceAgentSnapshot {
  id: string;
  name: string;
  type: string;
  snr: number;
  is_pinned: boolean;
}

export interface InferencePolicySummary {
  social_post_read_allowed: boolean;
  social_post_readable_fields: string[];
  social_post_write_allowed: boolean;
  social_post_writable_fields: string[];
}

export interface InferenceTransmissionProfile {
  policy: 'reliable' | 'best_effort' | 'fragile' | 'blocked';
  drop_reason: 'policy_blocked' | 'probabilistic_drop' | 'low_signal_quality' | 'visibility_denied' | null;
  delay_ticks: string;
  drop_chance: number;
  derived_from: string[];
}

export interface InferenceWorldPackRef {
  id: string;
  name: string;
  version: string;
}

export type InferencePackStateValue = WorldPackValue;
export type InferencePackStateRecord = Record<string, InferencePackStateValue>;

export interface InferencePackArtifactSnapshot {
  id: string;
  state: InferencePackStateRecord;
}

export interface InferencePackLatestEventSnapshot {
  event_id: string;
  title: string;
  type: string;
  semantic_type: string | null;
  created_at: string;
}

export interface InferencePackStateSnapshot {
  actor_roles: string[];
  actor_state: InferencePackStateRecord | null;
  owned_artifacts: InferencePackArtifactSnapshot[];
  world_state: InferencePackStateRecord | null;
  latest_event: InferencePackLatestEventSnapshot | null;
}

export interface InferencePackInvocationRule {
  id: string;
  when: Record<string, unknown>;
  then: Record<string, unknown>;
}

export interface InferencePackRuntimeContract {
  invocation_rules?: InferencePackInvocationRule[];
}

/**
 * Subset of InferenceContext fields needed to resolve the acting identity/agent.
 * Consumers: resolveActor(), intent_grounder, context_assembler, compaction_service.
 */
export interface ActorResolvable {
  actor_ref: InferenceActorRef;
  actor_display_name: string;
  identity: IdentityContext;
  binding_ref: InferenceBindingRef | null;
  resolved_agent_id: string | null;
  agent_snapshot: InferenceAgentSnapshot | null;
}

/**
 * Subset of InferenceContext fields needed to resolve pack-level state and runtime contracts.
 * Consumers: context_assembler, intent_grounder, rule_based provider.
 */
export interface PackStateResolvable {
  pack_state: InferencePackStateSnapshot;
  pack_runtime: InferencePackRuntimeContract;
  world_pack: InferenceWorldPackRef;
}

/**
 * Minimum context required to render a prompt bundle.
 * Extends ActorResolvable + PackStateResolvable with prompt-specific fields.
 * `context_run` and `memory_context` are nullable to support partial (non-inference) usage.
 */
export interface PromptResolvableContext extends ActorResolvable, PackStateResolvable {
  tick: bigint;
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  world_prompts: Record<string, string>;
  variable_context: PromptVariableContext;
  variable_context_summary: PromptVariableContextSummary;
  context_run: ContextRun | null;
  memory_context: MemoryContextPack | null;
}

export interface InferenceContext extends PromptResolvableContext {
  inference_id: string;
  binding_ref: InferenceBindingRef | null;
  world_ai?: WorldPackAiConfig | null;
  visible_variables: VariablePool;
  policy_summary: InferencePolicySummary;
  transmission_profile: InferenceTransmissionProfile;
  context_run: ContextRun;
  memory_context: MemoryContextPack;
  pack_runtime: InferencePackRuntimeContract;
}

export interface InferenceMemoryMutationRecord {
  kind: 'overlay' | 'memory_block';
  record_id: string;
  operation: 'created' | 'updated' | 'archived' | 'deleted';
  actor_id?: string | null;
  pack_id?: string | null;
  note_kind?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface InferenceMemoryMutationSnapshot {
  records: InferenceMemoryMutationRecord[];
}

export interface PromptWorkflowStepTraceSnapshot {
  key: string;
  kind: string;
  status: 'completed' | 'skipped' | 'failed';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  notes?: Record<string, unknown>;
}

export interface PromptWorkflowPlacementSummarySnapshot {
  total_fragments: number;
  resolved_with_anchor: number;
  fallback_count: number;
}

export interface PromptWorkflowSnapshot {
  task_type: string | null;
  profile_id: string | null;
  profile_version: string | null;
  selected_step_keys: string[];
  step_traces?: PromptWorkflowStepTraceSnapshot[];
  compatibility?: Record<string, unknown> | null;
  placement_summary?: PromptWorkflowPlacementSummarySnapshot | null;
  variable_summary?: Record<string, unknown> | null;
  macro_summary?: PromptMacroDiagnostics | null;
  section_summary?: Record<string, unknown> | null;
}

export interface PromptWorkflowMetadata {
  workflow_task_type?: string | null;
  workflow_profile_id?: string | null;
  workflow_profile_version?: string | null;
  workflow_step_keys?: string[];
  workflow_section_summary?: Record<string, unknown>;
  workflow_placement_summary?: Record<string, unknown>;
  workflow_variable_summary?: Record<string, unknown>;
  workflow_macro_summary?: PromptMacroDiagnostics;
}

export interface PromptProcessingTrace {
  processor_names: string[];
  fragment_count_before: number;
  fragment_count_after: number;
  workflow_task_type?: string | null;
  workflow_profile_id?: string | null;
  workflow_profile_version?: string | null;
  workflow_step_keys?: string[];
  workflow_step_traces?: PromptWorkflowStepTraceSnapshot[];
  prompt_workflow?: PromptWorkflowSnapshot | null;
  steps?: Array<{
    processor_name: string;
    fragment_count_before: number;
    fragment_count_after: number;
    added_fragment_ids?: string[];
    removed_fragment_ids?: string[];
    notes?: Record<string, unknown>;
  }>;
  fragments: Array<{
    id: string;
    slot: PromptFragment['slot'];
    source: string;
    priority: number;
    metadata?: Record<string, unknown>;
  }>;
  summary_compaction?: {
    summarized_fragment_ids: string[];
    summary_fragment_id: string;
  } | null;
  policy_filtering?: {
    filtered_fragment_ids: string[];
    reasons: Record<string, string>;
  } | null;
  token_budget_trimming?: {
    task_type?: string | null;
    budget: number;
    used: number;
    trimmed_fragment_ids: string[];
    kept_fragment_ids?: string[];
    always_kept_fragment_ids?: string[];
    kept_optional_fragment_ids?: string[];
    slot_priority?: Partial<Record<PromptFragment['slot'], number>>;
    optional_fragment_scores?: Array<{ fragment_id: string; slot: PromptFragment['slot']; score: number; estimated_cost: number; kept: boolean }>;
    trimmed_by_slot?: Partial<Record<PromptFragment['slot'], string[]>>;
    section_budget?: {
      mode: 'fragment_only' | 'section_level';
      total_budget: number;
      allocated_budget: number;
      allocations: Array<{
        section_id: string;
        section_type: string;
        slot: PromptFragment['slot'];
        budget_share: number;
        budget_tokens: number;
        ranking_score: number;
        kept: boolean;
      }>;
      kept_section_ids: string[];
      dropped_section_ids: string[];
    } | null;
    trimmed_sources?: string[];
    section_summary?: Record<string, unknown> | null;
  } | null;
}

export interface PromptBundleMetadata extends PromptWorkflowMetadata {
  prompt_version: string | null;
  source_prompt_keys: string[];
  processing_trace?: PromptProcessingTrace;
}

export interface PromptBundle {
  system_prompt: string;
  role_prompt: string;
  world_prompt: string;
  context_prompt: string;
  output_contract_prompt: string;
  combined_prompt: string;
  metadata: PromptBundleMetadata;
}

export interface ProviderDecisionRaw {
  action_type?: unknown;
  target_ref?: unknown;
  payload?: unknown;
  confidence?: unknown;
  delay_hint_ticks?: unknown;
  reasoning?: unknown;
  meta?: unknown;
}

export interface SemanticIntentResult {
  kind: string | null;
  text: string | null;
  desired_effect: string | null;
  proposed_method: string | null;
  target_ref: Record<string, unknown> | null;
}

export interface IntentGroundingResult {
  resolution_mode: 'exact' | 'translated' | 'narrativized' | 'blocked';
  affordance_key: string | null;
  required_capability_key: string | null;
  explanation: string | null;
  objective_effect_applied: boolean;
  failure_kind: 'failed_attempt' | 'blocked' | null;
}

export interface DecisionResult {
  action_type: string;
  target_ref: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  confidence?: number;
  delay_hint_ticks?: string;
  reasoning?: string;
  meta?: Record<string, unknown>;
}

export interface ActionIntentDraft {
  intent_type: string;
  actor_ref: InferenceActorRef;
  target_ref: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  scheduled_after_ticks: string | null;
  transmission_delay_ticks: string | null;
  transmission_policy: 'reliable' | 'best_effort' | 'fragile' | 'blocked';
  transmission_drop_chance: number;
  drop_reason: string | null;
  source_inference_id: string;
}

export interface InferencePreviewMetadata {
  world_pack_id: string;
  binding_ref: InferenceBindingRef | null;
  prompt_version: string | null;
}

export interface TraceMetadata extends InferencePreviewMetadata {
  inference_id: string;
  tick: string;
  strategy: InferenceStrategy;
  provider: string;
  memory_mutations?: InferenceMemoryMutationSnapshot | null;
}

export interface InferencePreviewResult {
  inference_id: string;
  actor_ref: InferenceActorRef;
  strategy: InferenceStrategy;
  provider: string;
  tick: string;
  prompt: PromptBundle;
  metadata: InferencePreviewMetadata;
}

export interface InferenceRunResult {
  inference_id: string;
  actor_ref: InferenceActorRef;
  strategy: InferenceStrategy;
  provider: string;
  tick: string;
  decision: DecisionResult;
  trace_metadata: TraceMetadata;
}

export interface WorkflowDecisionJobSnapshot extends InferenceJobSnapshot {
  request_input: Record<string, unknown> | null;
  started_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  scheduled_for_tick: string | null;
  next_retry_at: string | null;
  replay_of_job_id: string | null;
  replay_source_trace_id: string | null;
  replay_reason: string | null;
  replay_override_snapshot: Record<string, unknown> | null;
  last_error_code: WorkflowFailureCode | null;
  last_error_stage: Exclude<WorkflowFailureStage, 'none' | 'dispatch'> | 'unknown' | null;
}

export interface InferenceTraceRecordSnapshot {
  id: string;
  kind: string;
  strategy: string;
  provider: string;
  actor_ref: Record<string, unknown>;
  input: Record<string, unknown>;
  context_snapshot: Record<string, unknown>;
  prompt_bundle: Record<string, unknown>;
  trace_metadata: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface InferenceActionIntentSnapshot {
  id: string;
  source_inference_id: string;
  intent_type: string;
  actor_ref: Record<string, unknown>;
  target_ref: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  scheduled_after_ticks: string | null;
  scheduled_for_tick: string | null;
  status: InferenceActionIntentStatus;
  dispatch_started_at: string | null;
  dispatched_at: string | null;
  transmission_delay_ticks: string | null;
  transmission_policy: ActionIntentDraft['transmission_policy'];
  transmission_drop_chance: number;
  drop_reason: string | null;
  dispatch_error_code: WorkflowFailureCode | null;
  dispatch_error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowDecisionStage = 'preview_only' | 'queued' | 'running' | 'completed' | 'failed';
export type WorkflowDispatchStage = 'not_requested' | 'pending' | 'dispatching' | 'completed' | 'failed' | 'dropped';
export type WorkflowFailureStage = 'none' | 'provider' | 'normalization' | 'persistence' | 'dispatch' | 'unknown';
export type WorkflowFailureCode = 'INFERENCE_PROVIDER_FAIL' | 'INFERENCE_NORMALIZATION_FAIL' | 'INFERENCE_TRACE_PERSIST_FAIL' | 'ACTION_DISPATCH_FAIL' | 'UNKNOWN_WORKFLOW_FAILURE';
export type WorkflowState = 'preview_only' | 'decision_pending' | 'decision_running' | 'decision_failed' | 'dispatch_pending' | 'dispatching' | 'workflow_completed' | 'workflow_dropped' | 'workflow_failed';
export type WorkflowOutcomeKind = 'preview_only' | 'decision_pending' | 'decision_running' | 'decision_failed' | 'dispatch_pending' | 'dispatching' | 'completed' | 'dropped' | 'failed';

export interface WorkflowOutcomeSummary {
  kind: WorkflowOutcomeKind;
  message: string;
}

export interface WorkflowSnapshot {
  records: {
    trace: InferenceTraceRecordSnapshot | null;
    job: WorkflowDecisionJobSnapshot | null;
    intent: InferenceActionIntentSnapshot | null;
  };
  lineage: {
    replay_of_job_id: string | null;
    replay_source_trace_id: string | null;
    replay_reason: string | null;
    override_applied: boolean;
    override_snapshot: Record<string, unknown> | null;
    parent_job: {
      id: string;
      status: InferenceJobStatus;
      created_at: string;
      completed_at: string | null;
    } | null;
    child_jobs: Array<{ id: string; status: InferenceJobStatus; created_at: string; replay_reason: string | null }>;
  };
  derived: {
    decision_stage: WorkflowDecisionStage;
    dispatch_stage: WorkflowDispatchStage;
    workflow_state: WorkflowState;
    failure_stage: WorkflowFailureStage;
    failure_code: WorkflowFailureCode | null;
    failure_reason: string | null;
    outcome_summary: WorkflowOutcomeSummary;
  };
}
