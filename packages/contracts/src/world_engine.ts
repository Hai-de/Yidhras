import { z } from 'zod'

import { nonNegativeBigIntStringSchema, positiveBigIntStringSchema } from './scalars.js'

const nonEmptyStringSchema = z.string().trim().min(1)
const stringRecordSchema = z.record(z.string(), z.unknown())

export const WORLD_ENGINE_PROTOCOL_VERSION = 'world_engine/v1alpha1' as const

export const worldEngineProtocolVersionSchema = z.literal(WORLD_ENGINE_PROTOCOL_VERSION)
export const worldEngineTransportSchema = z.enum(['stdio_jsonrpc'])
export const worldEngineMethodNameSchema = z.enum([
  'world.protocol.handshake',
  'world.pack.load',
  'world.pack.unload',
  'world.state.query',
  'world.rule.execute_objective',
  'world.status.get',
  'world.health.get',
  'world.step.prepare',
  'world.step.commit',
  'world.step.abort'
])
export const worldEnginePackModeSchema = z.enum(['active', 'experimental'])
export const worldEngineSessionStatusSchema = z.enum(['not_loaded', 'loading', 'ready', 'tainted', 'error'])
export const worldEngineQueryNameSchema = z.enum([
  'pack_summary',
  'world_entities',
  'entity_state',
  'authority_grants',
  'mediator_bindings',
  'rule_execution_summary'
])
export const worldEngineStepReasonSchema = z.enum(['runtime_loop', 'manual'])
export const worldEngineErrorCodeSchema = z.enum([
  'ENGINE_NOT_READY',
  'PACK_NOT_LOADED',
  'PREPARED_STEP_CONFLICT',
  'PREPARED_STEP_NOT_FOUND',
  'HOST_PERSIST_FAILED',
  'PROTOCOL_VERSION_MISMATCH',
  'INVALID_QUERY',
  'PACK_SCOPE_DENIED',
  'TAINTED_SESSION',
  'INTERNAL_ERROR'
])
export const worldEngineObservationKindSchema = z.enum(['log', 'metric', 'counter', 'histogram', 'diagnostic'])
export const worldEngineObservationLevelSchema = z.enum(['debug', 'info', 'warning', 'error'])
export const worldEngineObservationCodeSchema = z.enum([
  'WORLD_STEP_PREPARED',
  'WORLD_STEP_COMMITTED',
  'WORLD_STEP_ABORTED',
  'WORLD_CORE_DELTA_BUILT',
  'WORLD_CORE_DELTA_APPLIED',
  'WORLD_CORE_DELTA_ABORTED',
  'WORLD_QUERY_ALLOWLIST_FILTERED',
  'WORLD_PREPARED_STATE_SUMMARY'
])

export const worldPackClockSnapshotSchema = z.object({
  current_tick: nonNegativeBigIntStringSchema,
  current_revision: nonNegativeBigIntStringSchema
})

export const worldEntitySnapshotSchema = z.object({
  id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  entity_kind: nonEmptyStringSchema,
  entity_type: nonEmptyStringSchema.nullable(),
  label: z.string(),
  tags: z.array(z.string()).default([]),
  static_schema_ref: nonEmptyStringSchema.nullable(),
  payload_json: stringRecordSchema.nullable(),
  created_at: nonNegativeBigIntStringSchema,
  updated_at: nonNegativeBigIntStringSchema
})

export const worldEntityStateSnapshotSchema = z.object({
  id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  entity_id: nonEmptyStringSchema,
  state_namespace: nonEmptyStringSchema,
  state_json: stringRecordSchema,
  created_at: nonNegativeBigIntStringSchema,
  updated_at: nonNegativeBigIntStringSchema
})

