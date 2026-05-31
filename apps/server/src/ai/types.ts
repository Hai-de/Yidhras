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
  | { type: 'file_ref'; file_id: string; mime_type?: string | undefined };

export interface AiMessage {
  role: AiMessageRole;
  parts: AiContentPart[];
  name?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
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
  strict?: boolean | undefined;
}

export interface AiToolPolicy {
  mode: 'disabled' | 'allowed' | 'required';
  allowed_tool_names?: string[] | undefined;
  max_tool_calls?: number | undefined;
}

export interface AiStructuredOutputSpec {
  schema_name: string;
  json_schema: Record<string, unknown>;
  strict?: boolean | undefined;
}

export interface ModelGatewayRequest {
  invocation_id: string;
  task_id: string;
  task_type: AiTaskType;
  provider_hint?: string | null | undefined;
  model_hint?: string | null | undefined;
  route_id?: string | null | undefined;
  messages: AiMessage[];
  response_mode: AiResponseMode;
  structured_output?: AiStructuredOutputSpec | null | undefined;
  tools?: AiToolSpec[] | undefined;
  tool_policy?: AiToolPolicy | null | undefined;
  sampling?: {
    temperature?: number | undefined;
    top_p?: number | undefined;
    max_output_tokens?: number | undefined;
    stop?: string[] | undefined;
    seed?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
  };
  execution?: {
    timeout_ms: number;
    retry_limit: number;
    allow_fallback: boolean;
    idempotency_key?: string | null | undefined;
  };
  governance?: {
    privacy_tier?: AiPrivacyTier | undefined;
    safety_profile?: string | null | undefined;
    audit_level?: AiAuditLevel | undefined;
  };
  metadata?: Record<string, unknown> | undefined;
}

export interface AiInvocationAttemptRecord {
  provider: string;
  model: string;
  status: 'completed' | 'failed' | 'blocked' | 'timeout';
  finish_reason: 'stop' | 'length' | 'tool_call' | 'safety' | 'error' | 'unknown';
  latency_ms?: number | undefined;
  error_code?: string | null | undefined;
  error_stage?: 'route' | 'provider' | 'decode' | 'validate' | 'safety' | 'unknown' | null | undefined;
}

export interface AiInvocationTrace {
  task_id: string;
  task_type: AiTaskType;
  route_id: string | null;
  source_inference_id?: string | null | undefined;
  workflow_task_type?: string | null | undefined;
  audit_level: AiAuditLevel;
  attempts: AiInvocationAttemptRecord[];
  request?: Record<string, unknown> | null | undefined;
  response?: Record<string, unknown> | null | undefined;
  tool_loop?: AiToolLoopTrace | undefined;
}

export interface AiToolLoopTrace {
  rounds: Array<{
    round: number;
    tool_calls: Array<{ name: string; latency_ms: number; success: boolean }>;
    total_latency_ms: number;
  }>;
  total_rounds: number;
  exhausted: boolean;
}

export interface ModelGatewayResponse {
  invocation_id: string;
  task_id: string;
  task_type: AiTaskType;
  provider: string;
  model: string;
  route_id: string | null;
  fallback_used: boolean;
  /** 指示此响应来自缓存而非 provider 调用 */
  cached?: boolean | undefined;
  attempted_models: string[];
  status: 'completed' | 'failed' | 'blocked' | 'timeout';
  finish_reason: 'stop' | 'length' | 'tool_call' | 'safety' | 'error' | 'unknown';
  output: {
    mode: AiResponseMode;
    text?: string | undefined;
    json?: Record<string, unknown> | null | undefined;
    tool_calls?: Array<{
      name: string;
      arguments: Record<string, unknown>;
      call_id?: string | undefined;
    }>;
    embedding?: number[] | undefined;
  };
  usage?: {
    input_tokens?: number | undefined;
    output_tokens?: number | undefined;
    total_tokens?: number | undefined;
    cached_input_tokens?: number | undefined;
    thinking_tokens?: number | undefined;
    estimated_cost_usd?: number | undefined;
    latency_ms?: number | undefined;
  };
  safety?: {
    blocked: boolean;
    reason_code?: string | null | undefined;
    provider_signal?: Record<string, unknown> | null | undefined;
  };
  raw_ref?: {
    provider_request_id?: string | null | undefined;
    provider_response_id?: string | null | undefined;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    stage: 'route' | 'provider' | 'decode' | 'validate' | 'safety' | 'unknown';
  } | null;
  trace?: AiInvocationTrace | undefined;
}

export interface AiTaskRequestMetadata extends PromptBundleMetadata {
  inference_id?: string | null | undefined;
  binding_ref?: unknown;
}

