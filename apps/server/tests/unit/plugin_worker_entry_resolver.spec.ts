import { describe, expect, it } from 'vitest';

import {
  resolvePluginWorkerEntry,
  resolvePluginWorkerEntryUrl
} from '../../src/plugins/worker/worker_entry_resolver.js';

describe('plugin Worker entry resolver', () => {
  describe('resolvePluginWorkerEntry (primary)', () => {
    it('returns workerUrl as a file:// URL', () => {
      const entry = resolvePluginWorkerEntry();
      expect(entry.workerUrl).toBeInstanceOf(URL);
      expect(entry.workerUrl.protocol).toBe('file:');
    });

    it('workerUrl path contains plugins/worker segment', () => {
      expect(resolvePluginWorkerEntry().workerUrl.pathname).toContain('/plugins/worker/');
    });

    it('workerUrl path ends with worker_entry.js in dist mode, .ts in dev mode', () => {
      const { pathname } = resolvePluginWorkerEntry().workerUrl;
      expect(pathname.endsWith('/worker_entry.js') || pathname.endsWith('/worker_entry.ts')).toBe(true);
    });

    it('provides execArgv with tsx loader in dev mode, undefined in dist mode', () => {
      const entry = resolvePluginWorkerEntry();
      if (entry.workerUrl.pathname.endsWith('.ts')) {
        expect(entry.execArgv).toBeDefined();
        expect(entry.execArgv?.[0]).toBe('--import');
        expect(entry.execArgv?.[1]).toContain('tsx');
      } else {
        expect(entry.execArgv).toBeUndefined();
      }
    });
  });

  describe('resolvePluginWorkerEntryUrl (deprecated compat)', () => {
    it('returns same workerUrl as resolvePluginWorkerEntry', () => {
      expect(resolvePluginWorkerEntryUrl().href).toBe(resolvePluginWorkerEntry().workerUrl.href);
    });
  });
});