export const worldAuthorityGrantSnapshotSchema = z.object({
  id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  source_entity_id: nonEmptyStringSchema,
  target_selector_json: stringRecordSchema,
  capability_key: nonEmptyStringSchema,
  grant_type: nonEmptyStringSchema,
  mediated_by_entity_id: nonEmptyStringSchema.nullable(),
  scope_json: stringRecordSchema.nullable(),
  conditions_json: stringRecordSchema.nullable(),
  priority: z.number().int(),
  status: nonEmptyStringSchema.nullable(),
  revocable: z.boolean().nullable(),
  created_at: nonNegativeBigIntStringSchema,
  updated_at: nonNegativeBigIntStringSchema
})

export const worldMediatorBindingSnapshotSchema = z.object({
  id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  mediator_id: nonEmptyStringSchema,
  subject_entity_id: nonEmptyStringSchema.nullable(),
  binding_kind: nonEmptyStringSchema,
  status: nonEmptyStringSchema,
  metadata_json: stringRecordSchema.nullable(),
  created_at: nonNegativeBigIntStringSchema,
  updated_at: nonNegativeBigIntStringSchema
})

export const worldRuleExecutionRecordSnapshotSchema = z.object({
  id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  rule_id: nonEmptyStringSchema,
  capability_key: nonEmptyStringSchema.nullable(),
  mediator_id: nonEmptyStringSchema.nullable(),
  subject_entity_id: nonEmptyStringSchema.nullable(),
  target_entity_id: nonEmptyStringSchema.nullable(),
  execution_status: nonEmptyStringSchema,
  payload_json: stringRecordSchema.nullable(),
  emitted_events_json: z.array(z.unknown()).default([]),
  created_at: nonNegativeBigIntStringSchema,
  updated_at: nonNegativeBigIntStringSchema
})
const worldStateDeltaOperationPayloadSchema = z.object({
  next: z.unknown().optional(),
  previous: z.unknown().optional(),
  reason: nonEmptyStringSchema.optional()
}).catchall(z.unknown()).default({})

const worldStateDeltaMetadataSchema = z.object({
  pack_id: nonEmptyStringSchema.optional(),
  reason: nonEmptyStringSchema.optional(),
  base_tick: nonNegativeBigIntStringSchema.optional(),
  next_tick: nonNegativeBigIntStringSchema.optional(),
  base_revision: nonNegativeBigIntStringSchema.optional(),
  next_revision: nonNegativeBigIntStringSchema.optional(),
  mutated_entity_ids: z.array(nonEmptyStringSchema).optional(),
  mutated_namespace_refs: z.array(nonEmptyStringSchema).optional(),
  delta_operation_count: z.number().int().nonnegative().optional()
}).catchall(z.unknown())

export const worldStateDeltaOperationSchema = z.object({
  op: z.enum([
    'upsert_world_entity',
    'upsert_entity_state',
    'put_mediator_binding',
    'put_authority_grant',
    'append_rule_execution',
    'set_clock',
    'custom'
  ]),
  target_ref: nonEmptyStringSchema.optional(),
  namespace: nonEmptyStringSchema.optional(),
  payload: worldStateDeltaOperationPayloadSchema
})

export const worldStateDeltaSchema = z.object({
  operations: z.array(worldStateDeltaOperationSchema),
  metadata: worldStateDeltaMetadataSchema.optional()
})

export const worldDomainEventSchema = z.object({
  event_id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  event_type: nonEmptyStringSchema,
  sequence: nonNegativeBigIntStringSchema.optional(),
  emitted_at_tick: nonNegativeBigIntStringSchema,
  emitted_at_revision: nonNegativeBigIntStringSchema.optional(),
  entity_id: nonEmptyStringSchema.optional(),
  actor_id: nonEmptyStringSchema.optional(),
  refs: z.record(z.string(), z.string().nullable()).default({}),
  payload: stringRecordSchema.default({})
})

export const worldEngineObservationRecordSchema = z.object({
  record_id: nonEmptyStringSchema.optional(),
  pack_id: nonEmptyStringSchema.optional(),
  kind: worldEngineObservationKindSchema,
  level: worldEngineObservationLevelSchema.optional(),
  code: worldEngineObservationCodeSchema,
  message: z.string().optional(),
  value: z.number().finite().optional(),
  unit: nonEmptyStringSchema.optional(),
  recorded_at_tick: nonNegativeBigIntStringSchema.optional(),
  attributes: stringRecordSchema.default({})
})

