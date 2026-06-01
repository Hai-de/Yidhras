import { Prisma, type PrismaClient } from '@prisma/client';

import type { IdentityContext } from '../../../identity/types.js';
import type { DataContext } from '../../context/data_context.js';
import type {
  CreateIdentityBindingInput,
  IdentityServiceDependencies,
  QueryIdentityBindingsInput,
  RegisterIdentityInput
} from '../identity/identity.js';
import {
  createIdentityBinding,
  expireIdentityBinding,
  queryIdentityBindings,
  registerIdentity,
  unbindIdentityBinding
} from '../identity/identity.js';
import {
  createAgentBinding,
  listAgentOperators,
  unbindAgent
} from '../operator/operator_agent_bindings.js';
import {
  createOperatorGrant,
  listOperatorGrants,
  revokeOperatorGrant
} from '../operator/operator_grants.js';
import {
  createPackBinding,
  listMyPackBindings,
  listPackBindings,
  removePackBinding,
  updatePackBinding
} from '../operator/operator_pack_bindings.js';

export interface IdentityOperatorRepository {
  // -- Identity (existing delegates) --
  registerIdentity(input: RegisterIdentityInput): Promise<unknown>;
  createIdentity(input: Prisma.IdentityUncheckedCreateInput): Promise<{ id: string }>;
  createIdentityBinding(input: CreateIdentityBindingInput, deps: IdentityServiceDependencies): Promise<unknown>;
  queryIdentityBindings(input: QueryIdentityBindingsInput): Promise<unknown>;
  unbindIdentityBinding(input: { binding_id?: string; status?: string }): Promise<unknown>;
  expireIdentityBinding(input: { binding_id?: string }): Promise<unknown>;
  findIdentityById(id: string): Promise<IdentityContext | null>;

  // -- Operator --
  findOperatorById(id: string): Promise<{ id: string; username: string; password_hash: string; identity_id: string; is_root: boolean; status: string; display_name: string | null; created_at: bigint; updated_at: bigint; pack_bindings?: unknown[] } | null>;
  getOperatorDetail(id: string): Promise<{ id: string; username: string; password_hash: string; identity_id: string; is_root: boolean; status: string; display_name: string | null; created_at: bigint; updated_at: bigint; pack_bindings: Array<{ pack_id: string; binding_type: string; bound_at: bigint }> } | null>;
  findOperatorByUsername(username: string): Promise<{ id: string; username: string } | null>;
  listOperators(): Promise<unknown>;
  createOperatorRecord(input: Prisma.OperatorUncheckedCreateInput): Promise<{ id: string }>;
  updateOperator(id: string, data: Prisma.OperatorUncheckedUpdateInput): Promise<unknown>;

  // -- Operator Pack Bindings (existing delegates + new direct) --
  createPackBinding(packId: string, operatorId: string, bindingType: string, boundByOperatorId?: string, clientIp?: string): Promise<unknown>;
  listPackBindings(packId: string): Promise<unknown>;
  findPackBinding(operatorId: string, packId: string): Promise<{ binding_type: string } | null>;
  updatePackBinding(packId: string, targetOperatorId: string, bindingType: string, updatedByOperatorId?: string, clientIp?: string): Promise<unknown>;
  removePackBinding(packId: string, targetOperatorId: string, removedByOperatorId?: string, clientIp?: string): Promise<{ removed: boolean }>;
  listMyPackBindings(operatorId: string): Promise<unknown>;
  getOperatorPackIds(operatorId: string): Promise<string[]>;

  // -- Operator Grants (existing delegates + new direct) --
  createOperatorGrant(packId: string, giverOperatorId: string, receiverIdentityId: string, capabilityKey: string, options?: { scope_json?: Record<string, unknown>; revocable?: boolean; expires_at?: bigint | null }, clientIp?: string): Promise<unknown>;
  listOperatorGrants(packId: string, giverOperatorId: string): Promise<unknown>;
  findGrantById(id: string): Promise<unknown>;
  deleteGrant(id: string): Promise<unknown>;
  revokeOperatorGrant(grantId: string, operatorId: string, clientIp?: string): Promise<{ revoked: boolean }>;

