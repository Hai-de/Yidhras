import type { PrismaClient } from '@prisma/client';
import type {
  PluginActivationSession,
  PluginArtifact,
  PluginEnableAcknowledgement,
  PluginInstallation
} from '@yidhras/contracts';

import { createPluginStore } from '../../../plugins/store.js';
import type {
  PluginActivationSessionCreateInput,
  PluginEnableAcknowledgementCreateInput,
  PluginInstallationUpsertInput,
  PluginScopeType,
  PluginStore
} from '../../../plugins/types.js';

export interface PluginRepository {
  getArtifactById(artifactId: string): Promise<PluginArtifact | null>;
  getArtifactByChecksum(checksum: string): Promise<PluginArtifact | null>;
  upsertArtifact(input: PluginArtifact): Promise<PluginArtifact>;
  getInstallationById(installationId: string): Promise<PluginInstallation | null>;
  getInstallationByScope(input: {
    plugin_id: string;
    scope_type: PluginScopeType;
    scope_ref?: string | undefined;
  }): Promise<PluginInstallation | null>;
  listInstallationsByScope(input: {
    scope_type: PluginScopeType;
    scope_ref?: string | undefined;
  }): Promise<PluginInstallation[]>;
  upsertInstallation(input: PluginInstallationUpsertInput): Promise<PluginInstallation>;
  createActivationSession(input: PluginActivationSessionCreateInput): Promise<PluginActivationSession>;
  updateActivationSession(
    activationId: string,
    patch: Partial<Pick<PluginActivationSession, 'result' | 'finished_at' | 'loaded_server' | 'loaded_web_manifest' | 'error_message'>>
  ): Promise<PluginActivationSession>;
  createEnableAcknowledgement(input: PluginEnableAcknowledgementCreateInput): Promise<PluginEnableAcknowledgement>;
  getLatestEnableAcknowledgement(installationId: string): Promise<PluginEnableAcknowledgement | null>;
}

export class PrismaPluginRepository implements PluginRepository {
  private readonly store: PluginStore;

  constructor(private readonly prisma: PrismaClient) {
    this.store = createPluginStore({ prisma });
  }

  async getArtifactById(artifactId: string): Promise<PluginArtifact | null> {
    return this.store.getArtifactById(artifactId);
  }

  async getArtifactByChecksum(checksum: string): Promise<PluginArtifact | null> {
    return this.store.getArtifactByChecksum(checksum);
  }

  async upsertArtifact(input: PluginArtifact): Promise<PluginArtifact> {
    return this.store.upsertArtifact(input);
  }

  async getInstallationById(installationId: string): Promise<PluginInstallation | null> {
    return this.store.getInstallationById(installationId);
  }

  async getInstallationByScope(input: {
    plugin_id: string;
    scope_type: PluginScopeType;
    scope_ref?: string;
  }): Promise<PluginInstallation | null> {
    return this.store.getInstallationByScope(input);
  }

  async listInstallationsByScope(input: {
    scope_type: PluginScopeType;
    scope_ref?: string;
  }): Promise<PluginInstallation[]> {
    return this.store.listInstallationsByScope(input);
  }

  async upsertInstallation(input: PluginInstallationUpsertInput): Promise<PluginInstallation> {
    return this.store.upsertInstallation(input);
  }

  async createActivationSession(input: PluginActivationSessionCreateInput): Promise<PluginActivationSession> {
    return this.store.createActivationSession(input);
  }

  async updateActivationSession(
    activationId: string,
    patch: Partial<Pick<PluginActivationSession, 'result' | 'finished_at' | 'loaded_server' | 'loaded_web_manifest' | 'error_message'>>
  ): Promise<PluginActivationSession> {
    return this.store.updateActivationSession(activationId, patch);
  }

  async createEnableAcknowledgement(input: PluginEnableAcknowledgementCreateInput): Promise<PluginEnableAcknowledgement> {
    return this.store.createEnableAcknowledgement(input);
  }

  async getLatestEnableAcknowledgement(installationId: string): Promise<PluginEnableAcknowledgement | null> {
    return this.store.getLatestEnableAcknowledgement(installationId);
  }
}