export const preparedWorldStepSummarySchema = z.object({
  applied_rule_count: z.number().int().nonnegative(),
  event_count: z.number().int().nonnegative(),
  mutated_entity_count: z.number().int().nonnegative()
})

export const preparedWorldStepSchema = z.object({
  prepared_token: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  base_revision: nonNegativeBigIntStringSchema,
  next_revision: nonNegativeBigIntStringSchema,
  next_tick: nonNegativeBigIntStringSchema,
  state_delta: worldStateDeltaSchema,
  emitted_events: z.array(worldDomainEventSchema),
  observability: z.array(worldEngineObservationRecordSchema),
  summary: preparedWorldStepSummarySchema
})

const worldEngineProtocolEnvelopeSchema = z.object({
  protocol_version: worldEngineProtocolVersionSchema
})

const worldEnginePackRequestSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  correlation_id: nonEmptyStringSchema.optional()
})

const worldEngineMutatingRequestSchema = worldEnginePackRequestSchema.extend({
  idempotency_key: nonEmptyStringSchema.optional()
})

export const worldProtocolHandshakeRequestSchema = worldEngineProtocolEnvelopeSchema.extend({
  transport: worldEngineTransportSchema,
  host_capabilities: z.array(nonEmptyStringSchema).default([])
})

export const worldProtocolHandshakeResponseSchema = worldEngineProtocolEnvelopeSchema.extend({
  accepted: z.literal(true),
  transport: worldEngineTransportSchema,
  engine_instance_id: nonEmptyStringSchema,
  supported_methods: z.array(worldEngineMethodNameSchema),
  engine_capabilities: z.array(nonEmptyStringSchema).default([])
})

export const worldPackSnapshotSchema = z.object({
  pack_id: nonEmptyStringSchema,
  clock: worldPackClockSnapshotSchema,
  world_entities: z.array(worldEntitySnapshotSchema).default([]),
  entity_states: z.array(worldEntityStateSnapshotSchema).default([]),
  authority_grants: z.array(worldAuthorityGrantSnapshotSchema).default([]),
  mediator_bindings: z.array(worldMediatorBindingSnapshotSchema).default([]),
  rule_execution_records: z.array(worldRuleExecutionRecordSnapshotSchema).default([])
})

export const worldPackHydrateSourceSchema = z.enum(['host_snapshot'])

export const worldPackHydrateRequestSchema = z.object({
  source: worldPackHydrateSourceSchema,
  snapshot: worldPackSnapshotSchema
})

export const worldPackHydrateSummarySchema = z.object({
  world_entity_count: z.number().int().nonnegative(),
  entity_state_count: z.number().int().nonnegative(),
  authority_grant_count: z.number().int().nonnegative(),
  mediator_binding_count: z.number().int().nonnegative(),
  rule_execution_record_count: z.number().int().nonnegative()
})

export const worldPackHydrateResultSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  source: worldPackHydrateSourceSchema,
  applied: z.literal(true),
  summary: worldPackHydrateSummarySchema
})

export const worldPackLoadRequestSchema = worldEngineMutatingRequestSchema.extend({
  pack_ref: nonEmptyStringSchema.optional(),
  mode: worldEnginePackModeSchema.default('active'),
  hydrate: worldPackHydrateRequestSchema.optional()
})

export const worldEngineLoadResultSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  mode: worldEnginePackModeSchema,
  session_status: worldEngineSessionStatusSchema,
  hydrated_from_persistence: z.boolean(),
  current_tick: nonNegativeBigIntStringSchema.nullable(),
  current_revision: nonNegativeBigIntStringSchema.nullable()
})

export const worldPackUnloadRequestSchema = worldEngineMutatingRequestSchema