  // -- Operator Agent Bindings (existing delegates + new direct) --
  createAgentBinding(agentId: string, operatorIdentityId: string, role: string, boundByOperatorId?: string, clientIp?: string): Promise<unknown>;
  unbindAgent(agentId: string, operatorIdentityId: string, operatorId?: string, clientIp?: string): Promise<{ unbound: boolean }>;
  listAgentOperators(agentId: string): Promise<unknown>;

  // -- Identity Node Binding (direct Prisma) --
  findBindingByAgentAndIdentity(agentId: string, identityId: string): Promise<unknown>;
  findDefaultBindingForIdentity(identityId: string): Promise<{ agent_id: string | null } | null>;
  findOperatorBindingForAgent(agentId: string): Promise<{ identity: { id: string; type: string } | null } | null>;
  findBindingById(id: string): Promise<unknown>;
  updateBinding(id: string, data: Prisma.IdentityNodeBindingUncheckedUpdateInput): Promise<unknown>;
  expireBindings(now: bigint): Promise<{ count: number }>;

  // -- Operator Session (direct Prisma) --
  createSession(input: Prisma.OperatorSessionUncheckedCreateInput): Promise<unknown>;
  findSessionByTokenHash(tokenHash: string, now?: bigint): Promise<{ operator_id: string; pack_id: string | null } | null>;
  deleteSessionsByTokenHash(tokenHash: string): Promise<{ count: number }>;

  // -- Operator Audit Log (direct Prisma) --
  listAuditLogs(input: { operator_id?: string; pack_id?: string; action?: string; limit?: number; cursor?: string }): Promise<unknown[]>;
  createAuditLog(input: { operator_id?: string | null; pack_id?: string | null; action: string; target_id?: string | null; detail_json?: unknown; client_ip?: string | null; created_at: bigint }): Promise<unknown>;

  // -- Additional query methods (replacing getPrisma access) --
  findOperatorGrant(input: { receiver_identity_id: string; pack_id: string; capability_key: string; now: bigint }): Promise<{ id: string } | null>;
  listIdentityBindings(input: { where?: Prisma.IdentityNodeBindingWhereInput; include?: Prisma.IdentityNodeBindingInclude; orderBy?: Prisma.IdentityNodeBindingOrderByWithRelationInput; select?: Prisma.IdentityNodeBindingSelect }): Promise<Array<{ id: string; role: string; status: string; atmosphere_node_id: string | null; expires_at: bigint | null; identity?: { id: string; type: string; name: string | null } | null; agent_id?: string | null; atmosphere_node?: { id: string; name: string } | null }>>;
  findActiveBindingForAgent(agentId: string): Promise<{ id: string; role: string; status: string; agent_id: string | null; atmosphere_node_id: string | null; identity: { id: string; type: string; name: string | null; provider: string | null; status: string; claims: unknown } | null } | null>;
  listPolicies(where: Prisma.PolicyWhereInput): Promise<Array<{ id: string; effect: string; subject_id: string | null; subject_type: string | null; resource: string; action: string; field: string; conditions: unknown; priority: number; created_at: bigint; updated_at: bigint }>>;
  createPolicy(data: Prisma.PolicyUncheckedCreateInput): Promise<unknown>;
}

