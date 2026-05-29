import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import type { PackRuntimePort } from '../../../src/app/services/pack/pack_runtime_ports.js';
import type { WorldPack } from '../../../src/packs/schema/constitution_schema.js';
import {
  createPluginContext,
  type PackScopedPluginContext,
  type PluginCapabilityLevel,
  type ReadonlyPluginContext
} from '../../../src/plugins/context.js';

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn().mockReturnValue(42n)
}));

vi.mock('../../../src/config/runtime_config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({
    plugins: {
      sandbox: {
        capability_level: 'readonly',
        max_manifest_size_bytes: 1024 * 1024,
        max_manifest_depth: 10,
        max_routes: 10,
        max_context_sources: 10
      }
    }
  })
}));

function makeMockAppContext(overrides: Record<string, unknown> = {}): AppContext {
  return {
    notifications: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]), clear: vi.fn() },
    isRuntimeReady: vi.fn().mockReturnValue(true),
    assertRuntimeReady: vi.fn(),
    ...overrides
  } as unknown as AppContext;
}

function makeMockPackRuntime(overrides: Partial<PackRuntimePort> = {}): PackRuntimePort {
  return {
    getPack: vi.fn().mockReturnValue({ metadata: { id: 'pack-1' } } as WorldPack),
    getCurrentRevision: vi.fn().mockReturnValue(42n),
    getPackId: vi.fn().mockReturnValue('pack-1'),
    ...overrides
  } as unknown as PackRuntimePort;
}

describe('plugins/plugin_context', () => {
  describe('createPluginContext', () => {
    describe('readonly level', () => {
      it('should create readonly context with notifications', () => {
        const ctx = makeMockAppContext();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'readonly' });
        expect(result.notifications).toBeDefined();
      });

      it('should expose clock that delegates to resolvePackTick', () => {
        const ctx = makeMockAppContext();
        const packRuntime = makeMockPackRuntime();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'readonly', packRuntime });
        const tick = result.clock.getCurrentTick();
        expect(tick).toBeDefined();
      });

      it('should expose packRuntime with getPack and getCurrentRevision', () => {
        const ctx = makeMockAppContext();
        const packRuntime = makeMockPackRuntime();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'readonly', packRuntime });
        const pack = result.packRuntime.getPack();
        expect(pack).toBeDefined();
        expect(result.packRuntime.getCurrentRevision()).toBe(42n);
      });

      it('should expose getPackId that delegates to packRuntime', () => {
        const ctx = makeMockAppContext();
        const packRuntime = makeMockPackRuntime();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'readonly', packRuntime });
        expect(result.getPackId()).toBe('pack-1');
      });

      it('should return null packId when no packRuntime', () => {
        const ctx = makeMockAppContext();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'readonly' });
        expect(result.getPackId()).toBeNull();
      });

      it('should return undefined pack when no packRuntime', () => {
        const ctx = makeMockAppContext();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'readonly' });
        expect(result.packRuntime.getPack()).toBeUndefined();
      });
    });

    describe('pack_scoped level', () => {
      it('should create pack_scoped context with all readonly features', () => {
        const ctx = makeMockAppContext();
        const packRuntime = makeMockPackRuntime();
        const result = createPluginContext(ctx, 'test-plugin', { level: 'pack_scoped', packRuntime });
        expect(result.notifications).toBeDefined();
        expect(result.clock).toBeDefined();
        expect(result.packRuntime).toBeDefined();
        expect(result.getPackId()).toBe('pack-1');
      });

      it('should expose getRuntimeReady', () => {
        const ctx = makeMockAppContext({ isRuntimeReady: vi.fn().mockReturnValue(true) });
        const result = createPluginContext(ctx, 'test-plugin', { level: 'pack_scoped' }) as PackScopedPluginContext;
        expect(result.getRuntimeReady()).toBe(true);
      });

      it('should expose assertRuntimeReady that delegates to context', () => {
        const assertFn = vi.fn();
        const ctx = makeMockAppContext({ assertRuntimeReady: assertFn });
        const result = createPluginContext(ctx, 'test-plugin', { level: 'pack_scoped' }) as PackScopedPluginContext;
        result.assertRuntimeReady('test-feature');
        expect(assertFn).toHaveBeenCalledWith('test-feature');
      });
    });

    describe('default level', () => {
      it('should use configured capability level when level not specified', () => {
        const ctx = makeMockAppContext();
        // This will use getPluginSandboxConfig().capabilityLevel
        // The actual value depends on runtime config, but should not throw
        expect(() => createPluginContext(ctx, 'test-plugin')).not.toThrow();
      });
    });
  });
});