export const worldOperationAcknowledgementSchema = worldEngineProtocolEnvelopeSchema.extend({
  acknowledged: z.literal(true),
  pack_id: nonEmptyStringSchema,
  message: z.string().optional()
})

const worldStateQuerySelectorSchema = z.object({
  ids: z.array(nonEmptyStringSchema).optional(),
  entity_kind: nonEmptyStringSchema.optional(),
  entity_type: nonEmptyStringSchema.optional(),
  entity_id: nonEmptyStringSchema.optional(),
  state_namespace: nonEmptyStringSchema.optional(),
  source_entity_id: nonEmptyStringSchema.optional(),
  capability_key: nonEmptyStringSchema.optional(),
  mediated_by_entity_id: nonEmptyStringSchema.optional(),
  status: nonEmptyStringSchema.optional(),
  mediator_id: nonEmptyStringSchema.optional(),
  subject_entity_id: nonEmptyStringSchema.optional(),
  binding_kind: nonEmptyStringSchema.optional(),
  rule_id: nonEmptyStringSchema.optional(),
  target_entity_id: nonEmptyStringSchema.optional(),
  execution_status: nonEmptyStringSchema.optional()
}).catchall(z.unknown()).default({})

export const worldStateQuerySchema = worldEnginePackRequestSchema.extend({
  query_name: worldEngineQueryNameSchema,
  selector: worldStateQuerySelectorSchema,
  projection: stringRecordSchema.optional(),
  cursor: nonEmptyStringSchema.optional(),
  limit: z.number().int().positive().optional()
})

export const worldStateQueryWarningSchema = z.object({
  code: worldEngineErrorCodeSchema.or(nonEmptyStringSchema),
  message: z.string()
})

export const worldStateQueryResultSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  query_name: worldEngineQueryNameSchema,
  current_tick: nonNegativeBigIntStringSchema.nullable(),
  current_revision: nonNegativeBigIntStringSchema.nullable(),
  data: z.object({
    summary: z.unknown().optional(),
    items: z.array(z.unknown()).optional(),
    entity_id: nonEmptyStringSchema.optional(),
    state_namespace: nonEmptyStringSchema.optional(),
    state: z.record(z.string(), z.unknown()).nullable().optional(),
    total_count: z.number().int().nonnegative().optional()
  }),
  next_cursor: nonEmptyStringSchema.nullable().optional(),
  warnings: z.array(worldStateQueryWarningSchema).default([])
})

export const worldObjectiveRuleInvocationSchema = z.object({
  id: nonEmptyStringSchema,
  pack_id: nonEmptyStringSchema,
  source_action_intent_id: nonEmptyStringSchema,
  source_inference_id: nonEmptyStringSchema,
  invocation_type: nonEmptyStringSchema,
  capability_key: nonEmptyStringSchema.nullable(),
  subject_entity_id: nonEmptyStringSchema.nullable(),
  target_ref: stringRecordSchema.nullable(),
  payload: stringRecordSchema.default({}),
  mediator_id: nonEmptyStringSchema.nullable(),
  actor_ref: stringRecordSchema.default({}),
  created_at: nonNegativeBigIntStringSchema
})

export const worldObjectiveRuleDefinitionSchema = z.object({
  id: nonEmptyStringSchema,
  when: stringRecordSchema.default({}),
  then: stringRecordSchema.default({})
})

export const worldObjectiveWorldEntitySchema = z.object({
  id: nonEmptyStringSchema,
  entity_kind: nonEmptyStringSchema
})

export const worldObjectiveMutationEffectSchema = z.object({
  entity_id: nonEmptyStringSchema,
  state_namespace: nonEmptyStringSchema,
  state_patch: stringRecordSchema.default({})
})

export const worldObjectiveEventEffectSchema = z.object({
  type: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  impact_data: stringRecordSchema.nullable(),
  artifact_id: nonEmptyStringSchema.nullable()
})

