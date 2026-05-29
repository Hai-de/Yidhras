import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/services/plugin/plugins.js', () => ({
  listPackPluginInstallations: vi.fn(async () => []),
  confirmPackPluginImport: vi.fn(async () => ({
    installation_id: 'inst-1',
    plugin_id: 'plugin-1',
    pack_id: 'pack-1',
    status: 'confirmed'
  })),
  enablePackPlugin: vi.fn(async () => ({
    installation_id: 'inst-1',
    plugin_id: 'plugin-1',
    pack_id: 'pack-1',
    status: 'enabled'
  })),
  disablePackPlugin: vi.fn(async () => ({
    installation_id: 'inst-1',
    plugin_id: 'plugin-1',
    pack_id: 'pack-1',
    status: 'disabled'
  }))
}));

vi.mock('../../../src/operator/guard/pack_access.js', () => ({
  packAccessGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next())
}));

vi.mock('../../../src/app/middleware/capability.js', () => ({
  capabilityGuard: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkCapability: vi.fn(async () => true)
}));

// Mock contract schemas to avoid validation errors with mock data
vi.mock('@yidhras/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yidhras/contracts')>();
  return {
    ...actual,
    pluginListResponseDataSchema: { parse: vi.fn((data: unknown) => data), safeParse: vi.fn((data: unknown) => ({ success: true, data })) },
    pluginOperationAcknowledgementSchema: { parse: vi.fn((data: unknown) => data), safeParse: vi.fn((data: unknown) => ({ success: true, data })) },
    pluginEnableRequestSchema: { parse: vi.fn((data: unknown) => data), safeParse: vi.fn((data: unknown) => ({ success: true, data })) },
    pluginImportConfirmRequestSchema: { parse: vi.fn((data: unknown) => data), safeParse: vi.fn((data: unknown) => ({ success: true, data })) },
    pluginInstallationParamsSchema: { parse: vi.fn((data: unknown) => data), safeParse: vi.fn((data: unknown) => ({ success: true, data })) },
    pluginPackParamsSchema: { parse: vi.fn((data: unknown) => data), safeParse: vi.fn((data: unknown) => ({ success: true, data })) }
  };
});

import { pluginRoutes } from '../../../src/app/routes/plugins.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('plugin routes', () => {
  const setup = () => {
    const ctx = createMockAppContext();
    const app = createTestApp(ctx, {
      operator: { id: 'op-1', username: 'admin', is_root: true }
    });
    pluginRoutes.register(app.express, ctx);
    return { ctx, app };
  };

  describe('GET /api/packs/:packId/plugins', () => {
    it('returns plugin installations list', async () => {
      const { app } = setup();
      const res = await app.get('/api/packs/pack-1/plugins');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/packs/:packId/plugins/:installationId/confirm', () => {
    it('confirms plugin import', async () => {
      const { app } = setup();
      const res = await app.post('/api/packs/pack-1/plugins/inst-1/confirm', {
        granted_capabilities: []
      });
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/packs/:packId/plugins/:installationId/enable', () => {
    it('enables plugin', async () => {
      const { app } = setup();
      const res = await app.post('/api/packs/pack-1/plugins/inst-1/enable', {
        acknowledgement: { confirmed: true }
      });
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/packs/:packId/plugins/:installationId/disable', () => {
    it('disables plugin', async () => {
      const { app } = setup();
      const res = await app.post('/api/packs/pack-1/plugins/inst-1/disable');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/packs/:packId/plugins/reload', () => {
    it('returns 501 when pluginRuntimeControl is not available', async () => {
      const { app, ctx } = setup();
      (ctx as unknown as Record<string, unknown>).pluginRuntimeControl = null;
      const res = await app.post('/api/packs/pack-1/plugins/reload');
      expect(res.status).toBe(501);
      await app.close();
    });

    it('reloads plugin runtime when control is available', async () => {
      const { app, ctx } = setup();
      (ctx as unknown as Record<string, unknown>).pluginRuntimeControl = {
        reload: vi.fn(async () => ({ success: true }))
      };
      const res = await app.post('/api/packs/pack-1/plugins/reload');
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
