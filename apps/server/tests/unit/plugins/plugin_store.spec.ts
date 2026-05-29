import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { createPluginStore } from '../../../src/plugins/store.js';

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    pluginArtifact: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    pluginInstallation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn()
    },
    pluginActivationSession: {
      create: vi.fn(),
      update: vi.fn()
    },
    pluginEnableAcknowledgement: {
      create: vi.fn(),
      findFirst: vi.fn()
    },
    ...overrides
  } as unknown as PrismaClient;
}

function makeArtifactRow(overrides: Record<string, unknown> = {}) {
  return {
    artifact_id: 'art-1',
    plugin_id: 'plugin-1',
    version: '1.0.0',
    manifest_version: 'plugin/v1',
    source_type: 'bundled_by_pack',
    source_pack_id: 'pack-1',
    source_path: '/plugins/my-plugin',
    checksum: 'abc123',
    manifest_json: { id: 'plugin-1', version: '1.0.0' },
    imported_at: 1000n,
    ...overrides
  };
}

function makeInstallationRow(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: 'inst-1',
    plugin_id: 'plugin-1',
    artifact_id: 'art-1',
    version: '1.0.0',
    scope_type: 'pack_local',
    scope_ref: 'pack-1',
    lifecycle_state: 'enabled',
    requested_capabilities: '["cap1"]',
    granted_capabilities: '["cap1"]',
    trust_mode: 'trusted',
    confirmed_at: 2000n,
    enabled_at: 3000n,
    disabled_at: null,
    last_error: null,
    ...overrides
  };
}

function makeActivationRow(overrides: Record<string, unknown> = {}) {
  return {
    activation_id: 'act-1',
    installation_id: 'inst-1',
    pack_id: 'pack-1',
    channel: 'startup_restore',
    result: 'success',
    started_at: 1000n,
    finished_at: 2000n,
    loaded_server: true,
    loaded_web_manifest: false,
    error_message: null,
    ...overrides
  };
}

function makeAcknowledgementRow(overrides: Record<string, unknown> = {}) {
  return {
    acknowledgement_id: 'ack-1',
    installation_id: 'inst-1',
    pack_id: 'pack-1',
    channel: 'cli',
    reminder_text_hash: 'hash-1',
    acknowledged: true,
    actor_id: 'actor-1',
    actor_label: 'Admin',
    created_at: 5000n,
    ...overrides
  };
}

