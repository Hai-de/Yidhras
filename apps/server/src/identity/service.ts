import { PrismaClient } from '@prisma/client';

import { ApiError } from '../utils/api_error.js';
import { evaluateFieldPolicies, resolveAllowedFields, resolveFieldDecision } from './policy_engine.js';
import {
  FieldDecisionDetail,
  FieldPolicyResult,
  IdentityContext,
  PolicyMatchInput,
  PolicyRule
} from './types.js';

const toPolicyRule = (rule: {
  id: string;
  effect: string;
  subject_id: string | null;
  subject_type: string | null;
  resource: string;
  action: string;
  field: string;
  conditions: unknown;
  priority: number;
}): PolicyRule => {
  return {
    id: rule.id,
    effect: rule.effect === 'deny' ? 'deny' : 'allow',
    subject_id: rule.subject_id ?? null,
    subject_type: (rule.subject_type as PolicyRule['subject_type']) ?? null,
    resource: rule.resource,
    action: rule.action,
    field: rule.field,
    conditions: (rule.conditions as Record<string, unknown> | null | undefined) ?? null,
    priority: rule.priority
  };
};

export class IdentityPolicyService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  public async fetchIdentity(identityId: string): Promise<IdentityContext | null> {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId }
    });
    if (!identity) {
      return null;
    }
    return {
      id: identity.id,
      type: identity.type as IdentityContext['type'],
      name: identity.name,
      provider: identity.provider,
      status: identity.status,
      claims: identity.claims as Record<string, unknown> | null
    };
  }

  public async listPolicies(input: PolicyMatchInput): Promise<PolicyRule[]> {
    const rules = await this.prisma.policy.findMany({
      where: {
        resource: input.resource,
        action: input.action,
        OR: [
          { subject_id: input.identity.id },
          { subject_type: input.identity.type },
          { subject_type: '*' }
        ]
      }
    });
    return rules.map(toPolicyRule);
  }

  public async evaluateFields(
    input: PolicyMatchInput,
    fields: string[]
  ): Promise<FieldPolicyResult> {
    if (fields.length === 0) {
      return {
        allowedFields: new Set<string>(),
        deniedFields: new Set<string>(),
        hasWildcardAllow: false
      };
    }

    const rules = await this.listPolicies(input);
    const decisions = evaluateFieldPolicies(rules, input, fields);
    const allowedFields = resolveAllowedFields(fields, decisions);
    const deniedFields = new Set<string>();
    let hasWildcardAllow = false;

    for (const field of fields) {
      if (!allowedFields.has(field)) {
        deniedFields.add(field);
      }
    }
    if (decisions.get('*')?.allow === true) {
      hasWildcardAllow = true;
    }

    return { allowedFields, deniedFields, hasWildcardAllow };
  }

  public async explainFieldDecisions(
    input: PolicyMatchInput,
    fields: string[]
  ): Promise<FieldDecisionDetail[]> {
    if (fields.length === 0) {
      return [];
    }

    const rules = await this.listPolicies(input);
    const decisions = evaluateFieldPolicies(rules, input, fields);
    return fields.map(field => {
      const decision = resolveFieldDecision(field, decisions);
      return {
        field,
        allow: decision.allow,
        reason: decision.reason ?? 'unknown',
        rule_id: decision.ruleId,
        matched_pattern: decision.matchedPattern
      };
    });
  }

  public async assertWriteAllowed(
    input: PolicyMatchInput,
    payload: Record<string, unknown>
  ): Promise<void> {
    const fields = Object.keys(payload);
    const result = await this.evaluateFields(input, fields);
    if (result.deniedFields.size > 0) {
      throw new ApiError(403, 'IDENTITY_FIELD_FORBIDDEN', 'Write field not allowed', {
        resource: input.resource,
        action: input.action,
        denied_fields: Array.from(result.deniedFields)
      });
    }
  }

  public async filterReadableFields<T extends Record<string, unknown>>(
    input: PolicyMatchInput,
    record: T
  ): Promise<Partial<T>> {
    const fields = Object.keys(record);
    const result = await this.evaluateFields(input, fields);
    const output: Partial<T> = {};

    for (const field of fields) {
      if (result.allowedFields.has(field)) {
        (output as Record<string, unknown>)[field] = record[field];
      }
    }
    return output;
  }
}
