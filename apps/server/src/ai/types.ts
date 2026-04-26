import type { PromptBundleMetadata } from '@yidhras/contracts';

export const AI_TASK_TYPES = [
  'agent_decision',
  'intent_grounding_assist',
  'context_summary',
  'memory_compaction',
  'narrative_projection',
  'entity_extraction',
  'classification',
  'moderation',
  'embedding',
  'rerank'
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const AI_MESSAGE_ROLES = ['system', 'developer', 'user', 'assistant', 'tool'] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'json'; json: Record<string, unknown> }
  | { type: 'image_url'; url: string }
  | { type: 'file_ref'; file_id: string; mime_type?: string };

export interface AiMessage {
  role: AiMessageRole;
  parts: AiContentPart[];
  name?: string;
  metadata?: Record<string, unknown>;
}

export const AI_RESPONSE_MODES = ['free_text', 'json_object', 'json_schema', 'tool_call', 'embedding'] as const;
export type AiResponseMode = (typeof AI_RESPONSE_MODES)[number];

export const AI_AUDIT_LEVELS = ['minimal', 'standard', 'full'] as const;
export type AiAuditLevel = (typeof AI_AUDIT_LEVELS)[number];

export const AI_PRIVACY_TIERS = ['local_only', 'trusted_cloud', 'any'] as const;
export type AiPrivacyTier = (typeof AI_PRIVACY_TIERS)[number];

export const AI_LATENCY_TIERS = ['interactive', 'background', 'offline'] as const;
export type AiLatencyTier = (typeof AI_LATENCY_TIERS)[number];

export const AI_DETERMINISM_TIERS = ['strict', 'balanced', 'creative'] as const;
export type AiDeterminismTier = (typeof AI_DETERMINISM_TIERS)[number];

export interface AiToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}

export interface AiToolPolicy {
  mode: 'disabled' | 'allowed' | 'required';
  allowed_tool_names?: string[];
  max_tool_calls?: number;
}