describe('plugins/plugin_store', () => {
  describe('createPluginStore', () => {
    describe('getArtifactById', () => {
      it('should return null when artifact not found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginArtifact.findUnique.mockResolvedValue(null);
        const store = createPluginStore({ prisma });
        const result = await store.getArtifactById('nonexistent');
        expect(result).toBeNull();
      });

      it('should return parsed artifact when found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginArtifact.findUnique.mockResolvedValue(makeArtifactRow());
        const store = createPluginStore({ prisma });
        const result = await store.getArtifactById('art-1');
        expect(result).toBeDefined();
        expect(result!.artifact_id).toBe('art-1');
        expect(result!.plugin_id).toBe('plugin-1');
        expect(result!.version).toBe('1.0.0');
      });
    });

    describe('getArtifactByChecksum', () => {
      it('should return null when not found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginArtifact.findUnique.mockResolvedValue(null);
        const store = createPluginStore({ prisma });
        const result = await store.getArtifactByChecksum('no-match');
        expect(result).toBeNull();
      });

      it('should query by checksum', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginArtifact.findUnique.mockResolvedValue(makeArtifactRow());
        const store = createPluginStore({ prisma });
        await store.getArtifactByChecksum('abc123');
        expect(prisma.pluginArtifact.findUnique).toHaveBeenCalledWith({
          where: { checksum: 'abc123' }
        });
      });
    });

    describe('upsertArtifact', () => {
      it('should upsert and return parsed artifact', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginArtifact.upsert.mockResolvedValue(makeArtifactRow());
        const store = createPluginStore({ prisma });
        const result = await store.upsertArtifact({
          artifact_id: 'art-1',
          plugin_id: 'plugin-1',
          version: '1.0.0',
          manifest_version: 'plugin/v1',
          source_type: 'bundled_by_pack',
          source_path: '/plugins/my-plugin',
          checksum: 'abc123',
          manifest_json: { id: 'plugin-1' },
          imported_at: '1000'
        });
        expect(result).toBeDefined();
        expect(prisma.pluginArtifact.upsert).toHaveBeenCalledOnce();
      });
    });

    describe('getInstallationById', () => {
      it('should return null when not found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.findUnique.mockResolvedValue(null);
        const store = createPluginStore({ prisma });
        const result = await store.getInstallationById('nonexistent');
        expect(result).toBeNull();
      });

      it('should return parsed installation when found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.findUnique.mockResolvedValue(makeInstallationRow());
        const store = createPluginStore({ prisma });
        const result = await store.getInstallationById('inst-1');
        expect(result).toBeDefined();
        expect(result!.installation_id).toBe('inst-1');
        expect(result!.requested_capabilities).toEqual(['cap1']);
        expect(result!.lifecycle_state).toBe('enabled');
      });
    });

    describe('getInstallationByScope', () => {
      it('should return null when not found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.findFirst.mockResolvedValue(null);
        const store = createPluginStore({ prisma });
        const result = await store.getInstallationByScope({
          plugin_id: 'plugin-1',
          scope_type: 'pack_local',
          scope_ref: 'pack-1'
        });
        expect(result).toBeNull();
      });

      it('should query by scope', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.findFirst.mockResolvedValue(makeInstallationRow());
        const store = createPluginStore({ prisma });
        await store.getInstallationByScope({
          plugin_id: 'plugin-1',
          scope_type: 'pack_local',
          scope_ref: 'pack-1'
        });
        expect(prisma.pluginInstallation.findFirst).toHaveBeenCalledWith({
          where: {
            plugin_id: 'plugin-1',
            scope_type: 'pack_local',
            scope_ref: 'pack-1'
          }
        });
      });
    });

    describe('listInstallationsByScope', () => {
      it('should return empty array when no installations', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.findMany.mockResolvedValue([]);
        const store = createPluginStore({ prisma });
        const result = await store.listInstallationsByScope({
          scope_type: 'pack_local',
          scope_ref: 'pack-1'
        });
        expect(result).toEqual([]);
      });

      it('should return parsed installations', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.findMany.mockResolvedValue([
          makeInstallationRow({ installation_id: 'inst-1' }),
          makeInstallationRow({ installation_id: 'inst-2' })
        ]);
        const store = createPluginStore({ prisma });
        const result = await store.listInstallationsByScope({
          scope_type: 'pack_local',
          scope_ref: 'pack-1'
        });
        expect(result).toHaveLength(2);
      });
    });

    describe('upsertInstallation', () => {
      it('should upsert and return parsed installation', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.upsert.mockResolvedValue(makeInstallationRow());
        const store = createPluginStore({ prisma });
        const result = await store.upsertInstallation({
          installation_id: 'inst-1',
          plugin_id: 'plugin-1',
          artifact_id: 'art-1',
          version: '1.0.0',
          scope_type: 'pack_local',
          lifecycle_state: 'enabled',
          requested_capabilities: ['cap1'],
          granted_capabilities: ['cap1'],
          trust_mode: 'trusted',
          confirmed_at: '2000',
          enabled_at: '3000'
        });
        expect(result).toBeDefined();
        expect(prisma.pluginInstallation.upsert).toHaveBeenCalledOnce();
      });

      it('should handle optional fields', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginInstallation.upsert.mockResolvedValue(
          makeInstallationRow({ scope_ref: null, confirmed_at: null, enabled_at: null, disabled_at: null, last_error: 'err' })
        );
        const store = createPluginStore({ prisma });
        const result = await store.upsertInstallation({
          installation_id: 'inst-2',
          plugin_id: 'plugin-2',
          artifact_id: 'art-2',
          version: '2.0.0',
          scope_type: 'global',
          lifecycle_state: 'disabled',
          requested_capabilities: [],
          granted_capabilities: [],
          trust_mode: 'untrusted',
          last_error: 'err'
        });
        expect(result.last_error).toBe('err');
      });
    });

    describe('createActivationSession', () => {
      it('should create and return parsed session', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginActivationSession.create.mockResolvedValue(makeActivationRow());
        const store = createPluginStore({ prisma });
        const result = await store.createActivationSession({
          activation_id: 'act-1',
          installation_id: 'inst-1',
          pack_id: 'pack-1',
          channel: 'startup_restore',
          result: 'success',
          started_at: '1000',
          finished_at: '2000',
          loaded_server: true,
          loaded_web_manifest: false
        });
        expect(result).toBeDefined();
        expect(result.activation_id).toBe('act-1');
        expect(result.loaded_server).toBe(true);
      });
    });

    describe('updateActivationSession', () => {
      it('should update and return parsed session', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginActivationSession.update.mockResolvedValue(makeActivationRow({ result: 'failed' }));
        const store = createPluginStore({ prisma });
        const result = await store.updateActivationSession('act-1', { result: 'failed' });
        expect(result).toBeDefined();
        expect(prisma.pluginActivationSession.update).toHaveBeenCalledOnce();
      });
    });

    describe('createEnableAcknowledgement', () => {
      it('should create and return parsed acknowledgement', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginEnableAcknowledgement.create.mockResolvedValue(makeAcknowledgementRow());
        const store = createPluginStore({ prisma });
        const result = await store.createEnableAcknowledgement({
          acknowledgement_id: 'ack-1',
          installation_id: 'inst-1',
          pack_id: 'pack-1',
          channel: 'cli',
          reminder_text_hash: 'hash-1',
          acknowledged: true,
          actor_id: 'actor-1',
          actor_label: 'Admin',
          created_at: '5000'
        });
        expect(result).toBeDefined();
        expect(result.acknowledged).toBe(true);
      });
    });

    describe('getLatestEnableAcknowledgement', () => {
      it('should return null when not found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginEnableAcknowledgement.findFirst.mockResolvedValue(null);
        const store = createPluginStore({ prisma });
        const result = await store.getLatestEnableAcknowledgement('nonexistent');
        expect(result).toBeNull();
      });

      it('should return parsed acknowledgement when found', async () => {
        const prisma = makeMockPrisma();
        prisma.pluginEnableAcknowledgement.findFirst.mockResolvedValue(makeAcknowledgementRow());
        const store = createPluginStore({ prisma });
        const result = await store.getLatestEnableAcknowledgement('inst-1');
        expect(result).toBeDefined();
        expect(result!.acknowledgement_id).toBe('ack-1');
      });
    });
  });
});
