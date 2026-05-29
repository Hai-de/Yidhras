import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/domain/authority/resolver.js', () => ({
  resolveAuthorityForSubject: vi.fn()
}));

import { resolveAuthorityForSubject } from '../../../../src/domain/authority/resolver.js';
import { resolveAuthority } from '../../../../src/inference/context/authority_adapter.js';

const mockResult = (subjectId: string | null) => ({
  subject_entity_id: subjectId,
  resolved_capabilities: [
    { capability_key: 'social_post.read', grant_type: 'direct', source_entity_id: 'src', mediated_by_entity_id: null, target_selector: {}, conditions: null, priority: 10, provenance: { authority_id: 'auth-1', source_entity_id: 'src', mediated_by_entity_id: null, matched_via: 'direct_actor_ref' as const } }
  ],
  blocked_authority_ids: [] as string[]
});

const makeCtx = () =>
  ({ prisma: {}, repos: {}, packStorageAdapter: {}, startupHealth: {}, assertRuntimeReady: () => {} }) as never;

describe('resolveAuthority', () => {
  it('returns capabilities and full result', async () => {
    vi.mocked(resolveAuthorityForSubject).mockResolvedValue(mockResult('e1'));

    const result = await resolveAuthority(makeCtx(), 'pack-1', 'pack-1:e1');

    expect(result.capabilities).toEqual(['social_post.read']);
    expect(result.fullResult.subject_entity_id).toBe('e1');
  });

  it('handles null resolvedAgentId', async () => {
    vi.mocked(resolveAuthorityForSubject).mockResolvedValue(mockResult(null));

    const result = await resolveAuthority(makeCtx(), 'pack-1', null);

    expect(result.capabilities).toEqual(['social_post.read']);
    expect(result.fullResult.subject_entity_id).toBeNull();
  });
});
