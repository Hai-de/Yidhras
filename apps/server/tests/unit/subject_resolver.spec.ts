import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../../src/app/context.js'
import {
  resolveSubjectForAgentAction,
  resolveSubjectForOperator
} from '../../src/operator/guard/subject_resolver.js'

describe('subject resolver', () => {
  let context: AppContext
  let mockFindFirst: ReturnType<typeof vi.fn>

  const operator = {
    id: 'op-1',
    identity_id: 'identity-op-1',
    username: 'alice',
    is_root: false,
    status: 'active',
    display_name: null
  }

  beforeEach(() => {
    mockFindFirst = vi.fn()
    context = {
      prisma: {
        identityNodeBinding: {
          findFirst: mockFindFirst
        }
      } as unknown as AppContext['prisma'],
      sim: {
        getCurrentTick: () => 1000n
      }
    } as AppContext
  })

  describe('resolveSubjectForOperator', () => {
    it('returns bound agent when targetAgentId specified and binding exists', async () => {
      mockFindFirst.mockResolvedValue({
        identity_id: 'identity-op-1',
        agent_id: 'agent-1',
        status: 'active'
      })

      const result = await resolveSubjectForOperator(context, operator, 'pack-1', 'agent-1')

      expect(result.subjectEntityId).toBe('agent-1')
      expect(result.actingAsAgentId).toBe('agent-1')
      expect(result.provenance).toBe('operator_bound_as_agent')
    })

    it('falls back to default binding when no targetAgentId', async () => {
      mockFindFirst.mockResolvedValue({
        identity_id: 'identity-op-1',
        agent_id: 'agent-default',
        status: 'active'
      })

      const result = await resolveSubjectForOperator(context, operator, 'pack-1')

      expect(result.subjectEntityId).toBe('agent-default')
      expect(result.provenance).toBe('operator_default_binding')
    })

    it('falls back to operator identity when no bindings exist', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await resolveSubjectForOperator(context, operator, 'pack-1')

      expect(result.subjectEntityId).toBe('identity-op-1')
      expect(result.actingAsAgentId).toBeNull()
      expect(result.provenance).toBe('operator_direct_identity')
    })

    it('falls back to operator identity when targetAgentId binding missing', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await resolveSubjectForOperator(context, operator, 'pack-1', 'agent-missing')

      expect(result.subjectEntityId).toBe('identity-op-1')
      expect(result.provenance).toBe('operator_direct_identity')
    })
  })

  describe('resolveSubjectForAgentAction', () => {
    it('returns controller operator identity when agent has active user binding', async () => {
      mockFindFirst.mockResolvedValue({
        identity_id: 'identity-user-1',
        agent_id: 'agent-1',
        role: 'active',
        status: 'active',
        identity: {
          id: 'identity-user-1',
          type: 'user'
        }
      })

      const result = await resolveSubjectForAgentAction(context, 'agent-1', 'pack-1')

      expect(result.subjectEntityId).toBe('identity-user-1')
      expect(result.actingAsAgentId).toBe('agent-1')
      expect(result.provenance).toBe('agent_controlled_by_operator')
    })

    it('returns agent itself when no controlling operator (NPC)', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await resolveSubjectForAgentAction(context, 'agent-npc', 'pack-1')

      expect(result.subjectEntityId).toBe('agent-npc')
      expect(result.actingAsAgentId).toBeNull()
      expect(result.provenance).toBe('agent_npc')
    })

    it('returns agent itself when binding identity is not user type', async () => {
      mockFindFirst.mockResolvedValue({
        identity_id: 'identity-agent-2',
        agent_id: 'agent-1',
        role: 'active',
        status: 'active',
        identity: {
          id: 'identity-agent-2',
          type: 'agent'
        }
      })

      const result = await resolveSubjectForAgentAction(context, 'agent-1', 'pack-1')

      expect(result.subjectEntityId).toBe('agent-1')
      expect(result.provenance).toBe('agent_npc')
    })
  })
})
