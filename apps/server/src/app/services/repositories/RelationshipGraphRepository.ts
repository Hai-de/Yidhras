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
} from '../agent_signal_repository.js';
import {
  clampRelationshipWeight,
  createRelationship,
  getRelationshipByCompositeKey,
  type RelationshipAdjustmentLogInput,
  type RelationshipRecord,
  updateRelationshipWeight,
  writeRelationshipAdjustmentLog} from '../relationship_mutation_repository.js';

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
  getPrisma(): PrismaClient;
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

  getPrisma(): PrismaClient { return this.prisma; }
}