export const worldObjectiveExecutionDiagnosticsSchema = z.object({
  matched_rule_id: nonEmptyStringSchema.nullable(),
  no_match_reason: nonEmptyStringSchema.nullable().optional(),
  evaluated_rule_count: z.number().int().nonnegative(),
  rendered_template_count: z.number().int().nonnegative(),
  mutation_count: z.number().int().nonnegative(),
  emitted_event_count: z.number().int().nonnegative()
})

export const worldEnginePackStatusSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  mode: worldEnginePackModeSchema,
  session_status: worldEngineSessionStatusSchema,
  runtime_ready: z.boolean(),
  current_tick: nonNegativeBigIntStringSchema.nullable(),
  current_revision: nonNegativeBigIntStringSchema.nullable(),
  pending_prepared_token: nonEmptyStringSchema.nullable().optional(),
  message: z.string().nullable().optional()
})

export const worldStatusGetRequestSchema = worldEnginePackRequestSchema

export const worldEngineHealthSnapshotSchema = worldEngineProtocolEnvelopeSchema.extend({
  transport: worldEngineTransportSchema,
  engine_status: z.enum(['starting', 'ready', 'degraded', 'failed']),
  engine_instance_id: nonEmptyStringSchema,
  uptime_ms: z.number().int().nonnegative(),
  loaded_pack_ids: z.array(nonEmptyStringSchema),
  tainted_pack_ids: z.array(nonEmptyStringSchema),
  last_error_code: worldEngineErrorCodeSchema.nullable().optional(),
  message: z.string().nullable().optional()
})

export const worldHealthGetRequestSchema = worldEngineProtocolEnvelopeSchema.extend({
  correlation_id: nonEmptyStringSchema.optional()
})

export const worldRuleExecuteObjectiveRequestSchema = worldEnginePackRequestSchema.extend({
  invocation: worldObjectiveRuleInvocationSchema,
  effective_mediator_id: nonEmptyStringSchema.nullable(),
  objective_rules: z.array(worldObjectiveRuleDefinitionSchema).default([]),
  world_entities: z.array(worldObjectiveWorldEntitySchema).default([])
})

export const worldRuleExecuteObjectiveResultSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  rule_id: nonEmptyStringSchema,
  capability_key: nonEmptyStringSchema.nullable(),
  mediator_id: nonEmptyStringSchema.nullable(),
  target_entity_id: nonEmptyStringSchema.nullable(),
  bridge_mode: z.literal('objective_rule'),
  mutations: z.array(worldObjectiveMutationEffectSchema),
  emitted_events: z.array(worldObjectiveEventEffectSchema),
  diagnostics: worldObjectiveExecutionDiagnosticsSchema
})

export const worldStepPrepareRequestSchema = worldEngineMutatingRequestSchema.extend({
  step_ticks: positiveBigIntStringSchema,
  reason: worldEngineStepReasonSchema,
  base_revision: nonNegativeBigIntStringSchema.optional()
})

export const worldStepCommitRequestSchema = worldEngineMutatingRequestSchema.extend({
  prepared_token: nonEmptyStringSchema,
  persisted_revision: nonNegativeBigIntStringSchema
})

export const worldEngineCommitResultSchema = worldEngineProtocolEnvelopeSchema.extend({
  pack_id: nonEmptyStringSchema,
  prepared_token: nonEmptyStringSchema,
  committed_revision: nonNegativeBigIntStringSchema,
  committed_tick: nonNegativeBigIntStringSchema,
  summary: preparedWorldStepSummarySchema
})

export const worldStepAbortRequestSchema = worldEngineMutatingRequestSchema.extend({
  prepared_token: nonEmptyStringSchema,
  reason: z.string().optional()
})

