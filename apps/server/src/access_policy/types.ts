import type { IdentityContext, IdentityType } from '../identity/types.js';

export type PolicyEffect = 'allow' | 'deny';

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  subject_id?: string | null;
  subject_type?: IdentityType | '*' | null;
  resource: string;
  action: string;
  field: string;
  conditions?: Record<string, unknown> | null;
  priority: number;
}

export interface PolicyMatchInput {
  identity: IdentityContext;
  resource: string;
  action: string;
  attributes?: Record<string, unknown>;
}

export interface FieldPolicyResult {
  allowedFields: Set<string>;
  deniedFields: Set<string>;
  hasWildcardAllow: boolean;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
  ruleId?: string;
  effect?: PolicyEffect;
  matchedPattern?: string;
}

export interface FieldDecisionDetail {
  field: string;
  allow: boolean;
  reason: string;
  rule_id?: string;
  matched_pattern?: string;
}