export interface AiTaskRequest {
  task_id: string;
  task_type: AiTaskType;
  pack_id?: string | null | undefined;
  actor_ref?: Record<string, unknown> | null | undefined;
  input: Record<string, unknown>;
  prompt_context: {
    prompt_bundle_v2: unknown;
    agent_conversation_memory?: import('../conversation/types.js').AgentConversationMemory | null | undefined;
    current_agent_id?: string | undefined;
    conversation_profile?: string | undefined;
  };
  output_contract?: {
    mode: AiResponseMode;
    json_schema?: Record<string, unknown> | undefined;
  } | undefined;
  route_hints?: {
    route_id?: string | undefined;
    provider?: string | undefined;
    model?: string | undefined;
    latency_tier?: AiLatencyTier | undefined;
    determinism_tier?: AiDeterminismTier | undefined;
    privacy_tier?: AiPrivacyTier | undefined;
  } | undefined;
  tools?: AiToolSpec[] | undefined;
  tool_policy?: AiToolPolicy | null | undefined;
  metadata?: AiTaskRequestMetadata | undefined;
}

export interface AiTaskResult<TOutput = unknown> {
  task_id: string;
  task_type: AiTaskType;
  invocation: ModelGatewayResponse;
  output: TOutput;
}

export interface AiModelSelector {
  provider?: string | undefined;
  model?: string | undefined;
  tags?: string[] | undefined;
  exclude_tags?: string[] | undefined;
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
  max_context_tokens?: number | undefined;
  max_output_tokens?: number | undefined;
}

export interface AiProviderConfig {
  provider: string;
  api_key_env?: string | null | undefined;
  base_url?: string | null | undefined;
  organization_env?: string | null | undefined;
  project_env?: string | null | undefined;
  default_headers?: Record<string, string> | undefined;
  enabled: boolean;
  metadata?: Record<string, unknown> | undefined;
}

