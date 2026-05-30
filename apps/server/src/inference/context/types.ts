import type { ContextRun } from '../../context/types.js';
import type { IdentityContext } from '../../identity/types.js';
import type { MemoryContextPack } from '../../memory/types.js';
import type { WorldPackAiConfig } from '../../packs/schema/constitution_schema.js';
import type {
  PromptVariableContext,
  PromptVariableContextSummary,
  PromptVariableRecord
} from '../../template_engine/frontends/narrative/types.js';
import type {
  InferenceActorRef,
  InferenceAgentSnapshot,
  InferenceBindingRef,
  InferencePackRuntimeContract,
  InferencePackStateSnapshot,
  InferencePolicySummary,
  InferenceRequestInput,
  InferenceStrategy,
  InferenceTransmissionProfile,
  InferenceWorldPackRef,
  PreviousAgentOutputRecord} from '../types.js';

// ── Stage-specific types ────────────────────────────────────

/** Actor resolution output — the resolved actor identity + agent binding. */
export interface ResolvedActor {
  actor_ref: InferenceActorRef;
  actor_display_name: string;
  identity: IdentityContext;
  binding_ref: InferenceBindingRef | null;
  resolved_agent_id: string | null;
  agent_snapshot: InferenceAgentSnapshot | null;
}

/** Strategy + attributes as resolved after actor-level override. */
export interface ResolutionResult {
  actor: ResolvedActor;
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
}

// ── Stage input types ───────────────────────────────────────

export interface StateSnapshotInput {
  packId: string;
  resolvedAgentId: string | null;
  attributes: Record<string, unknown>;
}

export interface PolicySummaryInput {
  identity: IdentityContext;
  attributes: Record<string, unknown>;
}

export interface TransmissionProfileInput {
  actorRef: InferenceActorRef;
  agentSnapshot: InferenceAgentSnapshot | null;
  policySummary: InferencePolicySummary;
  attributes: Record<string, unknown>;
}

export interface VariableContextInput {
  pack: {
    metadata: { id: string; name: string; version: string };
    variables?: Record<string, unknown> | undefined;
    prompts?: Record<string, unknown> | undefined;
    ai?: WorldPackAiConfig | null | undefined;
  };
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  actor: ResolvedActor;
  packState: InferencePackStateSnapshot;
  packRuntime: InferencePackRuntimeContract;
  requestInput: InferenceRequestInput;
  currentTick: string;
}

export interface ContextRunInput {
  actor_ref: Record<string, unknown>;
  identity: IdentityContext | null;
  resolved_agent_id: string | null;
  tick: bigint;
  policy_summary: InferencePolicySummary | null;
  pack_state: InferencePackStateSnapshot | null;
  pack_id: string | null;
  agent_capabilities: string[];
  perception_rules?: Array<{
    id: string;
    when: Record<string, unknown>;
    then: Record<string, unknown>;
  }>;
}

// ── Context assembly result ─────────────────────────────────

export interface ContextRunResult {
  context_run: ContextRun;
  memory_context: MemoryContextPack;
}

/** The fully assembled inference context. */
export interface AssembledInferenceContext {
  inference_id: string;
  actor_ref: InferenceActorRef;
  actor_display_name: string;
  identity: IdentityContext;
  binding_ref: InferenceBindingRef | null;
  resolved_agent_id: string | null;
  agent_snapshot: InferenceAgentSnapshot | null;
  tick: bigint;
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  world_pack: InferenceWorldPackRef;
  world_prompts: Record<string, string>;
  world_ai?: WorldPackAiConfig | null | undefined;
  visible_variables: PromptVariableRecord;
  variable_context: PromptVariableContext;
  variable_context_summary: PromptVariableContextSummary;
  policy_summary: InferencePolicySummary;
  transmission_profile: InferenceTransmissionProfile;
  context_run: ContextRun;
  memory_context: MemoryContextPack;
  pack_state: InferencePackStateSnapshot;
  pack_runtime: InferencePackRuntimeContract;
  agent_capabilities: string[];
  previous_agent_output?: Record<string, PreviousAgentOutputRecord> | undefined;
}

// ── Pipeline types ─────────────────────────────────────────

/** Context assembly pipeline stage error. */
export class ContextAssemblyError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public override readonly cause: unknown
  ) {
    super(message);
    this.name = 'ContextAssemblyError';
  }
}

/** Pipeline options. */
export interface PipelineOptions {
  /** Continue to next stage on non-critical failure. */
  graceful?: boolean | undefined;
  /** Deployment ID for config resolution. */
  deploymentId?: string | undefined;
}
