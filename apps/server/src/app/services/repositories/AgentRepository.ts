import type { PrismaClient } from '@prisma/client';

export interface AgentRepository {
  getEntityOverview(entityId: string, options?: { limit?: number }): Promise<unknown>;
  listSnrAdjustmentLogs(input: { agent_id?: string; limit?: number }): Promise<unknown[]>;
  countActiveAgents(): Promise<number>;
  findAgentById(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint } | null>;
  findAgentByIdWithCircles(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint; circle_memberships: Array<{ circle_id: string; circle: { level: number } }> } | null>;
  listAgents(orderBy?: Record<string, string>): Promise<Array<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint }>>;
  listAtmosphereNodes(where?: Record<string, unknown>, orderBy?: Record<string, unknown>): Promise<Array<{ id: string; name: string; owner_id: string; expires_at: bigint | null; created_at: bigint }>>;
  listCircles(): Promise<Array<{ id: string; members: unknown[] }>>;
}

export class PrismaAgentRepository implements AgentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getEntityOverview(entityId: string, options?: { limit?: number }): Promise<unknown> {
    const { getEntityOverview: impl } = await import('../agent/agent.js');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    return impl({ prisma: this.prisma } as unknown as Parameters<typeof impl>[0], entityId, options);
  }

  async listSnrAdjustmentLogs(input: {
    agent_id?: string;
    limit?: number;
  }): Promise<unknown[]> {
    const { listSnrAdjustmentLogs: impl } = await import('../agent/agent.js');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    return impl({ prisma: this.prisma } as unknown as Parameters<typeof impl>[0], input);
  }

  async countActiveAgents(): Promise<number> {
    return this.prisma.agent.count({ where: { type: 'active' } });
  }

  async findAgentById(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint } | null> {
    return this.prisma.agent.findUnique({ where: { id } });
  }

  async findAgentByIdWithCircles(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint; circle_memberships: Array<{ circle_id: string; circle: { level: number } }> } | null> {
    return this.prisma.agent.findUnique({
      where: { id },
      include: { circle_memberships: { include: { circle: true } } }
    });
  }

  async listAgents(orderBy?: Record<string, string>): Promise<Array<{ id: string; name: string; type: string; snr: number; is_pinned: boolean; created_at: bigint; updated_at: bigint }>> {
    return this.prisma.agent.findMany({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      orderBy: (orderBy as never) ?? { created_at: 'asc' }
    });
  }

  async listAtmosphereNodes(where?: Record<string, unknown>, orderBy?: Record<string, unknown>): Promise<Array<{ id: string; name: string; owner_id: string; expires_at: bigint | null; created_at: bigint }>> {
    return this.prisma.atmosphereNode.findMany({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      where: where as never,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      orderBy: (orderBy as never) ?? { created_at: 'desc' }
    });
  }

  async listCircles(): Promise<Array<{ id: string; members: unknown[] }>> {
    return this.prisma.circle.findMany({ include: { members: true } });
  }
}
