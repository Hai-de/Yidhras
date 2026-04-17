import { describe, expect, it } from 'vitest';

import { createPluginManagerService } from '../../src/plugins/service.js';
import type { PluginStore } from '../../src/plugins/types.js';

const createMemoryPluginStore = (): PluginStore => {
  const artifacts = new Map<string, any>();
  const installations = new Map<string, any>();
  const activations = new Map<string, any>();
  const acknowledgements = new Map<string, any>();

  return {
    async getArtifactById(artifactId) {
      return artifacts.get(artifactId) ?? null;
    },
    async getArtifactByChecksum(checksum) {
      return Array.from(artifacts.values()).find(item => item.checksum === checksum) ?? null;
    },
    async upsertArtifact(input) {
      artifacts.set(input.artifact_id, input);
      return input;
    },
    async getInstallationById(installationId) {
      return installations.get(installationId) ?? null;
    },
    async getInstallationByScope(input) {
      return Array.from(installations.values()).find(item => item.plugin_id === input.plugin_id && item.scope_type === input.scope_type && item.scope_ref === input.scope_ref) ?? null;
    },
    async listInstallationsByScope(input) {
      return Array.from(installations.values()).filter(item => item.scope_type === input.scope_type && item.scope_ref === input.scope_ref);
    },
    async upsertInstallation(input) {
      installations.set(input.installation_id, input);
      return input as any;
    },
    async createActivationSession(input) {
      activations.set(input.activation_id, input);
      return input as any;
    },
    async updateActivationSession(activationId, patch) {
      const current = activations.get(activationId);
      const next = { ...current, ...patch };
      activations.set(activationId, next);
      return next as any;
    },
    async createEnableAcknowledgement(input) {
      acknowledgements.set(input.acknowledgement_id, input);
      return input as any;
    },
    async getLatestEnableAcknowledgement(installationId) {
      return Array.from(acknowledgements.values()).find(item => item.installation_id === installationId) ?? null;
    }
  };
};

describe('plugin manager service', () => {
  it('creates pack-local installation and moves to upgrade_pending_confirmation when artifact changes', async () => {
    const store = createMemoryPluginStore();
    const service = createPluginManagerService(store);

    const artifactV1 = await service.registerArtifact({
      artifact_id: 'artifact-v1',
      plugin_id: 'plugin.alpha',
      version: '0.1.0',
      manifest_version: 'plugin/v1',
      source_type: 'bundled_by_pack',
      source_pack_id: 'world-pack-alpha',
      source_path: 'data/world_packs/alpha/plugins/plugin.alpha',
      checksum: 'sha256:v1',
      manifest_json: {},
      imported_at: '1000'
    });

    const initial = await service.ensurePackLocalInstallation({
      artifact: artifactV1,
      pack_id: 'world-pack-alpha',
      requested_capabilities: ['server.context_source.register'],
      granted_capabilities: [],
      trust_mode: 'trusted'
    });

    expect(initial.status).toBe('created');
    expect(initial.installation.lifecycle_state).toBe('pending_confirmation');

    await service.confirmInstallation({
      installation_id: initial.installation.installation_id,
      granted_capabilities: [],
      confirmed_at: '1500'
    });

    const artifactV2 = await service.registerArtifact({
      artifact_id: 'artifact-v2',
      plugin_id: 'plugin.alpha',
      version: '0.2.0',
      manifest_version: 'plugin/v1',
      source_type: 'bundled_by_pack',
      source_pack_id: 'world-pack-alpha',
      source_path: 'data/world_packs/alpha/plugins/plugin.alpha',
      checksum: 'sha256:v2',
      manifest_json: {},
      imported_at: '2000'
    });

    const upgraded = await service.ensurePackLocalInstallation({
      artifact: artifactV2,
      pack_id: 'world-pack-alpha',
      requested_capabilities: ['server.context_source.register'],
      granted_capabilities: [],
      trust_mode: 'trusted'
    });

    expect(upgraded.status).toBe('upgrade_pending_confirmation');
    expect(upgraded.installation.lifecycle_state).toBe('upgrade_pending_confirmation');
  });

  it('requires acknowledged enable flow before recording enable acknowledgement', async () => {
    const store = createMemoryPluginStore();
    const service = createPluginManagerService(store);

    await expect(
      service.recordEnableAcknowledgement({
        acknowledgement_id: 'ack-1',
        installation_id: 'installation-1',
        pack_id: 'world-pack-alpha',
        channel: 'api',
        reminder_text_hash: 'hash',
        acknowledged: false,
        created_at: '3000'
      })
    ).rejects.toMatchObject({ code: 'PLUGIN_ENABLE_ACK_REQUIRED' });
  });
});
