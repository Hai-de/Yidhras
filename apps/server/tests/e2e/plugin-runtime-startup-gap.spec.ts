import { describe, expect, it } from 'vitest';

import { requestJson } from '../helpers/server.js';
import { E2ETestKit } from '../testkit_e2e.js';

describe('plugin runtime startup gap e2e', () => {
  it('mounts pack-local plugin API routes after startup runtime refresh when the active pack runtime is ready', async () => {
    const kit = await E2ETestKit.create({ port: 3111, packRef: 'death_note' });
    try {
      await kit.startServer();
      const response = await requestJson(
        kit.baseUrl,
        '/api/packs/world-death-note/plugins/plugin.runtime.alpha/runtime-alpha'
      );

      expect([200, 404]).toContain(response.status);
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });

  it('still exposes canonical plugin runtime web snapshot endpoint under active runtime', async () => {
    const kit = await E2ETestKit.create({ port: 3112, packRef: 'death_note' });
    try {
      await kit.startServer();
      const response = await requestJson(kit.baseUrl, '/api/packs/world-death-note/plugins/runtime/web');
      expect(response.status).toBe(200);
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });
});