export type WorldEngineProtocolVersion = z.infer<typeof worldEngineProtocolVersionSchema>
export type WorldEngineMethodName = z.infer<typeof worldEngineMethodNameSchema>
export type WorldEnginePackMode = z.infer<typeof worldEnginePackModeSchema>
export type WorldEngineSessionStatus = z.infer<typeof worldEngineSessionStatusSchema>
export type WorldEngineQueryName = z.infer<typeof worldEngineQueryNameSchema>
export type WorldEngineStepReason = z.infer<typeof worldEngineStepReasonSchema>
export type WorldEngineErrorCode = z.infer<typeof worldEngineErrorCodeSchema>
export type WorldEngineObservationCode = z.infer<typeof worldEngineObservationCodeSchema>
export type WorldPackClockSnapshot = z.infer<typeof worldPackClockSnapshotSchema>
export type WorldEntitySnapshot = z.infer<typeof worldEntitySnapshotSchema>
export type WorldEntityStateSnapshot = z.infer<typeof worldEntityStateSnapshotSchema>
export type WorldAuthorityGrantSnapshot = z.infer<typeof worldAuthorityGrantSnapshotSchema>
export type WorldMediatorBindingSnapshot = z.infer<typeof worldMediatorBindingSnapshotSchema>
export type WorldRuleExecutionRecordSnapshot = z.infer<typeof worldRuleExecutionRecordSnapshotSchema>
export type WorldPackSnapshot = z.infer<typeof worldPackSnapshotSchema>
export type WorldPackHydrateSource = z.infer<typeof worldPackHydrateSourceSchema>
export type WorldPackHydrateRequest = z.infer<typeof worldPackHydrateRequestSchema>
export type WorldPackHydrateSummary = z.infer<typeof worldPackHydrateSummarySchema>
export type WorldPackHydrateResult = z.infer<typeof worldPackHydrateResultSchema>
export type WorldStateDeltaOperationPayload = z.infer<typeof worldStateDeltaOperationPayloadSchema>
export type WorldStateDeltaMetadata = z.infer<typeof worldStateDeltaMetadataSchema>
export type WorldStateDeltaOperation = z.infer<typeof worldStateDeltaOperationSchema>
export type WorldStateDelta = z.infer<typeof worldStateDeltaSchema>
export type WorldDomainEvent = z.infer<typeof worldDomainEventSchema>
export type WorldEngineObservationRecord = z.infer<typeof worldEngineObservationRecordSchema>
export type PreparedWorldStepSummary = z.infer<typeof preparedWorldStepSummarySchema>
export type PreparedWorldStep = z.infer<typeof preparedWorldStepSchema>
export type WorldProtocolHandshakeRequest = z.infer<typeof worldProtocolHandshakeRequestSchema>
export type WorldProtocolHandshakeResponse = z.infer<typeof worldProtocolHandshakeResponseSchema>
export type WorldPackLoadRequest = z.infer<typeof worldPackLoadRequestSchema>
export type WorldEngineLoadResult = z.infer<typeof worldEngineLoadResultSchema>
export type WorldPackUnloadRequest = z.infer<typeof worldPackUnloadRequestSchema>
export type WorldOperationAcknowledgement = z.infer<typeof worldOperationAcknowledgementSchema>
export type WorldStateQuerySelector = z.infer<typeof worldStateQuerySelectorSchema>
export type WorldStateQuery = z.infer<typeof worldStateQuerySchema>
export type WorldStateQueryResult = z.infer<typeof worldStateQueryResultSchema>
export type WorldObjectiveRuleInvocation = z.infer<typeof worldObjectiveRuleInvocationSchema>
export type WorldObjectiveRuleDefinition = z.infer<typeof worldObjectiveRuleDefinitionSchema>
export type WorldObjectiveWorldEntity = z.infer<typeof worldObjectiveWorldEntitySchema>
export type WorldObjectiveMutationEffect = z.infer<typeof worldObjectiveMutationEffectSchema>
export type WorldObjectiveEventEffect = z.infer<typeof worldObjectiveEventEffectSchema>
export type WorldObjectiveExecutionDiagnostics = z.infer<typeof worldObjectiveExecutionDiagnosticsSchema>
export type WorldEnginePackStatus = z.infer<typeof worldEnginePackStatusSchema>
export type WorldStatusGetRequest = z.infer<typeof worldStatusGetRequestSchema>
export type WorldEngineHealthSnapshot = z.infer<typeof worldEngineHealthSnapshotSchema>
export type WorldHealthGetRequest = z.infer<typeof worldHealthGetRequestSchema>
export type WorldRuleExecuteObjectiveRequest = z.infer<typeof worldRuleExecuteObjectiveRequestSchema>
export type WorldRuleExecuteObjectiveResult = z.infer<typeof worldRuleExecuteObjectiveResultSchema>
export type WorldStepPrepareRequest = z.infer<typeof worldStepPrepareRequestSchema>
export type WorldStepCommitRequest = z.infer<typeof worldStepCommitRequestSchema>
export type WorldEngineCommitResult = z.infer<typeof worldEngineCommitResultSchema>
export type WorldStepAbortRequest = z.infer<typeof worldStepAbortRequestSchema>

