import type {
  ActionIntentDraft,
  DecisionResult,
  InferenceActorRef,
  InferenceContext,
  InferenceJobStatus,
  InferenceMemoryMutationSnapshot,
  InferenceRequestInput,
  InferenceStrategy,
  IntentGroundingResult,
  PromptBundle,
  SemanticIntentResult,
  TraceMetadata
} from './types.js';

export interface InferenceTraceEvent {
  kind: 'preview' | 'run';
  inference_id: string;
  strategy: InferenceStrategy;
  provider: string;
  actor_ref: InferenceActorRef;
  input: InferenceRequestInput;
  context: InferenceContext;
  prompt: PromptBundle;
  trace_metadata: TraceMetadata;
  decision?: DecisionResult;
  semantic_intent?: SemanticIntentResult;
  intent_grounding?: IntentGroundingResult;
  action_intent_draft?: ActionIntentDraft;
  job_id?: string;
  job_status?: InferenceJobStatus;
  job_last_error?: string | null;
  job_last_error_code?: string | null;
  job_last_error_stage?: string | null;
  job_attempt_count?: number;
  job_max_attempts?: number;
  ai_invocation_id?: string | null;
  memory_mutations?: InferenceMemoryMutationSnapshot | null;
}

export interface InferenceTraceSink {
  record(event: InferenceTraceEvent): Promise<void>;
}
