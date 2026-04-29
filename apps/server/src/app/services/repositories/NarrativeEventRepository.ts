import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../context.js';
import { createEventEvidence } from '../agent_signal_repository.js';
import type { LatestEventEvidenceRecord } from '../event_evidence_repository.js';
import { getLatestEventEvidenceRecord } from '../event_evidence_repository.js';

export type { LatestEventEvidenceRecord };

export interface NarrativeEventRepository {
  getLatestEventEvidence(): Promise<LatestEventEvidenceRecord | null>;
  createEventEvidence(input: {
    title: string;
    description: string;
    tick: bigint;
    type: 'history' | 'interaction' | 'system';
    impact_data: string;
    source_action_intent_id: string;
    created_at: bigint;
  }): Promise<unknown>;
  getWorldVariable(key: string): Promise<string | null>;
  setWorldVariable(key: string, value: string, updatedAt: bigint): Promise<void>;
  listRecentEvents(limit?: number): Promise<Array<{ id: string; title: string; description: string; tick: bigint; type: string; impact_data: string | null; source_action_intent_id: string | null; created_at: bigint }>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryEvents(input: { where?: Record<string, unknown>; orderBy?: any; take?: number; include?: Record<string, unknown> }): Promise<any[]>;
}

export class PrismaNarrativeEventRepository implements NarrativeEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ctx(): AppContext {
    return { prisma: this.prisma } as AppContext;
  }

  async getLatestEventEvidence(): Promise<LatestEventEvidenceRecord | null> {
    return getLatestEventEvidenceRecord(this.ctx());
  }

  async createEventEvidence(input: {
    title: string;
    description: string;
    tick: bigint;
    type: 'history' | 'interaction' | 'system';
    impact_data: string;
    source_action_intent_id: string;
    created_at: bigint;
  }): Promise<unknown> {
    return createEventEvidence(this.ctx(), input);
  }

  async getWorldVariable(key: string): Promise<string | null> {
    const record = await this.prisma.worldVariable.findUnique({ where: { key } });
    return record?.value ?? null;
  }

  async setWorldVariable(key: string, value: string, updatedAt: bigint): Promise<void> {
    await this.prisma.worldVariable.upsert({
      where: { key },
      create: { key, value, updated_at: updatedAt },
      update: { value, updated_at: updatedAt }
    });
  }

  async listRecentEvents(limit?: number): Promise<Array<{ id: string; title: string; description: string; tick: bigint; type: string; impact_data: string | null; source_action_intent_id: string | null; created_at: bigint }>> {
    return this.prisma.event.findMany({
      orderBy: { created_at: 'desc' },
      take: limit ?? 100
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async queryEvents(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> | Array<Record<string, unknown>>; take?: number; include?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>> {
    return this.prisma.event.findMany({
      where: input.where as never,
      orderBy: input.orderBy as never,
      take: input.take,
      include: input.include as never
    }) as Promise<Array<Record<string, unknown>>>;
  }
}