export interface AiModelRegistryEntry {
  provider: string;
  model: string;
  endpoint_kind: AiModelEndpointKind;
  base_url?: string | null | undefined;
  api_version?: string | null | undefined;
  capabilities: AiModelCapabilities;
  tags: string[];
  availability: AiModelAvailability;
  pricing?: {
    input_per_1m_usd?: number | undefined;
    output_per_1m_usd?: number | undefined;
  } | undefined;
  defaults?: {
    timeout_ms?: number | undefined;
    temperature?: number | undefined;
    max_output_tokens?: number | undefined;
  } | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AiRouteConstraints {
  require_structured_output?: boolean | undefined;
  require_tool_calling?: boolean | undefined;
  require_local_only?: boolean | undefined;
  max_latency_ms?: number | undefined;
  max_cost_usd?: number | undefined;
  privacy_tier?: AiPrivacyTier | undefined;
  response_modes?: AiResponseMode[] | undefined;
  allow_tool_calling?: boolean | undefined;
  allowed_tool_ids?: string[] | undefined;
}

export interface AiRouteDefaults {
  timeout_ms?: number | undefined;
  retry_limit?: number | undefined;
  allow_fallback?: boolean | undefined;
  audit_level?: AiAuditLevel | undefined;
  /** 熔断器配置（预留，暂不暴露到 YAML schema） */
  circuit_breaker?: {
    failure_threshold?: number | undefined;
    recovery_timeout_ms?: number | undefined;
  };
  /** 速率限制配置（预留，暂不暴露到 YAML schema） */
  rate_limit?: {
    max_concurrent?: number | undefined;
  };
  /** 退避策略配置（预留，暂不暴露到 YAML schema） */
  backoff?: {
    base_delay_ms?: number | undefined;
    max_delay_ms?: number | undefined;
  };
}

export interface AiRoutePolicy {
  route_id: string;
  task_types: AiTaskType[];
  pack_id?: string | null | undefined;
  preferred_models: AiModelSelector[];
  fallback_models: AiModelSelector[];
  constraints?: AiRouteConstraints | undefined;
  defaults?: AiRouteDefaults | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AiRegistryConfig {
  version: number;
  provider_templates?: AiProviderTemplate[] | undefined;
  providers: AiProviderConfig[];
  models: AiModelRegistryEntry[];
  routes: AiRoutePolicy[];
  tools?: AiToolRegistryEntry[] | undefined;
}

export interface AiProviderTemplate {
  name: string;
  kind: 'openai_compatible' | 'anthropic_compatible' | 'builtin';
  base_url?: string | null | undefined;
  api_key_env?: string | null | undefined;
  capability_overrides?: {
    disallowTempWithTopP?: boolean | undefined;
    maxTokensField?: 'max_completion_tokens' | 'max_tokens' | undefined;
    supportsSeed?: boolean | undefined;
    maxStructuredOutput?: 'none' | 'json_object' | 'json_schema' | undefined;
  } | undefined;
  /** Anthropic 兼容协议特有覆盖项（仅 kind === 'anthropic_compatible' 时生效） */
  anthropic_overrides?: {
    supportsThinking?: boolean | undefined;
    supportsImageInput?: boolean | undefined;
    supportsToolUse?: boolean | undefined;
    apiVersion?: string | null | undefined;
    authHeader?: 'x-api-key' | 'bearer' | undefined;
  } | undefined;
  default_headers?: Record<string, string> | undefined;
  builtin_name?: string | null | undefined;
}

export const AI_TOOL_SANDBOX_LEVELS = ['strict', 'readonly_world', 'mutation'] as const;
export type AiToolSandboxLevel = (typeof AI_TOOL_SANDBOX_LEVELS)[number];

export interface AiToolRegistryEntry {
  tool_id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean | undefined;
  kind: 'system' | 'pack';
  pack_id?: string | null | undefined;
  enabled: boolean;
  sandbox?: AiToolSandboxLevel | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AiTaskPromptOverride {
  preset?: string | undefined;
  system_append?: string | undefined;
  developer_append?: string | undefined;
  user_prefix?: string | undefined;
  include_sections?: string[] | undefined;
  examples?: Array<Record<string, unknown>> | undefined;
}

export interface AiTaskOutputOverride {
  mode?: AiResponseMode | undefined;
  schema?: Record<string, unknown> | undefined;
  strict?: boolean | undefined;
}

export interface AiTaskParseOverride {
  decoder?: string | undefined;
  unwrap?: string | undefined;
  field_alias?: Record<string, string> | undefined;
  required_fields?: string[] | undefined;
  defaults?: Record<string, unknown> | undefined;
}

export interface AiTaskRouteHint {
  route_id?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  latency_tier?: AiLatencyTier | undefined;
  determinism_tier?: AiDeterminismTier | undefined;
  privacy_tier?: AiPrivacyTier | undefined;
}

export interface AiTaskOverride {
  prompt?: AiTaskPromptOverride | undefined;
  output?: AiTaskOutputOverride | undefined;
  parse?: AiTaskParseOverride | undefined;
  route?: AiTaskRouteHint | undefined;
  tools?: string[] | undefined;
  tool_policy?: AiToolPolicy | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AiPackConfigDefaults {
  prompt_preset?: string | undefined;
  decoder?: string | undefined;
  route_id?: string | undefined;
  privacy_tier?: AiPrivacyTier | undefined;
}

export interface AiPackMemoryLoopConfig {
  summary_every_n_rounds?: number | undefined;
  compaction_every_n_rounds?: number | undefined;
}

export interface AiPackConfig {
  defaults?: AiPackConfigDefaults | undefined;
  memory_loop?: AiPackMemoryLoopConfig | undefined;
  tasks?: Partial<Record<AiTaskType, AiTaskOverride>> | undefined;
}

export interface AiTaskDefinition {
  task_type: AiTaskType;
  default_response_mode: AiResponseMode;
  default_prompt_preset: string;
  default_decoder: string;
  default_route_id?: string | null | undefined;
  default_schema?: Record<string, unknown> | undefined;
  default_strict?: boolean | undefined;
  default_privacy_tier?: AiPrivacyTier | undefined;
  default_tools?: string[] | undefined;
  default_tool_policy?: AiToolPolicy | undefined;
}

export interface AiResolvedTaskConfig {
  definition: AiTaskDefinition;
  override: AiTaskOverride | null;
  output: {
    mode: AiResponseMode;
    schema?: Record<string, unknown> | undefined;
    strict?: boolean | undefined;
  };
  prompt: AiTaskPromptOverride;
  parse: AiTaskParseOverride;
  route: AiTaskRouteHint;
  tools: string[];
  tool_policy: AiToolPolicy;
  metadata?: Record<string, unknown> | undefined;
}

export interface AiRouteSelectionInput {
  task_type: AiTaskType;
  pack_id?: string | null | undefined;
  response_mode?: AiResponseMode | undefined;
  route_hint?: AiTaskRouteHint | null | undefined;
  task_override?: AiTaskOverride | null | undefined;
}

export interface AiRouteSelectionResult {
  route: AiRoutePolicy;
  primary_model_candidates: AiModelRegistryEntry[];
  fallback_model_candidates: AiModelRegistryEntry[];
  applied_override: AiTaskOverride | null;
}
