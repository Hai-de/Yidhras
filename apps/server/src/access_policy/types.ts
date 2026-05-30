import type { IdentityContext, IdentityType } from '../identity/types.js';

export type PolicyEffect = 'allow' | 'deny';

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  subject_id?: string | null | undefined;
  subject_type?: IdentityType | '*' | null | undefined;
  resource: string;
  action: string;
  field: string;
  conditions?: Record<string, unknown> | null | undefined;
  priority: number;
}

export interface PolicyMatchInput {
  identity: IdentityContext;
  resource: string;
  action: string;
  attributes?: Record<string, unknown> | undefined;
}

export interface FieldPolicyResult {
  allowedFields: Set<string>;
  deniedFields: Set<string>;
  hasWildcardAllow: boolean;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string | undefined;
  ruleId?: string | undefined;
  effect?: PolicyEffect | undefined;
  matchedPattern?: string | undefined;
}

export interface FieldDecisionDetail {
  field: string;
  allow: boolean;
  reason: string;
  rule_id?: string | undefined;
  matched_pattern?: string | undefined;
}
