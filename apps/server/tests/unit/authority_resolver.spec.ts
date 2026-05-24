import { describe, expect, it, vi } from 'vitest'

import type { AppInfrastructure } from '../../src/app/context.js'
import { resolveAuthorityForSubject } from '../../src/domain/authority/resolver.js'

describe('resolveAuthorityForSubject status filtering', () => {
  const buildMockContext = (authorityGrants: Array<Record<string, unknown>>, entities: Array<Record<string, unknown>> = [], entityStates: Array<Record<string, unknown>> = [], mediatorBindings: Array<Record<string, unknown>> = []) => {
    const adapter = {
      listEngineOwnedRecords: vi.fn((_packId: string, table: string) => {
        switch (table) {
          case 'authority_grants': return Promise.resolve(authorityGrants)
          case 'world_entities': return Promise.resolve(entities)
          case 'entity_states': return Promise.resolve(entityStates)
          case 'mediator_bindings': return Promise.resolve(mediatorBindings)
          default: return Promise.resolve([])
        }
      })
    }

    return {
      packStorageAdapter: adapter,
      prisma: {},
      repos: { inference: { transaction: vi.fn() } }
    } as unknown as AppInfrastructure
  }

  it('includes grants with status "active"', async () => {
    const context = buildMockContext(
      [
        {
          id: 'grant-active',
          pack_id: 'test-pack',
          source_entity_id: 'source-1',
          target_selector_json: { kind: 'direct_entity', entity_id: 'actor-1' },
          capability_key: 'test_cap',
          grant_type: 'mediated',
          mediated_by_entity_id: null,
          scope_json: null,
          conditions_json: null,
          priority: 0,
          status: 'active',
          revocable: true
        }
      ],
      [
        { id: 'actor-1', entity_kind: 'actor', entity_type: null }
      ]
    )

    const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })
    expect(result.resolved_capabilities).toHaveLength(1)
    expect(result.blocked_authority_ids).toHaveLength(0)
  })

  it('blocks grants with status "revoked"', async () => {
    const context = buildMockContext(
      [
        {
          id: 'grant-revoked',
          pack_id: 'test-pack',
          source_entity_id: 'source-1',
          target_selector_json: { kind: 'direct_entity', entity_id: 'actor-1' },
          capability_key: 'test_cap',
          grant_type: 'mediated',
          mediated_by_entity_id: null,
          scope_json: null,
          conditions_json: null,
          priority: 0,
          status: 'revoked',
          revocable: true
        }
      ],
      [
        { id: 'actor-1', entity_kind: 'actor', entity_type: null }
      ]
    )

    const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })
    expect(result.resolved_capabilities).toHaveLength(0)
    expect(result.blocked_authority_ids).toEqual(['grant-revoked'])
  })

  it('includes grants with null status', async () => {
    const context = buildMockContext(
      [
        {
          id: 'grant-no-status',
          pack_id: 'test-pack',
          source_entity_id: 'source-1',
          target_selector_json: { kind: 'direct_entity', entity_id: 'actor-1' },
          capability_key: 'test_cap',
          grant_type: 'mediated',
          mediated_by_entity_id: null,
          scope_json: null,
          conditions_json: null,
          priority: 0,
          status: null,
          revocable: null
        }
      ],
      [
        { id: 'actor-1', entity_kind: 'actor', entity_type: null }
      ]
    )

    const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })
    expect(result.blocked_authority_ids).toHaveLength(0)
    expect(result.resolved_capabilities).toHaveLength(1)
  })

  it('blocks grants with non-active status other than revoked', async () => {
    const context = buildMockContext(
      [
        {
          id: 'grant-expired',
          pack_id: 'test-pack',
          source_entity_id: 'source-1',
          target_selector_json: { kind: 'direct_entity', entity_id: 'actor-1' },
          capability_key: 'test_cap',
          grant_type: 'mediated',
          mediated_by_entity_id: null,
          scope_json: null,
          conditions_json: null,
          priority: 0,
          status: 'expired',
          revocable: true
        }
      ],
      [
        { id: 'actor-1', entity_kind: 'actor', entity_type: null }
      ]
    )

    const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })
    expect(result.blocked_authority_ids).toEqual(['grant-expired'])
  })

  describe('member_of selector', () => {
    const buildAuthorityGrant = (id: string, groupId: string) => ({
      id,
      pack_id: 'test-pack',
      source_entity_id: groupId,
      target_selector_json: { kind: 'member_of', entity_id: groupId },
      capability_key: `test_cap.${id}`,
      grant_type: 'institutional',
      mediated_by_entity_id: null,
      scope_json: null,
      conditions_json: null,
      priority: 0,
      status: 'active',
      revocable: true
    })

    it('resolves capabilities when subject core state member_of array contains the group id', async () => {
      const context = buildMockContext(
        [buildAuthorityGrant('grant-group-a', 'group-a')],
        [
          { id: 'actor-1', entity_kind: 'actor', entity_type: null },
          { id: 'group-a', entity_kind: 'collective', entity_type: 'cohort' }
        ],
        [
          { entity_id: 'actor-1', state_namespace: 'core', state_json: { member_of: ['group-a'] } }
        ]
      )

      const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })

      expect(result.resolved_capabilities).toHaveLength(1)
      expect(result.resolved_capabilities[0]?.provenance.matched_via).toBe('member_of')
      expect(result.blocked_authority_ids).toHaveLength(0)
    })

    it('resolves capabilities when subject core state member_of string equals the group id', async () => {
      const context = buildMockContext(
        [buildAuthorityGrant('grant-group-a', 'group-a')],
        [
          { id: 'actor-1', entity_kind: 'actor', entity_type: null },
          { id: 'group-a', entity_kind: 'collective', entity_type: 'cohort' }
        ],
        [
          { entity_id: 'actor-1', state_namespace: 'core', state_json: { member_of: 'group-a' } }
        ]
      )

      const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })

      expect(result.resolved_capabilities).toHaveLength(1)
      expect(result.resolved_capabilities[0]?.provenance.matched_via).toBe('member_of')
    })

    it('blocks member_of grants when subject membership does not contain the group id', async () => {
      const context = buildMockContext(
        [buildAuthorityGrant('grant-group-a', 'group-a')],
        [
          { id: 'actor-1', entity_kind: 'actor', entity_type: null },
          { id: 'group-a', entity_kind: 'collective', entity_type: 'cohort' }
        ],
        [
          { entity_id: 'actor-1', state_namespace: 'core', state_json: { member_of: ['group-b'] } }
        ]
      )

      const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })

      expect(result.resolved_capabilities).toHaveLength(0)
      expect(result.blocked_authority_ids).toEqual(['grant-group-a'])
    })

    it('blocks member_of grants when subject has no core state', async () => {
      const context = buildMockContext(
        [buildAuthorityGrant('grant-group-a', 'group-a')],
        [
          { id: 'actor-1', entity_kind: 'actor', entity_type: null },
          { id: 'group-a', entity_kind: 'collective', entity_type: 'cohort' }
        ]
      )

      const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })

      expect(result.resolved_capabilities).toHaveLength(0)
      expect(result.blocked_authority_ids).toEqual(['grant-group-a'])
    })

    it('blocks member_of grants when the group entity does not exist', async () => {
      const context = buildMockContext(
        [buildAuthorityGrant('grant-group-a', 'group-a')],
        [{ id: 'actor-1', entity_kind: 'actor', entity_type: null }],
        [
          { entity_id: 'actor-1', state_namespace: 'core', state_json: { member_of: ['group-a'] } }
        ]
      )

      const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })

      expect(result.resolved_capabilities).toHaveLength(0)
      expect(result.blocked_authority_ids).toEqual(['grant-group-a'])
    })

    it('resolves multiple group grants for actors with multiple memberships', async () => {
      const context = buildMockContext(
        [
          buildAuthorityGrant('grant-group-a', 'group-a'),
          buildAuthorityGrant('grant-group-b', 'group-b')
        ],
        [
          { id: 'actor-1', entity_kind: 'actor', entity_type: null },
          { id: 'group-a', entity_kind: 'collective', entity_type: 'cohort' },
          { id: 'group-b', entity_kind: 'institution', entity_type: 'faction' }
        ],
        [
          { entity_id: 'actor-1', state_namespace: 'core', state_json: { member_of: ['group-a', 'group-b'] } }
        ]
      )

      const result = await resolveAuthorityForSubject(context, { packId: 'test-pack', subjectEntityId: 'actor-1' })

      expect(result.resolved_capabilities.map(item => item.provenance.authority_id).sort()).toEqual([
        'grant-group-a',
        'grant-group-b'
      ])
      expect(result.resolved_capabilities.every(item => item.provenance.matched_via === 'member_of')).toBe(true)
      expect(result.blocked_authority_ids).toHaveLength(0)
    })
  })

})
