import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../context.js';

export interface AgentRepository {
  getEntityOverview(entityId: string, options?: { limit?: number }): Promise<unknown>;
  listSnrAdjustmentLogs(input: { agent_id?: string; limit?: number }): Promise<unknown[]>;
  countActiveAgents(): Promise<number>;
  findAgentById(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint } | null>;
  findAgentByIdWithCircles(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint; circle_memberships: Array<{ circle_id: string; circle: { level: number } }> } | null>;
  listAgents(orderBy?: Record<string, string>): Promise<unknown[]>;
  listAtmosphereNodes(where?: Record<string, unknown>, orderBy?: Record<string, unknown>): Promise<unknown[]>;
  listCircles(): Promise<unknown[]>;
  getPrisma(): PrismaClient;
}

export class PrismaAgentRepository implements AgentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getEntityOverview(entityId: string, options?: { limit?: number }): Promise<unknown> {
    const { getEntityOverview: impl } = await import('../agent.js');
    return impl({ prisma: this.prisma } as AppContext, entityId, options);
  }

  async listSnrAdjustmentLogs(input: {
    agent_id?: string;
    limit?: number;
  }): Promise<unknown[]> {
    const { listSnrAdjustmentLogs: impl } = await import('../agent.js');
    return impl({ prisma: this.prisma } as AppContext, input);
  }

  async countActiveAgents(): Promise<number> {
    return this.prisma.agent.count({ where: { type: 'active' } });
  }

  async findAgentById(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint } | null> {
    return this.prisma.agent.findUnique({ where: { id } }) as Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint } | null>;
  }

  async findAgentByIdWithCircles(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint; circle_memberships: Array<{ circle_id: string; circle: { level: number } }> } | null> {
    return this.prisma.agent.findUnique({
      where: { id },
      include: { circle_memberships: { include: { circle: true } } }
    }) as Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint; circle_memberships: Array<{ circle_id: string; circle: { level: number } }> } | null>;
  }

  async listAgents(orderBy?: Record<string, string>): Promise<unknown[]> {
    return this.prisma.agent.findMany({ orderBy: (orderBy as never) ?? { created_at: 'asc' } });
  }

  async listAtmosphereNodes(where?: Record<string, unknown>, orderBy?: Record<string, unknown>): Promise<unknown[]> {
    return this.prisma.atmosphereNode.findMany({
      where: where as never,
      orderBy: (orderBy as never) ?? { created_at: 'desc' }
    });
  }

  async listCircles(): Promise<unknown[]> {
    return this.prisma.circle.findMany({ include: { members: true } });
  }

  getPrisma(): PrismaClient { return this.prisma; }
}
