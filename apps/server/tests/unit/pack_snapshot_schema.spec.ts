import * as contracts from '@yidhras/contracts'
import { describe, expect, it } from 'vitest'

const validMetadata = {
  schema_version: 1 as const,
  snapshot_id: 'snap-001',
  pack_id: 'test-pack',
  label: 'before-battle',
  captured_at_tick: '15200',
  captured_at_revision: '15200',
  captured_at_timestamp: '2026-04-28T10:30:00.000Z',
  runtime_db_size_bytes: 409600,
  prisma_record_count: 84
}

const validAgent = {
  id: 'test-pack:actor-1',
  name: 'Hero',
  type: 'active',
  snr: 0.8,
  is_pinned: false,
  created_at: '1000',
  updated_at: '15000'
}

const validIdentity = {
  id: 'test-pack:identity:actor-1',
  type: 'agent',
  name: 'Hero',
  provider: 'pack',
  status: 'active',
  claims: null,
  metadata: null,
  created_at: '1000',
  updated_at: '15000'
}

const validBinding = {
  id: 'test-pack:binding:actor-1',
  identity_id: 'test-pack:identity:actor-1',
  agent_id: 'test-pack:actor-1',
  atmosphere_node_id: null,
  role: 'active',
  status: 'active',
  created_at: '1000',
  updated_at: '15000'
}

const validPrismaData = {
  schema_version: 1 as const,
  pack_id: 'test-pack',
  agents: [validAgent],
  identities: [validIdentity],
  identity_node_bindings: [validBinding],
  posts: [],
  relationships: [],
  memory_blocks: [],
  context_overlay_entries: [],
  memory_compaction_states: [],
  scenario_entity_states: []
}

