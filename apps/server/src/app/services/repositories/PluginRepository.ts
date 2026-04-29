import type { PrismaClient } from '@prisma/client';

import { createPluginStore } from '../../../plugins/store.js';
import type { PluginScopeType, PluginStore } from '../../../plugins/types.js';

export interface PluginRepository {
  getArtifactById(artifactId: string): Promise<unknown>;
  getArtifactByChecksum(checksum: string): Promise<unknown>;
  upsertArtifact(input: Record<string, unknown>): Promise<unknown>;
  getInstallationById(installationId: string): Promise<unknown>;
  getInstallationByScope(input: {
    plugin_id: string;
    scope_type: PluginScopeType;
    scope_ref?: string;
  }): Promise<unknown>;
  listInstallationsByScope(input: {
    scope_type: PluginScopeType;
    scope_ref?: string;
  }): Promise<unknown[]>;
  upsertInstallation(input: Record<string, unknown>): Promise<unknown>;
  createActivationSession(input: Record<string, unknown>): Promise<unknown>;
  updateActivationSession(activationId: string, patch: Record<string, unknown>): Promise<unknown>;
  createEnableAcknowledgement(input: Record<string, unknown>): Promise<unknown>;
  getLatestEnableAcknowledgement(installationId: string): Promise<unknown>;
  getPrisma(): PrismaClient;
}

export class PrismaPluginRepository implements PluginRepository {
  private readonly store: PluginStore;

  constructor(private readonly prisma: PrismaClient) {
    this.store = createPluginStore({ prisma });
  }

  async getArtifactById(artifactId: string): Promise<unknown> {
    return this.store.getArtifactById(artifactId);
  }

  async getArtifactByChecksum(checksum: string): Promise<unknown> {
    return this.store.getArtifactByChecksum(checksum);
  }

  async upsertArtifact(input: Record<string, unknown>): Promise<unknown> {
    return this.store.upsertArtifact(input as never);
  }

  async getInstallationById(installationId: string): Promise<unknown> {
    return this.store.getInstallationById(installationId);
  }

  async getInstallationByScope(input: {
    plugin_id: string;
    scope_type: PluginScopeType;
    scope_ref?: string;
  }): Promise<unknown> {
    return this.store.getInstallationByScope(input);
  }

  async listInstallationsByScope(input: {
    scope_type: PluginScopeType;
    scope_ref?: string;
  }): Promise<unknown[]> {
    return this.store.listInstallationsByScope(input);
  }

  async upsertInstallation(input: Record<string, unknown>): Promise<unknown> {
    return this.store.upsertInstallation(input as never);
  }

  async createActivationSession(input: Record<string, unknown>): Promise<unknown> {
    return this.store.createActivationSession(input as never);
  }

  async updateActivationSession(
    activationId: string,
    patch: Record<string, unknown>
  ): Promise<unknown> {
    return this.store.updateActivationSession(activationId, patch as never);
  }

  async createEnableAcknowledgement(input: Record<string, unknown>): Promise<unknown> {
    return this.store.createEnableAcknowledgement(input as never);
  }

  async getLatestEnableAcknowledgement(installationId: string): Promise<unknown> {
    return this.store.getLatestEnableAcknowledgement(installationId);
  }

  getPrisma(): PrismaClient { return this.prisma; }
}
