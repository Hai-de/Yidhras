export type IdentityType = 'user' | 'agent' | 'system' | 'anonymous' | 'plugin_reserved' | 'external_reserved';

export interface IdentityContext {
  id: string;
  type: IdentityType;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  claims?: Record<string, unknown> | null;
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
