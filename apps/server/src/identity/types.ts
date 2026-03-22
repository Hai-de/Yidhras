export type IdentityType = 'user' | 'agent' | 'system' | 'plugin_reserved' | 'external_reserved';

export interface IdentityContext {
  id: string;
  type: IdentityType;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  claims?: Record<string, unknown> | null;
}

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

export type IdentityBindingRole = 'active' | 'atmosphere';
export type IdentityBindingStatus = 'active' | 'inactive' | 'expired';

export interface IdentityNodeBindingInput {
  identity_id: string;
  agent_id?: string | null;
  atmosphere_node_id?: string | null;
  role: IdentityBindingRole;
  status?: IdentityBindingStatus;
  expires_at?: string | null;
}
