export type IdentityType = 'user' | 'agent' | 'system' | 'anonymous' | 'plugin_reserved' | 'external_reserved';

export interface IdentityContext {
  id: string;
  type: IdentityType;
  name?: string | null | undefined;
  provider?: string | null | undefined;
  status?: string | null | undefined;
  claims?: Record<string, unknown> | null | undefined;
}

export type IdentityBindingRole = 'active' | 'atmosphere';
export type IdentityBindingStatus = 'active' | 'inactive' | 'expired';

export interface IdentityNodeBindingInput {
  identity_id: string;
  agent_id?: string | null | undefined;
  atmosphere_node_id?: string | null | undefined;
  role: IdentityBindingRole;
  status?: IdentityBindingStatus | undefined;
  expires_at?: string | null | undefined;
}
