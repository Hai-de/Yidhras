import { z } from 'zod'

import { nonNegativeBigIntStringSchema } from './scalars.js'

const nonEmptyStringSchema = z.string().trim().min(1)

// —— 快照元数据 ——

export const packSnapshotMetadataSchema = z
  .object({
    schema_version: z.literal(1),
    snapshot_id: nonEmptyStringSchema,
    pack_id: nonEmptyStringSchema,
    label: z.string().nullable(),
    captured_at_tick: nonNegativeBigIntStringSchema,
    captured_at_revision: nonNegativeBigIntStringSchema,
    captured_at_timestamp: z.string(),
    runtime_db_size_bytes: z.number().int().nonnegative(),
    prisma_record_count: z.number().int().nonnegative(),
    compression: z.enum(['none', 'gzip']).default('gzip'),
    storage_plan_sha256: z.string().nullable().optional(),
    storage_plan_inherits_from: z.string().nullable().optional()
  })
  .strict()

// —— Prisma 导出数据子 schema ——

const agentRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: z.string(),
    type: z.string(),
    snr: z.number(),
    is_pinned: z.boolean(),
    created_at: nonNegativeBigIntStringSchema,
    updated_at: nonNegativeBigIntStringSchema
  })
  .strict()

const identityRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    type: z.string(),
    name: z.string().nullable(),
    provider: z.string(),
    status: z.string(),
    claims: z.unknown().nullable(),
    metadata: z.unknown().nullable(),
    created_at: nonNegativeBigIntStringSchema,
    updated_at: nonNegativeBigIntStringSchema
  })
  .strict()

const identityNodeBindingRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    identity_id: nonEmptyStringSchema,
    agent_id: nonEmptyStringSchema.nullable(),
    atmosphere_node_id: nonEmptyStringSchema.nullable(),
    role: z.string(),
    status: z.string(),
    created_at: nonNegativeBigIntStringSchema,
    updated_at: nonNegativeBigIntStringSchema
  })
  .strict()

const postRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    author_id: nonEmptyStringSchema,
    source_action_intent_id: nonEmptyStringSchema.nullable(),
    content: z.string(),
    noise_level: z.number(),
    is_encrypted: z.boolean(),
    created_at: nonNegativeBigIntStringSchema
  })
  .strict()

const relationshipRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    from_id: nonEmptyStringSchema,
    to_id: nonEmptyStringSchema,
    type: z.string(),
    weight: z.number(),
    created_at: nonNegativeBigIntStringSchema,
    updated_at: nonNegativeBigIntStringSchema
  })
  .strict()

const memoryBlockRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    owner_agent_id: nonEmptyStringSchema,
    kind: z.string(),
    status: z.string(),
    title: z.string().nullable(),
    content_text: z.string(),
    content_structured: z.unknown().nullable(),
    tags: z.string(),
    keywords: z.string(),
    source_ref: z.unknown().nullable(),
    importance: z.number(),
    salience: z.number(),
    confidence: z.number().nullable(),
    created_at_tick: nonNegativeBigIntStringSchema,
    updated_at_tick: nonNegativeBigIntStringSchema,
    behavior: z.unknown().nullable(),
    runtime_state: z.unknown().nullable()
  })
  .strict()

const contextOverlayEntryRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    actor_id: nonEmptyStringSchema,
    overlay_type: z.string(),
    title: z.string().nullable(),
    content_text: z.string(),
    content_structured: z.unknown().nullable(),
    tags: z.string(),
    status: z.string(),
    persistence_mode: z.string(),
    source_node_ids: z.string(),
    created_by: nonEmptyStringSchema,
    created_at_tick: nonNegativeBigIntStringSchema,
    updated_at_tick: nonNegativeBigIntStringSchema
  })
  .strict()

