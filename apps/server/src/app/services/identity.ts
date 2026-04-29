import type { Prisma } from '@prisma/client';

import { IdentityBindingRole, IdentityBindingStatus } from '../../identity/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

const bindingRoles: IdentityBindingRole[] = ['active', 'atmosphere'];
const bindingStatuses: IdentityBindingStatus[] = ['active', 'inactive', 'expired'];

export interface RegisterIdentityInput {
  id?: string;
  type?: string;
  name?: string;
  claims?: unknown;
  metadata?: unknown;
}

export interface CreateIdentityBindingInput {
  identity_id?: string;
  agent_id?: string;
  atmosphere_node_id?: string;
  role?: string;
  status?: string;
  expires_at?: unknown;
}

export interface QueryIdentityBindingsInput {
  identity_id?: string;
  role?: string;
  status?: string;
  include_expired?: boolean;
  agent_id?: string;
  atmosphere_node_id?: string;
}

export interface UnbindIdentityBindingInput {
  binding_id?: string;
  status?: string;
}

export interface ExpireIdentityBindingInput {
  binding_id?: string;
}

export interface IdentityServiceDependencies {
  parseOptionalTick(value: unknown, fieldName: string): bigint | null;
}

export const registerIdentity = async (
  context: AppContext,
  input: RegisterIdentityInput
) => {
  const { id, type, name, claims, metadata } = input;

  if (!id || !type) {
    throw new ApiError(400, 'IDENTITY_INVALID', 'id and type are required');
  }

  const now = context.clock.getCurrentTick();
  return context.prisma.identity.create({
    data: {
      id,
      type,
      name,
      provider: 'm2',
      status: 'active',
      claims: claims ?? undefined,
      metadata: metadata ?? undefined,
      created_at: now,
      updated_at: now
    }
  });
};

export const createIdentityBinding = async (
  context: AppContext,
  input: CreateIdentityBindingInput,
  deps: IdentityServiceDependencies
) => {
  const { identity_id, agent_id, atmosphere_node_id, role, status, expires_at } = input;

  if (!identity_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'identity_id is required');
  }

  if (!role || !bindingRoles.includes(role as IdentityBindingRole)) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'role must be active or atmosphere');
  }

  const hasAgent = typeof agent_id === 'string' && agent_id.trim().length > 0;
  const hasAtmosphere = typeof atmosphere_node_id === 'string' && atmosphere_node_id.trim().length > 0;

  if (hasAgent === hasAtmosphere) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'Provide exactly one of agent_id or atmosphere_node_id');
  }

  const normalizedStatus = (status ?? 'active');
  if (!bindingStatuses.includes(normalizedStatus as IdentityBindingStatus)) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'status must be active, inactive, or expired');
  }

  if (normalizedStatus === 'active') {
    const existingActive = await context.prisma.identityNodeBinding.findFirst({
      where: {
        identity_id,
        role: role as IdentityBindingRole,
        status: 'active'
      }
    });
    if (existingActive) {
      throw new ApiError(409, 'IDENTITY_BINDING_CONFLICT', 'Active binding already exists', {
        identity_id,
        role,
        binding_id: existingActive.id
      });
    }
  }

  const expiresAt = deps.parseOptionalTick(expires_at, 'expires_at');
  const now = context.clock.getCurrentTick();

  return context.prisma.identityNodeBinding.create({
    data: {
      identity_id,
      agent_id: hasAgent ? agent_id : null,
      atmosphere_node_id: hasAtmosphere ? atmosphere_node_id : null,
      role: role as IdentityBindingRole,
      status: normalizedStatus as IdentityBindingStatus,
      expires_at: expiresAt ?? undefined,
      created_at: now,
      updated_at: now
    }
  });
};

export const queryIdentityBindings = async (
  context: AppContext,
  input: QueryIdentityBindingsInput
) => {
  const { identity_id, role, status, include_expired, agent_id, atmosphere_node_id } = input;

  if (!identity_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'identity_id is required');
  }

  const hasAgentFilter = typeof agent_id === 'string' && agent_id.trim().length > 0;
  const hasAtmosphereFilter = typeof atmosphere_node_id === 'string' && atmosphere_node_id.trim().length > 0;
  if (hasAgentFilter && hasAtmosphereFilter) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'Provide only one of agent_id or atmosphere_node_id');
  }

  const where: Prisma.IdentityNodeBindingWhereInput = {
    identity_id
  };

  if (role) {
    if (!bindingRoles.includes(role as IdentityBindingRole)) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'role must be active or atmosphere');
    }
    where.role = role as IdentityBindingRole;
  }

  if (status) {
    if (!bindingStatuses.includes(status as IdentityBindingStatus)) {
      throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'status must be active, inactive, or expired');
    }
    where.status = status as IdentityBindingStatus;
  } else if (!include_expired) {
    where.status = { not: 'expired' };
  }

  if (hasAgentFilter) {
    where.agent_id = agent_id;
  }
  if (hasAtmosphereFilter) {
    where.atmosphere_node_id = atmosphere_node_id;
  }

  return context.prisma.identityNodeBinding.findMany({
    where,
    orderBy: { created_at: 'desc' }
  });
};

export const unbindIdentityBinding = async (
  context: AppContext,
  input: UnbindIdentityBindingInput
) => {
  const { binding_id, status } = input;

  if (!binding_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'binding_id is required');
  }

  const existing = await context.prisma.identityNodeBinding.findUnique({
    where: { id: binding_id }
  });
  if (!existing) {
    throw new ApiError(404, 'IDENTITY_BINDING_NOT_FOUND', 'Binding not found', { binding_id });
  }

  if (status && !bindingStatuses.includes(status as IdentityBindingStatus)) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'status must be active, inactive, or expired');
  }

  const now = context.clock.getCurrentTick();
  return context.prisma.identityNodeBinding.update({
    where: { id: binding_id },
    data: {
      status: (status ?? 'inactive') as IdentityBindingStatus,
      updated_at: now
    }
  });
};

export const expireIdentityBinding = async (
  context: AppContext,
  input: ExpireIdentityBindingInput
) => {
  const { binding_id } = input;

  if (!binding_id) {
    throw new ApiError(400, 'IDENTITY_BINDING_INVALID', 'binding_id is required');
  }

  const existing = await context.prisma.identityNodeBinding.findUnique({
    where: { id: binding_id }
  });
  if (!existing) {
    throw new ApiError(404, 'IDENTITY_BINDING_NOT_FOUND', 'Binding not found', { binding_id });
  }

  const now = context.clock.getCurrentTick();
  return context.prisma.identityNodeBinding.update({
    where: { id: binding_id },
    data: {
      status: 'expired',
      expires_at: now,
      updated_at: now
    }
  });
};