export const serializeWorldPackSnapshotRecord = (input: {
  pack_id: string;
  clock: { current_tick: bigint | string; current_revision: bigint | string };
  world_entities: Array<{
    id: string;
    pack_id: string;
    entity_kind: string;
    entity_type: string | null;
    label: string;
    tags: string[];
    static_schema_ref: string | null;
    payload_json: Record<string, unknown> | null;
    created_at: bigint | string;
    updated_at: bigint | string;
  }>;
  entity_states: Array<{
    id: string;
    pack_id: string;
    entity_id: string;
    state_namespace: string;
    state_json: Record<string, unknown>;
    created_at: bigint | string;
    updated_at: bigint | string;
  }>;
  authority_grants: Array<{
    id: string;
    pack_id: string;
    source_entity_id: string;
    target_selector_json: Record<string, unknown>;
    capability_key: string;
    grant_type: string;
    mediated_by_entity_id: string | null;
    scope_json: Record<string, unknown> | null;
    conditions_json: Record<string, unknown> | null;
    priority: number;
    status: string | null;
    revocable: boolean | null;
    created_at: bigint | string;
    updated_at: bigint | string;
  }>;
  mediator_bindings: Array<{
    id: string;
    pack_id: string;
    mediator_id: string;
    subject_entity_id: string | null;
    binding_kind: string;
    status: string;
    metadata_json: Record<string, unknown> | null;
    created_at: bigint | string;
    updated_at: bigint | string;
  }>;
  rule_execution_records: Array<{
    id: string;
    pack_id: string;
    rule_id: string;
    capability_key: string | null;
    mediator_id: string | null;
    subject_entity_id: string | null;
    target_entity_id: string | null;
    execution_status: string;
    payload_json: Record<string, unknown> | null;
    emitted_events_json: unknown[];
    created_at: bigint | string;
    updated_at: bigint | string;
  }>;
}): WorldPackSnapshot => {
  return worldPackSnapshotSchema.parse({
    pack_id: input.pack_id,
    clock: {
      current_tick: input.clock.current_tick.toString(),
      current_revision: input.clock.current_revision.toString()
    },
    world_entities: input.world_entities.map(item => ({
      ...item,
      created_at: item.created_at.toString(),
      updated_at: item.updated_at.toString()
    })),
    entity_states: input.entity_states.map(item => ({
      ...item,
      created_at: item.created_at.toString(),
      updated_at: item.updated_at.toString()
    })),
    authority_grants: input.authority_grants.map(item => ({
      ...item,
      created_at: item.created_at.toString(),
      updated_at: item.updated_at.toString()
    })),
    mediator_bindings: input.mediator_bindings.map(item => ({
      ...item,
      created_at: item.created_at.toString(),
      updated_at: item.updated_at.toString()
    })),
    rule_execution_records: input.rule_execution_records.map(item => ({
      ...item,
      created_at: item.created_at.toString(),
      updated_at: item.updated_at.toString()
    }))
  })
}

