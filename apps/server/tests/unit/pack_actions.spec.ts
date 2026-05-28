import {
  packActionInvokeDataSchema,
  packActionPerceiveDataSchema,
  packActionRequestSchema
} from '@yidhras/contracts'
import { describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import { PackQueryHandlerRegistry } from '../../src/app/services/action/pack_query_resolver.js'

// ── Tier 1: Schema validation ──

describe('packActionRequestSchema', () => {
  it('accepts valid perceive request', () => {
    const result = packActionRequestSchema.safeParse({
      capability_key: 'perceive.agent.context',
      payload: { agent_id: 'agent-1' }
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.capability_key).toBe('perceive.agent.context')
      expect(result.data.payload).toEqual({ agent_id: 'agent-1' })
    }
  })

  it('accepts valid invoke request', () => {
    const result = packActionRequestSchema.safeParse({
      capability_key: 'invoke.roll_dice',
      payload: {}
    })
    expect(result.success).toBe(true)
  })

  it('defaults payload to empty object when missing', () => {
    const result = packActionRequestSchema.safeParse({
      capability_key: 'invoke.agent.decide'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.payload).toEqual({})
    }
  })

  it('rejects empty capability_key', () => {
    const result = packActionRequestSchema.safeParse({
      capability_key: '',
      payload: {}
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing capability_key', () => {
    const result = packActionRequestSchema.safeParse({
      payload: {}
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-string capability_key', () => {
    const result = packActionRequestSchema.safeParse({
      capability_key: 123,
      payload: {}
    })
    expect(result.success).toBe(false)
  })
})

describe('packActionPerceiveDataSchema', () => {
  it('accepts valid perceive response data', () => {
    const result = packActionPerceiveDataSchema.safeParse({
      capability_key: 'perceive.agent.context',
      data: { status: 'ok', tick: '100' }
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing capability_key', () => {
    const result = packActionPerceiveDataSchema.safeParse({
      data: {}
    })
    expect(result.success).toBe(false)
  })
})

describe('packActionInvokeDataSchema', () => {
  it('accepts valid invoke response data', () => {
    const result = packActionInvokeDataSchema.safeParse({
      capability_key: 'invoke.roll_dice',
      intent_id: 'ai_test_001'
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing intent_id', () => {
    const result = packActionInvokeDataSchema.safeParse({
      capability_key: 'invoke.roll_dice'
    })
    expect(result.success).toBe(false)
  })
})

// ── Tier 2: PackQueryHandlerRegistry ──

describe('PackQueryHandlerRegistry', () => {
  it('registers and finds a handler', () => {
    const registry = new PackQueryHandlerRegistry()
    const handler = {
      capability_key: 'perceive.test.status',
      resolve: vi.fn()
    }
    registry.register(handler)

    const found = registry.find('perceive.test.status')
    expect(found).toBeDefined()
    expect(found).toBe(handler)
  })

  it('returns undefined for unregistered key', () => {
    const registry = new PackQueryHandlerRegistry()
    expect(registry.find('perceive.nonexistent')).toBeUndefined()
  })

  it('allows multiple handlers with different keys', () => {
    const registry = new PackQueryHandlerRegistry()
    registry.register({ capability_key: 'perceive.a', resolve: vi.fn() })
    registry.register({ capability_key: 'perceive.b', resolve: vi.fn() })

    expect(registry.keys()).toHaveLength(2)
    expect(registry.keys()).toContain('perceive.a')
    expect(registry.keys()).toContain('perceive.b')
    expect(registry.find('perceive.a')).toBeDefined()
    expect(registry.find('perceive.b')).toBeDefined()
  })

  it('overwrites handler for duplicate key', () => {
    const registry = new PackQueryHandlerRegistry()
    const handler1 = { capability_key: 'perceive.x', resolve: vi.fn() }
    const handler2 = { capability_key: 'perceive.x', resolve: vi.fn() }

    registry.register(handler1)
    registry.register(handler2)

    expect(registry.find('perceive.x')).toBe(handler2)
    expect(registry.keys()).toHaveLength(1)
  })

  it('calls resolve with correct arguments', async () => {
    const registry = new PackQueryHandlerRegistry()
    const resolve = vi.fn().mockResolvedValue({ status: 'ok' })
    const handler = { capability_key: 'perceive.test', resolve }
    registry.register(handler)

    const mockContext = {} as AppContext
    const operator = {
      id: 'op-1',
      identity_id: 'identity-1',
      username: 'test',
      is_root: false,
      status: 'active',
      display_name: null
    }

    const found = registry.find('perceive.test')
    if (!found) {
      expect.fail('handler not found')
    }

    const result = await found.resolve(
      mockContext,
      'test-pack',
      { filter: 'active' },
      operator
    )

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith(mockContext, 'test-pack', { filter: 'active' }, operator)
    expect(result).toEqual({ status: 'ok' })
  })

  it('handles synchronous resolve', () => {
    const registry = new PackQueryHandlerRegistry()
    const handler = {
      capability_key: 'perceive.sync',
      resolve: vi.fn().mockReturnValue({ cached: true })
    }
    registry.register(handler)

    const result = handler.resolve({} as AppContext, 'p', {}, {
      id: 'op-1',
      identity_id: 'id-1',
      username: 'u',
      is_root: true,
      status: 'active',
      display_name: null
    })

    expect(result).toEqual({ cached: true })
  })
})

// ── Tier 3: Invoke dispatch helpers ──

describe('frontend action intent creation', () => {
  it('creates inference trace and action intent with correct fields', async () => {
    const inferenceTraceCreate = vi.fn().mockResolvedValue({})
    const actionIntentCreate = vi.fn().mockResolvedValue({ id: 'intent-001' })

    const mockContext = {
      prisma: {
        inferenceTrace: { create: inferenceTraceCreate },
        actionIntent: { create: actionIntentCreate }
      }
    } as unknown as AppContext

    const { createFrontendActionIntent } = await import(
      '../../src/app/routes/pack_actions.js'
    )

    const intent = await createFrontendActionIntent(
      mockContext,
      'test-pack',
      'invoke.roll_dice',
      { sides: 10 },
      'identity-1',
      100n
    )

    expect(intent).toEqual({ id: 'intent-001' })

    expect(inferenceTraceCreate).toHaveBeenCalledTimes(1)
    const traceCall = inferenceTraceCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(traceCall.data.kind).toBe('frontend_action')
    expect(traceCall.data.strategy).toBe('direct')
    expect(traceCall.data.provider).toBe('frontend')
    expect(traceCall.data.pack_id).toBe('test-pack')
    expect(traceCall.data.input).toEqual({
      capability_key: 'invoke.roll_dice',
      payload: { sides: 10 }
    })
    expect((traceCall.data.trace_metadata as Record<string, unknown>).source).toBe(
      'pack_frontend'
    )

    expect(actionIntentCreate).toHaveBeenCalledTimes(1)
    const intentCall = actionIntentCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(intentCall.data.intent_type).toBe('invoke.roll_dice')
    expect(intentCall.data.pack_id).toBe('test-pack')
    expect(intentCall.data.status).toBe('pending')
  })

  it('defaults nullish payload to empty object', async () => {
    const mockContext = {
      prisma: {
        inferenceTrace: { create: vi.fn().mockResolvedValue({}) },
        actionIntent: { create: vi.fn().mockResolvedValue({ id: 'intent-002' }) }
      }
    } as unknown as AppContext

    const { createFrontendActionIntent } = await import(
      '../../src/app/routes/pack_actions.js'
    )

    await createFrontendActionIntent(
      mockContext,
      'test-pack',
      'invoke.test',
      undefined,
      'identity-1',
      0n
    )

    const traceCall = mockContext.prisma.inferenceTrace.create.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(traceCall.data.input).toEqual({
      capability_key: 'invoke.test',
      payload: {}
    })
  })
})