export interface AiStructuredOutputSpec {
  schema_name: string;
  json_schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ModelGatewayRequest {
  invocation_id: string;
  task_id: string;
  task_type: AiTaskType;
  provider_hint?: string | null;
  model_hint?: string | null;
  route_id?: string | null;
  messages: AiMessage[];
  response_mode: AiResponseMode;
  structured_output?: AiStructuredOutputSpec | null;
  tools?: AiToolSpec[];
  tool_policy?: AiToolPolicy | null;
  sampling?: {
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    stop?: string[];
    seed?: number;
  };
  execution?: {
    timeout_ms: number;
    retry_limit: number;
    allow_fallback: boolean;
    idempotency_key?: string | null;
  };
  governance?: {
    privacy_tier?: AiPrivacyTier;
    safety_profile?: string | null;
    audit_level?: AiAuditLevel;
  };
  metadata?: Record<string, unknown>;
}

export interface AiInvocationAttemptRecord {
  provider: string;
  model: string;
  status: 'completed' | 'failed' | 'blocked' | 'timeout';
  finish_reason: 'stop' | 'length' | 'tool_call' | 'safety' | 'error' | 'unknown';
  latency_ms?: number;
  error_code?: string | null;
  error_stage?: 'route' | 'provider' | 'decode' | 'validate' | 'safety' | 'unknown' | null;
}

export interface AiInvocationTrace {
  task_id: string;
  task_type: AiTaskType;
  route_id: string | null;
  source_inference_id?: string | null;
  workflow_task_type?: string | null;
  audit_level: AiAuditLevel;
  attempts: AiInvocationAttemptRecord[];
  request?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
}

export interface ModelGatewayResponse {
  invocation_id: string;
  task_id: string;
  task_type: AiTaskType;
  provider: string;
  model: string;
  route_id: string | null;
  fallback_used: boolean;
  attempted_models: string[];
  status: 'completed' | 'failed' | 'blocked' | 'timeout';
  finish_reason: 'stop' | 'length' | 'tool_call' | 'safety' | 'error' | 'unknown';
  output: {
    mode: AiResponseMode;
    text?: string;
    json?: Record<string, unknown> | null;
    tool_calls?: Array<{
      name: string;
      arguments: Record<string, unknown>;
      call_id?: string;
    }>;
    embedding?: number[];
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_input_tokens?: number;
    estimated_cost_usd?: number;
    latency_ms?: number;
  };
  safety?: {
    blocked: boolean;
    reason_code?: string | null;
    provider_signal?: Record<string, unknown> | null;
  };
  raw_ref?: {
    provider_request_id?: string | null;
    provider_response_id?: string | null;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    stage: 'route' | 'provider' | 'decode' | 'validate' | 'safety' | 'unknown';
  } | null;
  trace?: AiInvocationTrace;
}

export interface AiTaskRequestMetadata extends PromptBundleMetadata {
  inference_id?: string | null;
  binding_ref?: unknown;
}

export interface AiTaskPromptBundleSnapshot {
  system_prompt: string;
  role_prompt: string;
  world_prompt: string;
  context_prompt: string;
  output_contract_prompt: string;
  combined_prompt: string;
  metadata?: AiTaskRequestMetadata;
}

export interface AiTaskRequest {
  task_id: string;
  task_type: AiTaskType;
  pack_id?: string | null;
  actor_ref?: Record<string, unknown> | null;
  input: Record<string, unknown>;
  prompt_context: {
    messages?: AiMessage[];
    prompt_bundle?: AiTaskPromptBundleSnapshot | null;
    prompt_bundle_v2?: unknown | null;
  };
  output_contract?: {
    mode: AiResponseMode;
    json_schema?: Record<string, unknown>;
  };
  route_hints?: {
    route_id?: string;
    provider?: string;
    model?: string;
    latency_tier?: AiLatencyTier;
    determinism_tier?: AiDeterminismTier;
    privacy_tier?: AiPrivacyTier;
  };
  metadata?: AiTaskRequestMetadata;
}

export interface AiTaskResult<TOutput = unknown> {
  task_id: string;
  task_type: AiTaskType;
  invocation: ModelGatewayResponse;
  output: TOutput;
}

export interface AiModelSelector {
  provider?: string;
  model?: string;
  tags?: string[];
  exclude_tags?: string[];
}

export const AI_MODEL_STRUCTURED_OUTPUT_SUPPORT = ['none', 'json_object', 'json_schema'] as const;
export type AiModelStructuredOutputSupport = (typeof AI_MODEL_STRUCTURED_OUTPUT_SUPPORT)[number];

export const AI_MODEL_AVAILABILITY = ['active', 'degraded', 'disabled'] as const;
export type AiModelAvailability = (typeof AI_MODEL_AVAILABILITY)[number];

export const AI_MODEL_ENDPOINT_KINDS = ['responses', 'messages', 'chat_completions', 'embeddings', 'custom_http'] as const;
export type AiModelEndpointKind = (typeof AI_MODEL_ENDPOINT_KINDS)[number];

export interface AiModelCapabilities {
  text_generation: boolean;
  structured_output: AiModelStructuredOutputSupport;
  tool_calling: boolean;
  vision_input: boolean;
  embeddings: boolean;
  rerank: boolean;
  max_context_tokens?: number;
  max_output_tokens?: number;
}

export interface AiProviderConfig {
  provider: string;
  api_key_env?: string | null;
  base_url?: string | null;
  organization_env?: string | null;
  project_env?: string | null;
  default_headers?: Record<string, string>;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface AiModelRegistryEntry {
  provider: string;
  model: string;
  endpoint_kind: AiModelEndpointKind;
  base_url?: string | null;
  api_version?: string | null;
  capabilities: AiModelCapabilities;
  tags: string[];
  availability: AiModelAvailability;
  pricing?: {
    input_per_1m_usd?: number;
    output_per_1m_usd?: number;
  };
  defaults?: {
    timeout_ms?: number;
    temperature?: number;
    max_output_tokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface AiRouteConstraints {
  require_structured_output?: boolean;
  require_tool_calling?: boolean;
  require_local_only?: boolean;
  max_latency_ms?: number;
  max_cost_usd?: number;
  privacy_tier?: AiPrivacyTier;
  response_modes?: AiResponseMode[];
}

export interface AiRouteDefaults {
  timeout_ms?: number;
  retry_limit?: number;
  allow_fallback?: boolean;
  audit_level?: AiAuditLevel;
}

export interface AiRoutePolicy {
  route_id: string;
  task_types: AiTaskType[];
  pack_id?: string | null;
  preferred_models: AiModelSelector[];
  fallback_models: AiModelSelector[];
  constraints?: AiRouteConstraints;
  defaults?: AiRouteDefaults;
  metadata?: Record<string, unknown>;
}

export interface AiRegistryConfig {
  version: number;
  providers: AiProviderConfig[];
  models: AiModelRegistryEntry[];
  routes: AiRoutePolicy[];
}

export interface AiTaskPromptOverride {
  preset?: string;
  system_append?: string;
  developer_append?: string;
  user_prefix?: string;
  include_sections?: string[];
  examples?: Array<Record<string, unknown>>;
}

export interface AiTaskOutputOverride {
  mode?: AiResponseMode;
  schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface AiTaskParseOverride {
  decoder?: string;
  unwrap?: string;
  field_alias?: Record<string, string>;
  required_fields?: string[];
  defaults?: Record<string, unknown>;
}

export interface AiTaskRouteHint {
  route_id?: string;
  provider?: string;
  model?: string;
  latency_tier?: AiLatencyTier;
  determinism_tier?: AiDeterminismTier;
  privacy_tier?: AiPrivacyTier;
}

export interface AiTaskOverride {
  prompt?: AiTaskPromptOverride;
  output?: AiTaskOutputOverride;
  parse?: AiTaskParseOverride;
  route?: AiTaskRouteHint;
  metadata?: Record<string, unknown>;
}

export interface AiPackConfigDefaults {
  prompt_preset?: string;
  decoder?: string;
  route_id?: string;
  privacy_tier?: AiPrivacyTier;
}

export interface AiPackMemoryLoopConfig {
  summary_every_n_rounds?: number;
  compaction_every_n_rounds?: number;
}

export interface AiPackConfig {
  defaults?: AiPackConfigDefaults;
  memory_loop?: AiPackMemoryLoopConfig;
  tasks?: Partial<Record<AiTaskType, AiTaskOverride>>;
}

export interface AiTaskDefinition {
  task_type: AiTaskType;
  default_response_mode: AiResponseMode;
  default_prompt_preset: string;
  default_decoder: string;
  default_route_id?: string | null;
  default_schema?: Record<string, unknown>;
  default_strict?: boolean;
  default_privacy_tier?: AiPrivacyTier;
}

export interface AiResolvedTaskConfig {
  definition: AiTaskDefinition;
  override: AiTaskOverride | null;
  output: {
    mode: AiResponseMode;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
  prompt: AiTaskPromptOverride;
  parse: AiTaskParseOverride;
  route: AiTaskRouteHint;
  metadata?: Record<string, unknown>;
}

export interface AiRouteSelectionInput {
  task_type: AiTaskType;
  pack_id?: string | null;
  response_mode?: AiResponseMode;
  route_hint?: AiTaskRouteHint | null;
  task_override?: AiTaskOverride | null;
}

export interface AiRouteSelectionResult {
  route: AiRoutePolicy;
  primary_model_candidates: AiModelRegistryEntry[];
  fallback_model_candidates: AiModelRegistryEntry[];
  applied_override: AiTaskOverride | null;
}
