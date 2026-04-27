import { Prisma, PrismaClient } from '@prisma/client';

import type { AppInfrastructure } from '../app/context.js';
import type { IdentityContext } from '../identity/types.js';
import { ApiError } from '../utils/api_error.js';
import { evaluateFieldPolicies, resolveAllowedFields, resolveFieldDecision } from './policy_engine.js';
import type {
  FieldDecisionDetail,
  FieldPolicyResult,
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

export class AccessPolicyService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
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

export interface CreatePolicyInput {
  effect?: string;
  subject_id?: string;
  subject_type?: string;
  resource?: string;
  action?: string;
  field?: string;
  conditions?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
  priority?: number;
}

export interface EvaluatePolicyInput {
  resource?: string;
  action?: string;
  fields?: string[];
  attributes?: Record<string, unknown>;
}

export interface PolicyAccessInput {
  resource: string;
  action: string;
  attributes?: Record<string, unknown>;
}

interface PolicyAccessContext {
  service: AccessPolicyService;
  matchInput: PolicyMatchInput;
}

export const requireAccessPolicyIdentity = (identity: IdentityContext | undefined): IdentityContext => {
  if (!identity) {
    throw new ApiError(401, 'IDENTITY_REQUIRED', 'Identity is required');
  }

  return identity;
};

const createAccessPolicyService = (context: AppInfrastructure): AccessPolicyService => {
  return new AccessPolicyService(context.prisma);
};

const createPolicyAccessContext = (
  context: AppInfrastructure,
  identity: IdentityContext | undefined,
  input: PolicyAccessInput
): PolicyAccessContext => {
  return {
    service: createAccessPolicyService(context),
    matchInput: {
      identity: requireAccessPolicyIdentity(identity),
      resource: input.resource,
      action: input.action,
      attributes: input.attributes
    }
  };
};

export const createAccessPolicy = async (
  context: AppInfrastructure,
  input: CreatePolicyInput
) => {
  const { effect, subject_id, subject_type, resource, action, field, conditions, priority } = input;

  if (!effect || !resource || !action || !field) {
    throw new ApiError(400, 'POLICY_INVALID', 'effect, resource, action, field are required');
  }

  if (effect !== 'allow' && effect !== 'deny') {
    throw new ApiError(400, 'POLICY_INVALID', 'effect must be allow or deny');
  }

  const now = context.clock.getCurrentTick();

  return context.prisma.policy.create({
    data: {
      effect,
      subject_id: subject_id ?? null,
      subject_type: subject_type ?? null,
      resource,
      action,
      field,
      conditions:
        conditions && Object.keys(conditions).length > 0
          ? (conditions as Prisma.InputJsonValue)
          : undefined,
      priority: priority ?? 0,
      created_at: now,
      updated_at: now
    }
  });
};

export const filterReadableFieldsByAccessPolicy = async <T extends Record<string, unknown>>(
  context: AppInfrastructure,
  identity: IdentityContext | undefined,
  input: PolicyAccessInput,
  record: T
): Promise<Partial<T>> => {
  const { service, matchInput } = createPolicyAccessContext(context, identity, input);

  return service.filterReadableFields(matchInput, record);
};

export const assertWriteAllowedByAccessPolicy = async (
  context: AppInfrastructure,
  identity: IdentityContext | undefined,
  input: PolicyAccessInput,
  payload: Record<string, unknown>
): Promise<void> => {
  const { service, matchInput } = createPolicyAccessContext(context, identity, input);

  await service.assertWriteAllowed(matchInput, payload);
};

export const evaluateAccessPolicy = async (
  context: AppInfrastructure,
  identity: IdentityContext | undefined,
  input: EvaluatePolicyInput
) => {
  const { resource, action, fields, attributes } = input;

  if (!resource || !action || !fields) {
    throw new ApiError(400, 'POLICY_EVAL_INVALID', 'resource, action, fields are required');
  }

  const { service, matchInput } = createPolicyAccessContext(context, identity, {
    resource,
    action,
    attributes
  });

  const result = await service.evaluateFields(matchInput, fields);
  const details = await service.explainFieldDecisions(matchInput, fields);

  return {
    allowed_fields: Array.from(result.allowedFields),
    denied_fields: Array.from(result.deniedFields),
    has_wildcard_allow: result.hasWildcardAllow,
    details
  };
};
