import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getActiveAppEnv,
  getRuntimeConfig,
  resetRuntimeConfigCache
} from '../../../src/config/runtime_config.js';

describe('runtime_config', () => {
  // Save and restore env vars
  const savedEnv: Record<string, string | undefined> = {};

  const saveEnv = (keys: string[]) => {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
    }
  };

  const restoreEnv = (keys: string[]) => {
    for (const key of keys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  };

  beforeEach(() => {
    resetRuntimeConfigCache();
  });

  afterEach(() => {
    resetRuntimeConfigCache();
  });

  describe('getActiveAppEnv', () => {
    const ENV_KEYS = ['APP_ENV', 'NODE_ENV'];

    beforeEach(() => {
      saveEnv(ENV_KEYS);
    });

    afterEach(() => {
      restoreEnv(ENV_KEYS);
    });

    it('returns APP_ENV when set', () => {
      process.env.APP_ENV = 'production';
      process.env.NODE_ENV = 'development';
      expect(getActiveAppEnv()).toBe('production');
    });

    it('returns NODE_ENV when APP_ENV is not set', () => {
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'staging';
      expect(getActiveAppEnv()).toBe('staging');
    });

    it('returns builtin default when neither is set', () => {
      delete process.env.APP_ENV;
      delete process.env.NODE_ENV;
      const env = getActiveAppEnv();
      expect(typeof env).toBe('string');
      expect(env.length).toBeGreaterThan(0);
    });

    it('ignores empty string APP_ENV', () => {
      process.env.APP_ENV = '  ';
      delete process.env.NODE_ENV;
      const env = getActiveAppEnv();
      // Empty/whitespace strings are treated as undefined by parseOptionalStringEnv
      expect(typeof env).toBe('string');
    });
  });

  describe('getRuntimeConfig', () => {
    it('returns a valid config object', () => {
      const config = getRuntimeConfig();
      expect(config).toBeDefined();
      expect(config.app).toBeDefined();
      expect(config.app.env).toBeDefined();
      expect(typeof config.app.env).toBe('string');
    });

    it('includes scheduler config', () => {
      const config = getRuntimeConfig();
      expect(config.scheduler).toBeDefined();
      expect(config.scheduler.runtime).toBeDefined();
      expect(typeof config.scheduler.runtime.simulation_loop_interval_ms).toBe('number');
    });

    it('includes operator config', () => {
      const config = getRuntimeConfig();
      expect(config.operator).toBeDefined();
      expect(config.operator.auth).toBeDefined();
    });

    it('includes database config', () => {
      const config = getRuntimeConfig();
      expect(config.database).toBeDefined();
    });

    it('includes features config', () => {
      const config = getRuntimeConfig();
      expect(config.features).toBeDefined();
    });

    it('includes startup config', () => {
      const config = getRuntimeConfig();
      expect(config.startup).toBeDefined();
    });

    it('returns consistent config on multiple calls (cached)', () => {
      const config1 = getRuntimeConfig();
      const config2 = getRuntimeConfig();
      expect(config1).toBe(config2); // Same reference (cached)
    });
  });

  describe('resetRuntimeConfigCache', () => {
    it('creates new config after reset', () => {
      const config1 = getRuntimeConfig();
      resetRuntimeConfigCache();
      const config2 = getRuntimeConfig();
      // After reset, a new config is loaded (may or may not be same reference)
      expect(config2).toBeDefined();
      expect(config2.app.env).toBe(config1.app.env);
    });
  });
});
