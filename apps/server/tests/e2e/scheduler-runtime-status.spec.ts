import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { requestJson } from '../helpers/server.js';
import { E2ETestKit } from '../testkit_e2e.js';

describe('scheduler runtime status e2e', () => {
  it('reports runtime loop and sqlite diagnostics', async () => {
    const kit = await E2ETestKit.create({ port: 3111, packRef: 'example_pack', seededPackRefs: ['example_pack'] });
    try {
      await kit.startServer();
      const response = await requestJson(kit.baseUrl, '/api/status');
      expect(response.status).toBe(200);

      const data = assertSuccessEnvelopeData(response.body, '/api/status');
      const runtimeLoop = assertRecord(data.runtime_loop, 'runtime_loop');
      const sqlite = assertRecord(data.sqlite, 'sqlite');

      expect(typeof runtimeLoop.status).toBe('string');
      expect(typeof runtimeLoop.in_flight).toBe('boolean');
      expect(typeof runtimeLoop.overlap_skipped_count).toBe('number');
      expect(typeof runtimeLoop.iteration_count).toBe('number');
      expect(runtimeLoop.overlap_skipped_count).toBe(0);

      expect(sqlite.journal_mode).toBe('wal');
      expect(typeof sqlite.busy_timeout).toBe('number');
      expect((sqlite.busy_timeout as number) >= 5000).toBe(true);
      expect(sqlite.foreign_keys).toBe(true);
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });
});
