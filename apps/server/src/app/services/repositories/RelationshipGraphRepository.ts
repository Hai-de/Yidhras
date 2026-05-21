import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../context.js';
import {
  clampSnr,
  createSnrAdjustmentLog,
  getAgentSnrTargetById,
  resolveAdjustSnrActorAgentId,
  resolveAdjustSnrPayload,
  resolveAdjustSnrTargetAgentId,
  updateAgentSnr
} from '../agent/agent_signal_repository.js';
import {
  clampRelationshipWeight,
  createRelationship,
  getRelationshipByCompositeKey,
  type RelationshipAdjustmentLogInput,
  type RelationshipRecord,
  updateRelationshipWeight,
  writeRelationshipAdjustmentLog} from '../mutation/relationship_mutation_repository.js';

export type { RelationshipAdjustmentLogInput, RelationshipRecord };

export interface RelationshipGraphRepository {
  // Relationship
  getByCompositeKey(fromId: string, toId: string, type: string): Promise<RelationshipRecord | null>;
  create(input: {
    fromId: string;
    toId: string;
    type: string;
    weight: number;
    createdAt: bigint;
    updatedAt: bigint;
  }): Promise<RelationshipRecord>;
  updateWeight(input: {
    fromId: string;
    toId: string;
    type: string;
    weight: number;
    updatedAt: bigint;
  }): Promise<RelationshipRecord>;
  writeAdjustmentLog(input: RelationshipAdjustmentLogInput): Promise<unknown>;
  clampWeight(value: number): number;

  // Agent SNR
  getSnrTarget(agentId: string): Promise<{ id: string; snr: number } | null>;
  updateSnr(agentId: string, snr: number, updatedAt: bigint): Promise<unknown>;
  createSnrAdjustmentLog(input: {
    actionIntentId: string;
    agentId: string;
    operation: string;
    requestedValue: number;
    baselineValue: number;
    resolvedValue: number;
    reason: string | null;
    createdAt: bigint;
  }): Promise<unknown>;
  clampSnr(value: number): number;
  resolveAdjustSnrActorAgentId(actorRef: unknown): string;
  resolveAdjustSnrTargetAgentId(targetRef: unknown): string;
  resolveAdjustSnrPayload(payload: unknown): {
    operation: 'set';
    target_snr: number;
    reason: string | null;
  };
  listRelationships(input?: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<Array<{ id: string; from_id: string; to_id: string; type: string; weight: number; updated_at: bigint; created_at: bigint; from?: { name: string } | null; to?: { name: string } | null }>>;
  findRelationship(where: Record<string, unknown>): Promise<{ from_id: string; to_id: string } | null>;
  listRelationshipAdjustmentLogs(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Promise<Array<{ id: string; created_at: bigint; action_intent_id: string | null; relationship_id: string; from_id: string; to_id: string; type: string; operation: string; old_weight: number | null; new_weight: number; reason: string | null }>>;
  listSnrAdjustmentLogs(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; include?: Record<string, unknown> }): Promise<Array<{ id: string; operation: string; requested_value: number; baseline_value: number; resolved_value: number; reason: string | null; created_at: bigint; action_intent_id: string | null; agent_id: string; agent?: { id: string; name: string } | null }>>;
}

export class PrismaRelationshipGraphRepository implements RelationshipGraphRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ctx(): AppContext {
    return { prisma: this.prisma } as AppContext;
  }

  // -- Relationship --

  async getByCompositeKey(
    fromId: string,
    toId: string,
    type: string
  ): Promise<RelationshipRecord | null> {
    return getRelationshipByCompositeKey(this.ctx(), { from_id: fromId, to_id: toId, type });
  }

  async create(input: {
    fromId: string;
    toId: string;
    type: string;
    weight: number;
    createdAt: bigint;
    updatedAt: bigint;
  }): Promise<RelationshipRecord> {
    return createRelationship(this.ctx(), {
      from_id: input.fromId,
      to_id: input.toId,
      type: input.type,
      weight: input.weight,
      created_at: input.createdAt,
      updated_at: input.updatedAt
    });
  }

