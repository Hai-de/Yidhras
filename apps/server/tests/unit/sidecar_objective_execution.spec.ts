import { describe, expect, it } from 'vitest'

import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts'

import { buildSidecarObjectiveExecutionRequest } from '../../src/domain/rule/sidecar_objective_execution.js'
import type { InvocationRequest } from '../../src/domain/invocation/invocation_dispatcher.js'
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js'

const buildMockInvocation = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  id: 'inv-1',
  pack_id: 'test-pack',
  source_action_intent_id: 'action-1',
  source_inference_id: 'inf-1',
  invocation_type: 'invoke.test_capability',
  capability_key: 'test_capability',
  subject_entity_id: 'actor-1',
  target_ref: null,
  payload: {},
  mediator_id: null,
  actor_ref: {},
  created_at: 1000n,
  ...overrides
})

const buildMockPackRuntime = (overrides: {
  variables?: Record<string, unknown>
  rules?: Array<{ id: string; when?: unknown; then?: unknown }>
} = {}) => ({
  getPack: () => ({
    metadata: { id: 'test-pack' },
    rules: { objective_enforcement: overrides.rules ?? [] },
    variables: overrides.variables
  })
})

const mockContext = {
  packStorageAdapter: {
    listEngineOwnedRecords: async () => []
  } as unknown as PackStorageAdapter
} as any

describe('buildSidecarObjectiveExecutionRequest', () => {
  it('includes pack_variables when pack has variables', async () => {
    const packRuntime = buildMockPackRuntime({
      variables: { threshold: 5, model_defense: { firewall: 99 } }
    })

    const request = await buildSidecarObjectiveExecutionRequest(
      mockContext,
      {
        invocation: buildMockInvocation(),
        effectiveMediatorId: null,
        packStorageAdapter: mockContext.packStorageAdapter
      },
      packRuntime
    )

    expect(request.pack_variables).toEqual({ threshold: 5, model_defense: { firewall: 99 } })
  })

  it('sends null pack_variables when pack has no variables', async () => {
    const packRuntime = buildMockPackRuntime({})

    const request = await buildSidecarObjectiveExecutionRequest(
      mockContext,
      {
        invocation: buildMockInvocation(),
        effectiveMediatorId: null,
        packStorageAdapter: mockContext.packStorageAdapter
      },
      packRuntime
    )

    expect(request.pack_variables).toBeNull()
  })

  it('uses the protocol version constant', async () => {
    const packRuntime = buildMockPackRuntime()

    const request = await buildSidecarObjectiveExecutionRequest(
      mockContext,
      {
        invocation: buildMockInvocation(),
        effectiveMediatorId: null,
        packStorageAdapter: mockContext.packStorageAdapter
      },
      packRuntime
    )

    expect(request.protocol_version).toBe(WORLD_ENGINE_PROTOCOL_VERSION)
  })

  it('includes invocation fields in the request', async () => {
    const packRuntime = buildMockPackRuntime()
    const invocation = buildMockInvocation({
      capability_key: 'move',
      subject_entity_id: 'actor-7'
    })

    const request = await buildSidecarObjectiveExecutionRequest(
      mockContext,
      {
        invocation,
        effectiveMediatorId: 'mediator-1',
        packStorageAdapter: mockContext.packStorageAdapter
      },
      packRuntime
    )

    expect(request.invocation.capability_key).toBe('move')
    expect(request.invocation.subject_entity_id).toBe('actor-7')
    expect(request.effective_mediator_id).toBe('mediator-1')
  })
})
