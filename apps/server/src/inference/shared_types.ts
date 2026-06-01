import type { IdentityContext } from '../identity/types.js';

export type InferenceActorRole = 'active' | 'atmosphere';

export interface InferenceActorRef {
  identity_id: string;
  identity_type: IdentityContext['type'];
  entity_kind?: string | undefined;
  role: InferenceActorRole;
  agent_id: string | null;
  atmosphere_node_id: string | null;
  /** Allow pass-through to Record<string, unknown> contexts without assertions. */
  [key: string]: unknown;
}
