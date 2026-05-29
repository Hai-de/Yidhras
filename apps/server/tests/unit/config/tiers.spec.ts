import { describe, expect, it } from 'vitest';

import {
  ConfigTier,
  resolveConfigTier,
  tierAllowsHotReload,
  tierRequiresRestart
} from '../../../src/config/tiers.js';

describe('config/tiers', () => {
  describe('resolveConfigTier', () => {
    it('returns SAFE for safe domains', () => {
      expect(resolveConfigTier('logging')).toBe('safe');
      expect(resolveConfigTier('features')).toBe('safe');
      expect(resolveConfigTier('app.port')).toBe('safe');
    });

    it('returns CAUTION for caution domains', () => {
      expect(resolveConfigTier('world.preferred_pack')).toBe('caution');
      expect(resolveConfigTier('scheduler.runtime')).toBe('caution');
      expect(resolveConfigTier('prompt_workflow')).toBe('caution');
      expect(resolveConfigTier('slot_behaviors')).toBe('caution');
    });

    it('returns DANGEROUS for dangerous domains', () => {
      expect(resolveConfigTier('database')).toBe('dangerous');
      expect(resolveConfigTier('paths')).toBe('dangerous');
      expect(resolveConfigTier('world_engine')).toBe('dangerous');
      expect(resolveConfigTier('runtime')).toBe('dangerous');
    });

    it('returns CRITICAL for operator domain', () => {
      expect(resolveConfigTier('operator')).toBe('critical');
    });

    it('uses prefix matching for nested paths', () => {
      // 'scheduler.agent.limit' is CAUTION, so 'scheduler.agent.limit.custom' should match
      expect(resolveConfigTier('scheduler.agent.limit.custom')).toBe('caution');
      // 'database' is DANGEROUS, so 'database.sqlite.path' should match
      expect(resolveConfigTier('database.sqlite.path')).toBe('dangerous');
    });

    it('returns DANGEROUS (default) for unknown domains', () => {
      expect(resolveConfigTier('unknown_domain')).toBe('dangerous');
      expect(resolveConfigTier('completely.unknown')).toBe('dangerous');
    });
  });

  describe('tierAllowsHotReload', () => {
    it('returns true for SAFE tier', () => {
      expect(tierAllowsHotReload(ConfigTier.SAFE)).toBe(true);
    });

    it('returns false for non-SAFE tiers', () => {
      expect(tierAllowsHotReload(ConfigTier.CAUTION)).toBe(false);
      expect(tierAllowsHotReload(ConfigTier.DANGEROUS)).toBe(false);
      expect(tierAllowsHotReload(ConfigTier.CRITICAL)).toBe(false);
    });
  });

  describe('tierRequiresRestart', () => {
    it('returns true for DANGEROUS tier', () => {
      expect(tierRequiresRestart(ConfigTier.DANGEROUS)).toBe(true);
    });

    it('returns true for CRITICAL tier', () => {
      expect(tierRequiresRestart(ConfigTier.CRITICAL)).toBe(true);
    });

    it('returns false for SAFE tier', () => {
      expect(tierRequiresRestart(ConfigTier.SAFE)).toBe(false);
    });

    it('returns false for CAUTION tier', () => {
      expect(tierRequiresRestart(ConfigTier.CAUTION)).toBe(false);
    });
  });
});
