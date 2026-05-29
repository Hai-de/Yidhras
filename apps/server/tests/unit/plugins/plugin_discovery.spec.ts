import { describe, expect, it, vi } from 'vitest';

import {
  listPackPluginCandidates
} from '../../../src/plugins/discovery.js';

// Mock safeFs
vi.mock('../../../src/utils/safe_fs.js', () => ({
  safeFs: {
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: vi.fn()
  }
}));

// Mock getPluginSandboxConfig
vi.mock('../../../src/plugins/context.js', () => ({
  getPluginSandboxConfig: vi.fn().mockReturnValue({
    capabilityLevel: 'readonly',
    maxManifestSizeBytes: 1024 * 1024,
    maxManifestDepth: 10,
    maxRoutes: 10,
    maxContextSources: 10
  })
}));

// Mock YAML
vi.mock('yaml', () => ({
  default: {
    parse: vi.fn().mockReturnValue({})
  }
}));

// Mock createPluginStore
vi.mock('../../../src/plugins/store.js', () => ({
  createPluginStore: vi.fn().mockReturnValue({
    getArtifactByChecksum: vi.fn().mockResolvedValue(null)
  })
}));

// Mock createPluginManagerService
vi.mock('../../../src/plugins/service.js', () => ({
  createPluginManagerService: vi.fn().mockReturnValue({
    registerArtifact: vi.fn().mockResolvedValue({ artifact_id: 'art-1' }),
    ensurePackLocalInstallation: vi.fn().mockResolvedValue({
      installation_id: 'inst-1',
      plugin_id: 'plugin-1',
      status: 'enabled'
    })
  })
}));

describe('plugins/plugin_discovery', () => {
  describe('listPackPluginCandidates', () => {
    it('should return empty array when plugins directory does not exist', async () => {
      const { safeFs } = await import('../../../src/utils/safe_fs.js');
      (safeFs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = listPackPluginCandidates('/packs/test-pack');
      expect(result).toEqual([]);
    });

    it('should return empty array when plugins directory exists but has no plugin dirs', async () => {
      const { safeFs } = await import('../../../src/utils/safe_fs.js');
      (safeFs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (safeFs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = listPackPluginCandidates('/packs/test-pack');
      expect(result).toEqual([]);
    });

    it('should return empty array when plugin dirs have no manifest files', async () => {
      const { safeFs } = await import('../../../src/utils/safe_fs.js');
      (safeFs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (_parent: string, target: string) => {
          // plugins root dir check: endswith '/plugins'
          if (target.endsWith('/plugins')) return true;
          // manifest file check: return false for all
          return false;
        }
      );
      (safeFs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'my-plugin', isDirectory: () => true },
        { name: 'another-plugin', isDirectory: () => true }
      ]);

      const result = listPackPluginCandidates('/packs/test-pack');
      expect(result).toEqual([]);
    });

    it('should return candidates when plugin dirs have manifest files', async () => {
      const { safeFs } = await import('../../../src/utils/safe_fs.js');
      (safeFs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (_parent: string, target: string) => {
          if (target.endsWith('/plugins')) return true;
          if (target.endsWith('plugin.manifest.yaml')) return true;
          return false;
        }
      );
      (safeFs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'my-plugin', isDirectory: () => true },
        { name: 'regular-file.txt', isDirectory: () => false }
      ]);

      const result = listPackPluginCandidates('/packs/test-pack');
      expect(result).toHaveLength(1);
      expect(result[0]!.plugin_dir_name).toBe('my-plugin');
      expect(result[0]!.manifest_path).toContain('plugin.manifest.yaml');
    });

    it('should filter out non-directory entries', async () => {
      const { safeFs } = await import('../../../src/utils/safe_fs.js');
      (safeFs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (_parent: string, target: string) => {
          if (target.endsWith('/plugins')) return true;
          if (target.endsWith('plugin.manifest.yaml')) return true;
          return false;
        }
      );
      (safeFs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'file.txt', isDirectory: () => false },
        { name: 'plugin-dir', isDirectory: () => true }
      ]);

      const result = listPackPluginCandidates('/packs/test-pack');
      expect(result).toHaveLength(1);
      expect(result[0]!.plugin_dir_name).toBe('plugin-dir');
    });

    it('should fall back to .yml when .yaml not found', async () => {
      const { safeFs } = await import('../../../src/utils/safe_fs.js');
      (safeFs.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (_parent: string, target: string) => {
          if (target.endsWith('/plugins')) return true;
          // .yaml not found, .yml found
          if (target.endsWith('plugin.manifest.yml') && !target.endsWith('.yaml')) return true;
          return false;
        }
      );
      (safeFs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'my-plugin', isDirectory: () => true }
      ]);

      const result = listPackPluginCandidates('/packs/test-pack');
      expect(result).toHaveLength(1);
      expect(result[0]!.manifest_path).toContain('.yml');
    });
  });
});
