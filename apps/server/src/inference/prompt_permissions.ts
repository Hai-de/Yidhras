import { getRuntimeConfig } from '../config/runtime_config.js';
import type { PromptFragmentV2 } from './prompt_fragment_v2.js';
import type { PromptSlotConfig } from './prompt_slot_config.js';
import type { PromptTree } from './prompt_tree.js';
import type { InferenceContext } from './types.js';

export const HOST_AGENT_TOKEN = 'host_agent';

export interface PermissionCheckInput {
  slot_config: PromptSlotConfig;
  fragment: PromptFragmentV2;
  actor_identity_id: string;
  actor_agent_id: string | null;
  host_agent_ids: string[];
  permission_kind: 'read' | 'write' | 'adjust' | 'visibility';
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export function getHostAgentIds(context: InferenceContext): string[] {
  const ids: string[] = [];
  const bindingAgentId = context.binding_ref?.agent_id;
  if (bindingAgentId) {
    ids.push(bindingAgentId);
  }
  const packHostIds = (context.world_pack as unknown as Record<string, unknown>)?.host_agent_ids;
  if (Array.isArray(packHostIds)) {
    for (const id of packHostIds) {
      if (typeof id === 'string' && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function resolveTokenValues(tokens: string[], hostAgentIds: string[]): string[] {
  return tokens.flatMap(token => {
    // eslint-disable-next-line security/detect-possible-timing-attacks -- internal token comparison, not auth
    if (token === HOST_AGENT_TOKEN) {
      return hostAgentIds.length > 0 ? hostAgentIds : [];
    }
    return [token];
  });
}

export function resolveSlotPermission(input: PermissionCheckInput): PermissionCheckResult {
  const featureEnabled = getRuntimeConfig().features?.experimental?.prompt_slot_permissions;
  if (!featureEnabled) {
    return { allowed: true };
  }

  if (input.permission_kind === 'write' || input.permission_kind === 'adjust') {
    return { allowed: true, reason: 'write/adjust not yet enforced (Phase 3)' };
  }

  // visibility kind maps to 'visible' + 'visible_to' on permissions
  const isVisibility = input.permission_kind === 'visibility';
  const permKey = isVisibility ? 'visible' : input.permission_kind;
  const slotPerms = input.slot_config.permissions;
  const fragPerms = input.fragment.permissions;
  const allowedList: string[] | boolean | undefined | null =
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    (fragPerms as unknown as Record<string, unknown>)?.[permKey] as string[] | boolean | undefined | null
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    ?? (slotPerms as unknown as Record<string, unknown>)?.[permKey] as string[] | boolean | undefined | null;

  if (allowedList === null) {
    return { allowed: true };
  }
  // undefined = not configured → allow
  if (allowedList === undefined) {
    return { allowed: true };
  }

  // boolean (visible field): false = deny, true = allow
  if (typeof allowedList === 'boolean') {
    return { allowed: allowedList, reason: allowedList ? undefined : 'visible is false' };
  }

  // string[] for read/write/adjust/visible_to
  const resolvedTokens = resolveTokenValues(allowedList, input.host_agent_ids);

  if (resolvedTokens.length === 0) {
    return { allowed: false, reason: `${input.permission_kind} allowlist is empty` };
  }

  const subjectIds = [
    input.actor_identity_id,
    input.actor_agent_id
  ].filter((id): id is string => id !== null);

  const allowed = resolvedTokens.some(id => subjectIds.includes(id));
  return {
    allowed,
    reason: allowed ? undefined : `actor not in ${input.permission_kind} allowlist`
  };
}

function applyFragmentPermissions(
  fragment: PromptFragmentV2,
  slotConfig: PromptSlotConfig | undefined,
  context: InferenceContext,
  hostAgentIds: string[]
): void {
  const defaultConfig: PromptSlotConfig = {
    id: fragment.slot_id,
    display_name: fragment.slot_id,
    default_priority: fragment.priority,
    include_in_combined: true,
    enabled: true
  };

  const baseInput: Omit<PermissionCheckInput, 'permission_kind'> = {
    slot_config: slotConfig ?? defaultConfig,
    fragment,
    actor_identity_id: context.actor_ref.identity_id,
    actor_agent_id: context.actor_ref.agent_id ?? null,
    host_agent_ids: hostAgentIds
  };

  const readResult = resolveSlotPermission({ ...baseInput, permission_kind: 'read' });
  if (!readResult.allowed) {
    fragment.permission_denied = true;
    fragment.denied_reason = readResult.reason ?? 'read denied';
  }

  const visResult = resolveSlotPermission({ ...baseInput, permission_kind: 'visibility' });
  if (!visResult.allowed) {
    fragment.permission_denied = true;
    fragment.denied_reason = fragment.denied_reason
      ? `${fragment.denied_reason}; ${visResult.reason}`
      : (visResult.reason ?? 'visibility denied');
  }

  for (const child of fragment.children) {
    if (!('kind' in child)) {
      applyFragmentPermissions(child, slotConfig, context, hostAgentIds);
    }
  }
}

export function applyPermissionFilter(tree: PromptTree, context: InferenceContext): PromptTree {
  const featureEnabled = getRuntimeConfig().features?.experimental?.prompt_slot_permissions;
  if (!featureEnabled) {
    return tree;
  }

  const hostAgentIds = getHostAgentIds(context);

  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      const slotConfig = tree.slot_registry[fragment.slot_id];
      applyFragmentPermissions(fragment, slotConfig, context, hostAgentIds);
    }
  }

  return tree;
}