export class PrismaIdentityOperatorRepository implements IdentityOperatorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ctx() {
    return { prisma: this.prisma };
  }

  // -- Identity (delegates) --

  async registerIdentity(input: RegisterIdentityInput): Promise<unknown> {
    return registerIdentity(this.ctx(), input);
  }

  async createIdentity(input: Prisma.IdentityUncheckedCreateInput): Promise<{ id: string }> {
    return this.prisma.identity.create({ data: input, select: { id: true } });
  }

  async createIdentityBinding(input: CreateIdentityBindingInput, deps: IdentityServiceDependencies): Promise<unknown> {
    return createIdentityBinding(this.ctx(), input, deps);
  }

  async queryIdentityBindings(input: QueryIdentityBindingsInput): Promise<unknown> {
    return queryIdentityBindings(this.ctx(), input);
  }

  async unbindIdentityBinding(input: { binding_id?: string; status?: string }): Promise<unknown> {
    return unbindIdentityBinding(this.ctx(), input);
  }

  async expireIdentityBinding(input: { binding_id?: string }): Promise<unknown> {
    return expireIdentityBinding(this.ctx(), input);
  }

  async findIdentityById(id: string): Promise<IdentityContext | null> {
    const identity = await this.prisma.identity.findUnique({ where: { id } });
    if (!identity) return null;
    return {
      id: identity.id,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      type: identity.type as IdentityContext['type'],
      name: identity.name,
      provider: identity.provider,
      status: identity.status,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma JSON column
      claims: identity.claims as Record<string, unknown> | null
    };
  }

  // -- Operator (direct Prisma) --

  async findOperatorById(id: string): Promise<{ id: string; username: string; password_hash: string; identity_id: string; is_root: boolean; status: string; display_name: string | null; created_at: bigint; updated_at: bigint; pack_bindings?: unknown[] } | null> {
    return this.prisma.operator.findUnique({ where: { id } });
  }

  async getOperatorDetail(id: string): Promise<{ id: string; username: string; password_hash: string; identity_id: string; is_root: boolean; status: string; display_name: string | null; created_at: bigint; updated_at: bigint; pack_bindings: Array<{ pack_id: string; binding_type: string; bound_at: bigint }> } | null> {
    return this.prisma.operator.findUnique({ where: { id }, include: { pack_bindings: true } });
  }

  async findOperatorByUsername(username: string): Promise<{ id: string; username: string } | null> {
    return this.prisma.operator.findUnique({ where: { username }, select: { id: true, username: true } });
  }

  async listOperators(): Promise<unknown> {
    return this.prisma.operator.findMany({
      orderBy: { created_at: 'desc' },
      select: { id: true, username: true, display_name: true, is_root: true, status: true, created_at: true, updated_at: true }
    });
  }

  async createOperatorRecord(input: Prisma.OperatorUncheckedCreateInput): Promise<{ id: string }> {
    return this.prisma.operator.create({ data: input, select: { id: true } });
  }

  async updateOperator(id: string, data: Prisma.OperatorUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.operator.update({ where: { id }, data });
  }

  // -- Operator Pack Bindings (mix of delegates and direct) --

  async createPackBinding(packId: string, operatorId: string, bindingType: string, boundByOperatorId?: string, clientIp?: string): Promise<unknown> {
    return createPackBinding(this.ctx(), packId, operatorId, bindingType, boundByOperatorId, clientIp);
  }

  async listPackBindings(packId: string): Promise<unknown> {
    return listPackBindings(this.ctx(), packId);
  }

  async findPackBinding(operatorId: string, packId: string): Promise<{ binding_type: string } | null> {
    return this.prisma.operatorPackBinding.findUnique({
      where: { operator_id_pack_id: { operator_id: operatorId, pack_id: packId } },
      select: { binding_type: true }
    });
  }

  async updatePackBinding(packId: string, targetOperatorId: string, bindingType: string, updatedByOperatorId?: string, clientIp?: string): Promise<unknown> {
    return updatePackBinding(this.ctx(), packId, targetOperatorId, bindingType, updatedByOperatorId, clientIp);
  }

  async removePackBinding(packId: string, targetOperatorId: string, removedByOperatorId?: string, clientIp?: string): Promise<{ removed: boolean }> {
    return removePackBinding(this.ctx(), packId, targetOperatorId, removedByOperatorId, clientIp);
  }

  async listMyPackBindings(operatorId: string): Promise<unknown> {
    return listMyPackBindings(this.ctx(), operatorId);
  }

  async getOperatorPackIds(operatorId: string): Promise<string[]> {
    const bindings = await this.prisma.operatorPackBinding.findMany({
      where: { operator_id: operatorId },
      select: { pack_id: true }
    });
    return bindings.map(b => b.pack_id);
  }

  // -- Operator Grants (mix of delegates and direct) --

  async createOperatorGrant(packId: string, giverOperatorId: string, receiverIdentityId: string, capabilityKey: string, options?: { scope_json?: Record<string, unknown>; revocable?: boolean; expires_at?: bigint | null }, clientIp?: string): Promise<unknown> {
    return createOperatorGrant(this.ctx(), packId, giverOperatorId, receiverIdentityId, capabilityKey, options, clientIp);
  }

  async listOperatorGrants(packId: string, giverOperatorId: string): Promise<unknown> {
    return listOperatorGrants(this.ctx(), packId, giverOperatorId);
  }

  async findGrantById(id: string): Promise<unknown> {
    return this.prisma.operatorGrant.findUnique({ where: { id } });
  }

  async deleteGrant(id: string): Promise<unknown> {
    return this.prisma.operatorGrant.delete({ where: { id } });
  }

  async revokeOperatorGrant(grantId: string, operatorId: string, clientIp?: string): Promise<{ revoked: boolean }> {
    return revokeOperatorGrant(this.ctx(), grantId, operatorId, clientIp);
  }

  // -- Operator Agent Bindings (delegates) --

  async createAgentBinding(agentId: string, operatorIdentityId: string, role: string, boundByOperatorId?: string, clientIp?: string): Promise<unknown> {
    return createAgentBinding(this.ctx(), agentId, operatorIdentityId, role, boundByOperatorId, clientIp);
  }

  async unbindAgent(agentId: string, operatorIdentityId: string, operatorId?: string, clientIp?: string): Promise<{ unbound: boolean }> {
    return unbindAgent(this.ctx(), agentId, operatorIdentityId, operatorId, clientIp);
  }

  async listAgentOperators(agentId: string): Promise<unknown> {
    return listAgentOperators(this.ctx(), agentId);
  }

  // -- Identity Node Binding (direct Prisma) --

  async findBindingByAgentAndIdentity(agentId: string, identityId: string): Promise<unknown> {
    return this.prisma.identityNodeBinding.findFirst({
      where: { agent_id: agentId, identity_id: identityId, status: 'active' }
    });
  }

  async findDefaultBindingForIdentity(identityId: string): Promise<{ agent_id: string | null } | null> {
    return this.prisma.identityNodeBinding.findFirst({
      where: { identity_id: identityId, status: 'active', agent_id: { not: null } },
      orderBy: { created_at: 'asc' },
      select: { agent_id: true }
    });
  }

  async findOperatorBindingForAgent(agentId: string): Promise<{ identity: { id: string; type: string } | null } | null> {
    return this.prisma.identityNodeBinding.findFirst({
      where: { agent_id: agentId, role: 'active', status: 'active' },
      include: { identity: { select: { id: true, type: true } } }
    });
  }

  async findBindingById(id: string): Promise<unknown> {
    return this.prisma.identityNodeBinding.findUnique({ where: { id } });
  }

  async updateBinding(id: string, data: Prisma.IdentityNodeBindingUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.identityNodeBinding.update({ where: { id }, data });
  }

  async expireBindings(now: bigint): Promise<{ count: number }> {
    return this.prisma.identityNodeBinding.updateMany({
      where: {
        AND: [
          { expires_at: { not: null } },
          { expires_at: { lte: now } },
          { status: { not: 'expired' } }
        ]
      },
      data: { status: 'expired', updated_at: now }
    });
  }

  // -- Operator Session (direct Prisma) --

  async createSession(input: Prisma.OperatorSessionUncheckedCreateInput): Promise<unknown> {
    return this.prisma.operatorSession.create({ data: input });
  }

  async findSessionByTokenHash(tokenHash: string, now?: bigint): Promise<{ operator_id: string; pack_id: string | null } | null> {
    const nowTick = now ?? BigInt(Date.now());
    return this.prisma.operatorSession.findFirst({
      where: { token_hash: tokenHash, expires_at: { gt: nowTick } },
      select: { operator_id: true, pack_id: true }
    });
  }

  async deleteSessionsByTokenHash(tokenHash: string): Promise<{ count: number }> {
    return this.prisma.operatorSession.deleteMany({ where: { token_hash: tokenHash } });
  }

  // -- Operator Audit Log (direct Prisma) --

  async listAuditLogs(input: { operator_id?: string; pack_id?: string; action?: string; limit?: number; cursor?: string }): Promise<unknown[]> {
    const where: Prisma.OperatorAuditLogWhereInput = {};
    if (input.operator_id) where.operator_id = input.operator_id;
    if (input.pack_id) where.pack_id = input.pack_id;
    if (input.action) where.action = input.action;
    return this.prisma.operatorAuditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: (input.limit ?? 20) + 1
    });
  }

  async createAuditLog(input: { operator_id?: string | null; pack_id?: string | null; action: string; target_id?: string | null; detail_json?: unknown; client_ip?: string | null; created_at: bigint }): Promise<unknown> {
    return this.prisma.operatorAuditLog.create({
      data: {
        operator_id: input.operator_id ?? null,
        pack_id: input.pack_id ?? null,
        action: input.action,
        target_id: input.target_id ?? null,
        detail_json: input.detail_json === undefined || input.detail_json === null
          ? Prisma.JsonNull
          : (input.detail_json as Prisma.InputJsonValue),
        client_ip: input.client_ip ?? null,
        created_at: input.created_at
      }
    });
  }

  // -- Additional query methods --

  async findOperatorGrant(input: { receiver_identity_id: string; pack_id: string; capability_key: string; now: bigint }): Promise<{ id: string } | null> {
    return this.prisma.operatorGrant.findFirst({
      where: {
        receiver_identity_id: input.receiver_identity_id,
        pack_id: input.pack_id,
        capability_key: input.capability_key,
        OR: [
          { expires_at: null },
          { expires_at: { gt: input.now } }
        ]
      },
      orderBy: { created_at: 'desc' },
      select: { id: true }
    });
  }

  async listIdentityBindings(input: { where?: Prisma.IdentityNodeBindingWhereInput; include?: Prisma.IdentityNodeBindingInclude; orderBy?: Prisma.IdentityNodeBindingOrderByWithRelationInput; select?: Prisma.IdentityNodeBindingSelect }): Promise<Array<{ id: string; role: string; status: string; atmosphere_node_id: string | null; expires_at: bigint | null; identity?: { id: string; type: string; name: string | null } | null; agent_id?: string | null; atmosphere_node?: { id: string; name: string } | null }>> {
    if (input.select) {
// @ts-expect-error -- EOPT strict mode
      return this.prisma.identityNodeBinding.findMany({
        where: input.where,
        orderBy: input.orderBy,
        select: input.select
      });
    }
// @ts-expect-error -- EOPT strict mode
    return this.prisma.identityNodeBinding.findMany({
      where: input.where,
      orderBy: input.orderBy,
      include: input.include
    });
  }

  async findActiveBindingForAgent(agentId: string): Promise<{ id: string; role: string; status: string; agent_id: string | null; atmosphere_node_id: string | null; identity: { id: string; type: string; name: string | null; provider: string | null; status: string; claims: unknown } | null } | null> {
    return this.prisma.identityNodeBinding.findFirst({
      where: { agent_id: agentId, role: 'active', status: 'active' },
      include: { identity: true }
    });
  }

  async listPolicies(where: Prisma.PolicyWhereInput): Promise<Array<{ id: string; effect: string; subject_id: string | null; subject_type: string | null; resource: string; action: string; field: string; conditions: unknown; priority: number; created_at: bigint; updated_at: bigint }>> {
    return this.prisma.policy.findMany({ where });
  }

  async createPolicy(data: Prisma.PolicyUncheckedCreateInput): Promise<unknown> {
    return this.prisma.policy.create({ data });
  }
}