  async updateWeight(input: {
    fromId: string;
    toId: string;
    type: string;
    weight: number;
    updatedAt: bigint;
  }): Promise<RelationshipRecord> {
    return updateRelationshipWeight(this.ctx(), {
      from_id: input.fromId,
      to_id: input.toId,
      type: input.type,
      weight: input.weight,
      updated_at: input.updatedAt
    });
  }

  async writeAdjustmentLog(input: RelationshipAdjustmentLogInput): Promise<unknown> {
    return writeRelationshipAdjustmentLog(this.ctx(), input);
  }

  clampWeight(value: number): number {
    return clampRelationshipWeight(value);
  }

  // -- Agent SNR --

  async getSnrTarget(agentId: string): Promise<{ id: string; snr: number } | null> {
    return getAgentSnrTargetById(this.ctx(), agentId);
  }

  async updateSnr(agentId: string, snr: number, updatedAt: bigint): Promise<unknown> {
    return updateAgentSnr(this.ctx(), { agent_id: agentId, snr, updated_at: updatedAt });
  }

  async createSnrAdjustmentLog(input: {
    actionIntentId: string;
    agentId: string;
    operation: string;
    requestedValue: number;
    baselineValue: number;
    resolvedValue: number;
    reason: string | null;
    createdAt: bigint;
  }): Promise<unknown> {
    return createSnrAdjustmentLog(this.ctx(), {
      action_intent_id: input.actionIntentId,
      agent_id: input.agentId,
      operation: input.operation,
      requested_value: input.requestedValue,
      baseline_value: input.baselineValue,
      resolved_value: input.resolvedValue,
      reason: input.reason,
      created_at: input.createdAt
    });
  }

  clampSnr(value: number): number {
    return clampSnr(value);
  }

  resolveAdjustSnrActorAgentId(actorRef: unknown): string {
    return resolveAdjustSnrActorAgentId(actorRef);
  }

  resolveAdjustSnrTargetAgentId(targetRef: unknown): string {
    return resolveAdjustSnrTargetAgentId(targetRef);
  }

  resolveAdjustSnrPayload(payload: unknown): {
    operation: 'set';
    target_snr: number;
    reason: string | null;
  } {
    return resolveAdjustSnrPayload(payload);
  }

  async listRelationships(input?: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<Array<{ id: string; from_id: string; to_id: string; type: string; weight: number; updated_at: bigint; created_at: bigint; from?: { name: string } | null; to?: { name: string } | null }>> {
    return this.prisma.relationship.findMany({
      where: input?.where as never,
      include: input?.include as never,
      orderBy: (input?.orderBy as never) ?? { created_at: 'asc' }
    });
  }

  async findRelationship(where: Record<string, unknown>): Promise<{ from_id: string; to_id: string } | null> {
    return this.prisma.relationship.findFirst({ where: where as never });
  }

  async listRelationshipAdjustmentLogs(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Promise<Array<{ id: string; created_at: bigint; action_intent_id: string | null; relationship_id: string; from_id: string; to_id: string; type: string; operation: string; old_weight: number | null; new_weight: number; reason: string | null }>> {
    return this.prisma.relationshipAdjustmentLog.findMany({
      where: input.where as never,
      orderBy: (input.orderBy as never) ?? { created_at: 'desc' },
      take: input.take
    });
  }

  async listSnrAdjustmentLogs(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; include?: Record<string, unknown> }): Promise<Array<{ id: string; operation: string; requested_value: number; baseline_value: number; resolved_value: number; reason: string | null; created_at: bigint; action_intent_id: string | null; agent_id: string; agent?: { id: string; name: string } | null }>> {
    return this.prisma.sNRAdjustmentLog.findMany({
      where: input.where as never,
      orderBy: (input.orderBy as never) ?? { created_at: 'desc' },
      take: input.take,
      include: input.include as never
    });
  }
}
