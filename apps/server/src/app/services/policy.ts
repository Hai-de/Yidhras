import { Prisma } from '@prisma/client';

import { IdentityPolicyService } from '../../identity/service.js';
import type { IdentityContext, PolicyMatchInput } from '../../identity/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface CreatePolicyInput {
  effect?: string;
  subject_id?: string;
  subject_type?: string;
  resource?: string;
  action?: string;
  field?: string;
  conditions?: unknown;
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

export interface PolicyServiceDependencies {
  validatePolicyConditions(conditions: unknown): Record<string, unknown>;
}

interface PolicyAccessContext {
  service: IdentityPolicyService;
  matchInput: PolicyMatchInput;
}

export const requirePolicyIdentity = (identity: IdentityContext | undefined): IdentityContext => {
  if (!identity) {
    throw new ApiError(401, 'IDENTITY_REQUIRED', 'Identity is required');
  }

  return identity;
};

const createIdentityPolicyService = (context: AppContext): IdentityPolicyService => {
  return new IdentityPolicyService(context.sim.prisma);
};

const createPolicyAccessContext = (
  context: AppContext,
  identity: IdentityContext | undefined,
  input: PolicyAccessInput
): PolicyAccessContext => {
  return {
    service: createIdentityPolicyService(context),
    matchInput: {
      identity: requirePolicyIdentity(identity),
      resource: input.resource,
      action: input.action,
      attributes: input.attributes
    }
  };
};

export const createPolicy = async (
  context: AppContext,
  input: CreatePolicyInput,
  deps: PolicyServiceDependencies
) => {
  const { effect, subject_id, subject_type, resource, action, field, conditions, priority } = input;

  if (!effect || !resource || !action || !field) {
    throw new ApiError(400, 'POLICY_INVALID', 'effect, resource, action, field are required');
  }

  if (effect !== 'allow' && effect !== 'deny') {
    throw new ApiError(400, 'POLICY_INVALID', 'effect must be allow or deny');
  }

  const validatedConditions = deps.validatePolicyConditions(conditions);
  const now = context.sim.clock.getTicks();

  return context.sim.prisma.policy.create({
    data: {
      effect,
      subject_id: subject_id ?? null,
      subject_type: subject_type ?? null,
      resource,
      action,
      field,
      conditions:
        Object.keys(validatedConditions).length > 0
          ? (validatedConditions as Prisma.InputJsonValue)
          : undefined,
      priority: priority ?? 0,
      created_at: now,
      updated_at: now
    }
  });
};

export const filterReadableFieldsForIdentity = async <T extends Record<string, unknown>>(
  context: AppContext,
  identity: IdentityContext | undefined,
  input: PolicyAccessInput,
  record: T
): Promise<Partial<T>> => {
  const { service, matchInput } = createPolicyAccessContext(context, identity, input);

  return service.filterReadableFields(matchInput, record);
};

export const assertWriteAllowedForIdentity = async (
  context: AppContext,
  identity: IdentityContext | undefined,
 input: PolicyAccessInput,
  payload: Record<string, unknown>
): Promise<void> => {
  const { service, matchInput } = createPolicyAccessContext(context, identity, input);

  await service.assertWriteAllowed(matchInput, payload);
};

export const evaluatePolicy = async (
  context: AppContext,
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