const memoryCompactionStateRecordSchema = z
  .object({
    agent_id: nonEmptyStringSchema,
    inference_count_since_summary: z.number().int(),
    inference_count_since_compaction: z.number().int(),
    last_summary_tick: nonNegativeBigIntStringSchema.nullable(),
    last_compaction_tick: nonNegativeBigIntStringSchema.nullable(),
    updated_at_tick: nonNegativeBigIntStringSchema
  })
  .strict()

const scenarioEntityStateRecordSchema = z
  .object({
    id: nonEmptyStringSchema,
    entity_type: z.string(),
    entity_id: nonEmptyStringSchema,
    state_json: z.unknown(),
    created_at: nonNegativeBigIntStringSchema,
    updated_at: nonNegativeBigIntStringSchema
  })
  .strict()

// —— 完整 Prisma 导出 ——

export const packSnapshotPrismaDataSchema = z
  .object({
    schema_version: z.literal(1),
    pack_id: nonEmptyStringSchema,
    agents: z.array(agentRecordSchema),
    identities: z.array(identityRecordSchema),
    identity_node_bindings: z.array(identityNodeBindingRecordSchema),
    posts: z.array(postRecordSchema),
    relationships: z.array(relationshipRecordSchema),
    memory_blocks: z.array(memoryBlockRecordSchema),
    context_overlay_entries: z.array(contextOverlayEntryRecordSchema),
    memory_compaction_states: z.array(memoryCompactionStateRecordSchema),
    scenario_entity_states: z.array(scenarioEntityStateRecordSchema)
  })
  .strict()

// —— API 类型 ——

export const createSnapshotRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(256).optional()
  })
  .strict()

export const createSnapshotResponseSchema = z
  .object({
    snapshot_id: nonEmptyStringSchema,
    pack_id: nonEmptyStringSchema,
    captured_at_tick: nonNegativeBigIntStringSchema,
    prisma_record_count: z.number().int().nonnegative(),
    runtime_db_size_bytes: z.number().int().nonnegative()
  })
  .strict()

export const snapshotSummarySchema = z
  .object({
    snapshot_id: nonEmptyStringSchema,
    label: z.string().nullable(),
    captured_at_tick: nonNegativeBigIntStringSchema,
    captured_at_timestamp: z.string(),
    runtime_db_size_bytes: z.number().int().nonnegative(),
    prisma_record_count: z.number().int().nonnegative()
  })
  .strict()

export const listSnapshotsResponseSchema = z
  .object({
    snapshots: z.array(snapshotSummarySchema)
  })
  .strict()

export const restoreSnapshotRequestSchema = z
  .object({
    confirm_data_loss: z.boolean()
  })
  .strict()

export const restoreSnapshotResponseSchema = z
  .object({
    restored: z.literal(true),
    pack_id: nonEmptyStringSchema,
    snapshot_id: nonEmptyStringSchema,
    restored_at_tick: nonNegativeBigIntStringSchema
  })
  .strict()

export const deleteSnapshotResponseSchema = z
  .object({
    deleted: z.literal(true),
    snapshot_id: nonEmptyStringSchema
  })
  .strict()

// —— 导出类型 ——

export type PackSnapshotMetadata = z.infer<typeof packSnapshotMetadataSchema>
export type PackSnapshotPrismaData = z.infer<typeof packSnapshotPrismaDataSchema>
export type CreateSnapshotRequest = z.infer<typeof createSnapshotRequestSchema>
export type CreateSnapshotResponse = z.infer<typeof createSnapshotResponseSchema>
export type SnapshotSummary = z.infer<typeof snapshotSummarySchema>
export type ListSnapshotsResponse = z.infer<typeof listSnapshotsResponseSchema>
export type RestoreSnapshotRequest = z.infer<typeof restoreSnapshotRequestSchema>
export type RestoreSnapshotResponse = z.infer<typeof restoreSnapshotResponseSchema>
export type DeleteSnapshotResponse = z.infer<typeof deleteSnapshotResponseSchema>
