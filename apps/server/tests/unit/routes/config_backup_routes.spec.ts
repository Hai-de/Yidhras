import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/app/services/config/config_backup.js', () => ({
  createConfigBackup: vi.fn(async () => ({
    id: 'backup-1',
    name: 'test-backup',
    path: '/tmp/backup-1.tar.gz',
    created_at: new Date().toISOString()
  })),
  listConfigBackups: vi.fn(() => ({
    items: [{ id: 'backup-1', name: 'test-backup' }],
    total: 1
  })),
  getConfigBackup: vi.fn((id: string) => ({
    id,
    name: 'test-backup',
    path: `/tmp/${id}.tar.gz`,
    created_at: new Date().toISOString()
  })),
  deleteConfigBackup: vi.fn(() => true),
  restoreConfigBackup: vi.fn(async () => {}),
  getBackupPolicy: vi.fn(() => ({ max_backups: 10, max_age_days: 30 })),
  applyRetentionPolicy: vi.fn(() => 0)
}));

import { configBackupRoutes } from '../../../src/app/routes/config_backup.js';
import { createMockAppContext } from '../../helpers/mock_context.js';
import { createTestApp } from '../../helpers/test_app.js';

describe('config backup routes', () => {
  describe('POST /api/config/backups', () => {
    it('creates backup for root operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.post('/api/config/backups', { name: 'my-backup' });
      expect(res.status).toBe(200);
      await app.close();
    });

    it('rejects non-root operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'user', is_root: false }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.post('/api/config/backups', { name: 'my-backup' });
      expect(res.status).toBe(403);
      await app.close();
    });
  });

  describe('GET /api/config/backups', () => {
    it('lists backups for authorized operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.get('/api/config/backups');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/config/backups/:id', () => {
    it('returns backup details', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.get('/api/config/backups/backup-1');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('DELETE /api/config/backups/:id', () => {
    it('deletes backup for root operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.delete('/api/config/backups/backup-1');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/config/backups/:id/restore', () => {
    it('restores backup for root operator', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.post('/api/config/backups/backup-1/restore');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/config/backup-policy', () => {
    it('returns backup policy', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.get('/api/config/backup-policy');
      expect(res.status).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/config/backups/cleanup', () => {
    it('applies retention policy', async () => {
      const ctx = createMockAppContext();
      const app = createTestApp(ctx, {
        operator: { id: 'op-1', username: 'admin', is_root: true }
      });
      configBackupRoutes.register(app.express, ctx);

      const res = await app.post('/api/config/backups/cleanup');
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});
