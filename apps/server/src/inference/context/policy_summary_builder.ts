import { AccessPolicyService } from '../../access_policy/service.js';
import type { InferencePolicySummary } from '../types.js';
import type { InferenceContextConfig } from './config_loader.js';
import type { PolicySummaryInput } from './types.js';

export interface PolicySummaryContext {
  repos: {
    identityOperator: {
      listPolicies(where: Record<string, unknown>): Promise<Array<{
        id: string;
        effect: string;
        subject_id: string | null;
        subject_type: string | null;
        resource: string;
        action: string;
        field: string;
        conditions: unknown;
        priority: number;
        created_at: bigint;
        updated_at: bigint;
      }>>;
    };
  };
}

export const buildPolicySummary = async (
  context: PolicySummaryContext,
  input: PolicySummaryInput,
  config?: InferenceContextConfig
): Promise<InferencePolicySummary> => {
  const service = new AccessPolicyService(context.repos.identityOperator);
  const evaluations = config?.policy_summary?.evaluations ?? [
    {
      resource: 'social_post',
      action: 'read',
      fields: ['id', 'author_id', 'content', 'created_at', 'content.private.preview', 'content.private.raw']
    },
    {
      resource: 'social_post',
      action: 'write',
      fields: ['content']
    }
  ];

  const results: Record<string, { allowed: boolean; fields: string[] }> = {};

  for (const evaluation of evaluations) {
    const result = await service.evaluateFields(
      {
        identity: input.identity,
        resource: evaluation.resource,
        action: evaluation.action,
        attributes: input.attributes
      },
      evaluation.fields
    );
    const key = `${evaluation.resource}_${evaluation.action}`;
    results[key] = {
      allowed: result.allowedFields.size > 0,
      fields: Array.from(result.allowedFields)
    };
  }

  const read = results['social_post_read'];
  const write = results['social_post_write'];

  return {
    social_post_read_allowed: read?.allowed ?? false,
    social_post_readable_fields: read?.fields ?? [],
    social_post_write_allowed: write?.allowed ?? false,
    social_post_writable_fields: write?.fields ?? []
  };
};
