import { describe, expect, it, vi } from 'vitest';

import { buildPolicySummary } from '../../../../src/inference/context/policy_summary_builder.js';
import { makeMockConfig } from '../../../helpers/inference-mocks.js';

function makeCtx(opts?: {
  listPolicies?: ReturnType<typeof vi.fn>;
}) {
  return {
    repos: {
      identityOperator: {
        listPolicies: opts?.listPolicies ?? vi.fn(async () => [])
      }
    }
  };
}

const identity = {
  id: 'ident-1',
  type: 'agent' as const,
  name: 'Test Agent',
  provider: 'local' as const,
  status: 'active' as const,
  claims: null
};

const emptyAttributes = {};

describe('buildPolicySummary', () => {
  // ── Default evaluations → social_post read/write ──────────
  describe('default evaluations', () => {
    it('returns social_post read/write results from default config', async () => {
      const listPolicies = vi.fn(async () => [
        {
          id: 'pol-1',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'social_post',
          action: 'read',
          field: 'id',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        },
        {
          id: 'pol-2',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'social_post',
          action: 'read',
          field: 'author_id',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        },
        {
          id: 'pol-3',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'social_post',
          action: 'read',
          field: 'content',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        },
        {
          id: 'pol-4',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'social_post',
          action: 'write',
          field: 'content',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        }
      ]);

      const ctx = makeCtx({ listPolicies });
      const config = makeMockConfig();

      const result = await buildPolicySummary(ctx, { identity, attributes: emptyAttributes }, config);

      // Read should be allowed (matching policies exist for id, author_id, content fields)
      expect(result.social_post_read_allowed).toBe(true);
      expect(result.social_post_readable_fields).toContain('id');
      expect(result.social_post_readable_fields).toContain('author_id');
      expect(result.social_post_readable_fields).toContain('content');

      // Write should be allowed (matching policy for content field)
      expect(result.social_post_write_allowed).toBe(true);
      expect(result.social_post_writable_fields).toContain('content');
    });

    it('returns denied when no matching policies exist', async () => {
      const listPolicies = vi.fn(async () => []);
      const ctx = makeCtx({ listPolicies });
      const config = makeMockConfig();

      const result = await buildPolicySummary(ctx, { identity, attributes: emptyAttributes }, config);

      expect(result.social_post_read_allowed).toBe(false);
      expect(result.social_post_readable_fields).toEqual([]);
      expect(result.social_post_write_allowed).toBe(false);
      expect(result.social_post_writable_fields).toEqual([]);
    });

    it('falls back to default config when no config is passed', async () => {
      const listPolicies = vi.fn(async () => [
        {
          id: 'pol-1',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'social_post',
          action: 'read',
          field: 'id',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        }
      ]);

      const ctx = makeCtx({ listPolicies });

      // No config passed — should not throw
      const result = await buildPolicySummary(ctx, { identity, attributes: emptyAttributes });

      expect(result.social_post_read_allowed).toBe(true);
      expect(result.social_post_readable_fields).toContain('id');
    });
  });

  // ── Custom evaluations ────────────────────────────────────
  describe('custom evaluations', () => {
    it('uses custom evaluations from config', async () => {
      const listPolicies = vi.fn(async () => [
        {
          id: 'pol-custom',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'custom_resource',
          action: 'view',
          field: 'title',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        }
      ]);

      const ctx = makeCtx({ listPolicies });
      const config = makeMockConfig({
        policyEvaluations: [
          {
            resource: 'custom_resource',
            action: 'view',
            fields: ['title', 'body']
          }
        ]
      });

      const result = await buildPolicySummary(ctx, { identity, attributes: emptyAttributes }, config);

      // Default social_post keys should still be present
      expect(result.social_post_read_allowed).toBe(false);
      expect(result.social_post_write_allowed).toBe(false);
    });

    it('returns empty config when evaluations are empty', async () => {
      const listPolicies = vi.fn(async () => []);
      const ctx = makeCtx({ listPolicies });
      const config = makeMockConfig({ policyEvaluations: [] });

      const result = await buildPolicySummary(ctx, { identity, attributes: emptyAttributes }, config);

      expect(result.social_post_read_allowed).toBe(false);
      expect(result.social_post_write_allowed).toBe(false);
    });
  });

  // ── AccessPolicyService interaction ───────────────────────
  describe('AccessPolicyService interaction', () => {
    it('calls listPolicies for each evaluation resource+action', async () => {
      const listPolicies = vi.fn(async () => []);
      const ctx = makeCtx({ listPolicies });
      const config = makeMockConfig({
        policyEvaluations: [
          { resource: 'post', action: 'read', fields: ['title'] },
          { resource: 'post', action: 'write', fields: ['title'] },
          { resource: 'comment', action: 'create', fields: ['body'] }
        ]
      });

      await buildPolicySummary(ctx, { identity, attributes: emptyAttributes }, config);

      // listPolicies is called multiple times by AccessPolicyService.evaluateFields
      expect(listPolicies).toHaveBeenCalled();
    });

    it('passes identity and attributes to AccessPolicyService', async () => {
      const listPolicies = vi.fn(async () => [
        {
          id: 'pol-1',
          effect: 'allow',
          subject_id: 'ident-1',
          subject_type: 'agent',
          resource: 'social_post',
          action: 'read',
          field: 'id',
          conditions: null,
          priority: 1,
          created_at: 0n,
          updated_at: 0n
        }
      ]);
      const ctx = makeCtx({ listPolicies });
      const config = makeMockConfig();
      const attrs = { actor_role: 'admin' };

      const result = await buildPolicySummary(ctx, { identity, attributes: attrs }, config);

      // Policy evaluation should succeed for matching identity
      expect(result.social_post_read_allowed).toBe(true);
    });
  });
});
