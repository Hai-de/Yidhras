export interface ToolPermissionPolicy {
  tool_id: string;
  allowed_roles: string[];
  allowed_pack_ids?: string[];
  require_capability?: string;
  rate_limit?: { max_per_tick: number; cooldown_ticks: number };
}

export interface ToolPermissionCheckInput {
  tool_id: string;
  agent_role?: string | null;
  pack_id?: string | null;
  capabilities?: string[];
}

export interface ToolPermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export const checkToolPermission = (
  policy: ToolPermissionPolicy,
  input: ToolPermissionCheckInput
): ToolPermissionCheckResult => {
  if (policy.tool_id !== input.tool_id) {
    return { allowed: false, reason: `Policy tool_id "${policy.tool_id}" does not match "${input.tool_id}"` };
  }

  if (input.agent_role && !policy.allowed_roles.includes(input.agent_role)) {
    return {
      allowed: false,
      reason: `Agent role "${input.agent_role}" is not in allowed roles: [${policy.allowed_roles.join(', ')}]`
    };
  }

  if (policy.allowed_pack_ids && policy.allowed_pack_ids.length > 0) {
    if (!input.pack_id || !policy.allowed_pack_ids.includes(input.pack_id)) {
      return {
        allowed: false,
        reason: `Pack "${input.pack_id ?? 'null'}" is not in allowed pack IDs: [${policy.allowed_pack_ids.join(', ')}]`
      };
    }
  }

  if (policy.require_capability) {
    if (!input.capabilities || !input.capabilities.includes(policy.require_capability)) {
      return {
        allowed: false,
        reason: `Required capability "${policy.require_capability}" is not present`
      };
    }
  }

  return { allowed: true };
};

export const resolveToolPermissions = (
  policies: ToolPermissionPolicy[],
  toolId: string,
  input: Omit<ToolPermissionCheckInput, 'tool_id'>
): ToolPermissionCheckResult => {
  const policy = policies.find(p => p.tool_id === toolId);
  if (!policy) {
    return { allowed: true };
  }

  return checkToolPermission(policy, { tool_id: toolId, ...input });
};