describe('contracts — pack_snapshot metadata', () => {
  it('accepts valid metadata', () => {
    expect(contracts.packSnapshotMetadataSchema.safeParse(validMetadata).success).toBe(true)
  })

  it('accepts null label', () => {
    const result = contracts.packSnapshotMetadataSchema.safeParse({ ...validMetadata, label: null })
    expect(result.success).toBe(true)
  })

  it('rejects missing snapshot_id', () => {
    const { snapshot_id: _, ...rest } = validMetadata
    expect(contracts.packSnapshotMetadataSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects empty snapshot_id', () => {
    expect(contracts.packSnapshotMetadataSchema.safeParse({ ...validMetadata, snapshot_id: '  ' }).success).toBe(false)
  })

  it('rejects unknown fields', () => {
    expect(contracts.packSnapshotMetadataSchema.safeParse({ ...validMetadata, extra: true }).success).toBe(false)
  })

  it('rejects invalid tick format (negative)', () => {
    expect(contracts.packSnapshotMetadataSchema.safeParse({ ...validMetadata, captured_at_tick: '-1' }).success).toBe(false)
  })

  it('rejects non-integer tick', () => {
    expect(contracts.packSnapshotMetadataSchema.safeParse({ ...validMetadata, captured_at_tick: 'abc' }).success).toBe(false)
  })

  it('rejects negative runtime_db_size_bytes', () => {
    expect(contracts.packSnapshotMetadataSchema.safeParse({ ...validMetadata, runtime_db_size_bytes: -1 }).success).toBe(false)
  })
})

describe('contracts — pack_snapshot prisma data', () => {
  it('accepts valid prisma data with empty arrays', () => {
    expect(contracts.packSnapshotPrismaDataSchema.safeParse(validPrismaData).success).toBe(true)
  })

  it('accepts data with posts and relationships', () => {
    const result = contracts.packSnapshotPrismaDataSchema.safeParse({
      ...validPrismaData,
      posts: [{
        id: 'post-1',
        author_id: 'test-pack:actor-1',
        source_action_intent_id: null,
        content: 'Hello world',
        noise_level: 0.1,
        is_encrypted: false,
        created_at: '14000'
      }],
      relationships: [{
        id: 'rel-1',
        from_id: 'test-pack:actor-1',
        to_id: 'test-pack:actor-2',
        type: 'friend',
        weight: 1.0,
        created_at: '1000',
        updated_at: '15000'
      }]
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing required array', () => {
    const { agents: _, ...rest } = validPrismaData
    expect(contracts.packSnapshotPrismaDataSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects agent with invalid snr type', () => {
    const result = contracts.packSnapshotPrismaDataSchema.safeParse({
      ...validPrismaData,
      agents: [{ ...validAgent, snr: 'high' }]
    })
    expect(result.success).toBe(false)
  })

  it('rejects post with empty author_id', () => {
    const result = contracts.packSnapshotPrismaDataSchema.safeParse({
      ...validPrismaData,
      posts: [{
        id: 'post-1',
        author_id: '  ',
        source_action_intent_id: null,
        content: 'x',
        noise_level: 0,
        is_encrypted: false,
        created_at: '1'
      }]
    })
    expect(result.success).toBe(false)
  })

  it('accepts memory block with behavior and runtime_state', () => {
    const result = contracts.packSnapshotPrismaDataSchema.safeParse({
      ...validPrismaData,
      memory_blocks: [{
        id: 'mem-1',
        owner_agent_id: 'test-pack:actor-1',
        kind: 'memory',
        status: 'active',
        title: 'Test memory',
        content_text: 'Something happened',
        content_structured: { key: 'value' },
        tags: 'important',
        keywords: 'test',
        source_ref: { type: 'event', id: 'evt-1' },
        importance: 0.9,
        salience: 0.7,
        confidence: 0.8,
        created_at_tick: '5000',
        updated_at_tick: '15000',
        behavior: { trigger: 'on_tick' },
        runtime_state: { currently_active: true }
      }]
    })
    expect(result.success).toBe(true)
  })

  it('accepts memory block with null confidence', () => {
    const result = contracts.packSnapshotPrismaDataSchema.safeParse({
      ...validPrismaData,
      memory_blocks: [{
        id: 'mem-1',
        owner_agent_id: 'test-pack:actor-1',
        kind: 'memory',
        status: 'active',
        title: null,
        content_text: 'x',
        content_structured: null,
        tags: '',
        keywords: '',
        source_ref: null,
        importance: 0.5,
        salience: 0.5,
        confidence: null,
        created_at_tick: '1',
        updated_at_tick: '1',
        behavior: null,
        runtime_state: null
      }]
    })
    expect(result.success).toBe(true)
  })
})

describe('contracts — pack_snapshot API request/response', () => {
  it('createSnapshotRequestSchema accepts empty body (no label)', () => {
    expect(contracts.createSnapshotRequestSchema.safeParse({}).success).toBe(true)
  })

  it('createSnapshotRequestSchema accepts valid label', () => {
    expect(contracts.createSnapshotRequestSchema.safeParse({ label: 'my-snapshot' }).success).toBe(true)
  })

  it('createSnapshotRequestSchema rejects empty label', () => {
    expect(contracts.createSnapshotRequestSchema.safeParse({ label: '  ' }).success).toBe(false)
  })

  it('createSnapshotRequestSchema rejects unknown fields', () => {
    expect(contracts.createSnapshotRequestSchema.safeParse({ label: 'x', extra: 1 }).success).toBe(false)
  })

  it('createSnapshotResponseSchema validates correctly', () => {
    const result = contracts.createSnapshotResponseSchema.safeParse({
      snapshot_id: 'snap-001',
      pack_id: 'test-pack',
      captured_at_tick: '15200',
      prisma_record_count: 84,
      runtime_db_size_bytes: 409600
    })
    expect(result.success).toBe(true)
  })

  it('restoreSnapshotRequestSchema requires confirm_data_loss', () => {
    expect(contracts.restoreSnapshotRequestSchema.safeParse({}).success).toBe(false)
    expect(contracts.restoreSnapshotRequestSchema.safeParse({ confirm_data_loss: true }).success).toBe(true)
    expect(contracts.restoreSnapshotRequestSchema.safeParse({ confirm_data_loss: false }).success).toBe(true)
  })

  it('restoreSnapshotResponseSchema validates correctly', () => {
    const result = contracts.restoreSnapshotResponseSchema.safeParse({
      restored: true,
      pack_id: 'test-pack',
      snapshot_id: 'snap-001',
      restored_at_tick: '15200'
    })
    expect(result.success).toBe(true)
  })

  it('restoreSnapshotResponseSchema rejects restored: false', () => {
    expect(contracts.restoreSnapshotResponseSchema.safeParse({
      restored: false,
      pack_id: 'test-pack',
      snapshot_id: 'snap-001',
      restored_at_tick: '15200'
    }).success).toBe(false)
  })

  it('deleteSnapshotResponseSchema validates correctly', () => {
    const result = contracts.deleteSnapshotResponseSchema.safeParse({
      deleted: true,
      snapshot_id: 'snap-001'
    })
    expect(result.success).toBe(true)
  })

  it('listSnapshotsResponseSchema validates empty list', () => {
    expect(contracts.listSnapshotsResponseSchema.safeParse({ snapshots: [] }).success).toBe(true)
  })

  it('listSnapshotsResponseSchema validates populated list', () => {
    const result = contracts.listSnapshotsResponseSchema.safeParse({
      snapshots: [{
        snapshot_id: 'snap-001',
        label: null,
        captured_at_tick: '15200',
        captured_at_timestamp: '2026-04-28T10:30:00.000Z',
        runtime_db_size_bytes: 409600,
        prisma_record_count: 84
      }]
    })
    expect(result.success).toBe(true)
  })
})
