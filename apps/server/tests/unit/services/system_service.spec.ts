import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import {
  clearSystemNotifications,
  getStartupHealthSnapshot,
  listSystemNotifications
} from '../../../src/app/services/system/system.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

/* ──────────────────── listSystemNotifications ──────────────────── */

describe('listSystemNotifications', () => {
  it('returns empty list when no notifications', () => {
    const ctx = createMockAppContext();
    const result = listSystemNotifications(ctx as AppContext);
    expect(result).toEqual([]);
  });

  it('returns notifications from context', () => {
    const ctx = createMockAppContext();
    ctx.notifications.push('warning', 'test warning');
    ctx.notifications.push('error', 'test error');

    const result = listSystemNotifications(ctx as AppContext);
    expect(result.length).toBe(2);
    expect(result[0].level).toBe('error'); // most recent first
    expect(result[1].level).toBe('warning');
  });
});

/* ──────────────────── clearSystemNotifications ──────────────────── */

describe('clearSystemNotifications', () => {
  it('clears all notifications and returns acknowledged', () => {
    const ctx = createMockAppContext();
    ctx.notifications.push('warning', 'test');

    const result = clearSystemNotifications(ctx as AppContext);
    expect(result).toEqual({ acknowledged: true });
    expect(listSystemNotifications(ctx as AppContext)).toEqual([]);
  });
});

/* ──────────────────── getStartupHealthSnapshot ──────────────────── */

describe('getStartupHealthSnapshot', () => {
  it('returns 200 when health level is ok', () => {
    const ctx = createMockAppContext();
    const result = getStartupHealthSnapshot(ctx as AppContext);
    expect(result.statusCode).toBe(200);
    expect(result.body.healthy).toBe(true);
    expect(result.body.level).toBe('ok');
    expect(result.body.runtime_ready).toBe(true);
  });

  it('returns 503 when health level is fail', () => {
    const ctx = createMockAppContext({
      overrides: {
        startupHealth: {
          level: 'fail',
          checks: { db: false, world_pack_dir: true, world_pack_available: true },
          available_world_packs: [],
          errors: ['DB connection failed']
        }
      } as never
    });
    const result = getStartupHealthSnapshot(ctx as AppContext);
    expect(result.statusCode).toBe(503);
    expect(result.body.healthy).toBe(false);
    expect(result.body.errors).toContain('DB connection failed');
  });

  it('includes available world packs', () => {
    const ctx = createMockAppContext();
    const result = getStartupHealthSnapshot(ctx as AppContext);
    expect(Array.isArray(result.body.available_world_packs)).toBe(true);
  });

  it('includes checks object', () => {
    const ctx = createMockAppContext();
    const result = getStartupHealthSnapshot(ctx as AppContext);
    expect(result.body.checks).toBeDefined();
    expect(result.body.checks.db).toBe(true);
  });

  it('reflects runtime ready state', () => {
    const ctx = createMockAppContext();
    expect(getStartupHealthSnapshot(ctx as AppContext).body.runtime_ready).toBe(true);
  });
});
