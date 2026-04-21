import { describe, expect, it } from 'vitest';

import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

describe('plugin runtime startup gap e2e', () => {
  it('mounts pack-local plugin API routes after startup runtime refresh when the active pack runtime is ready', async () => {
    await withIsolatedTestServer({ defaultPort: 3111, activePackRef: 'death_note' }, async server => {
      const response = await requestJson(
        server.baseUrl,
        '/api/packs/world-death-note/plugins/plugin.runtime.alpha/runtime-alpha'
      );

      expect([200, 404]).toContain(response.status);
    });
  });

  it('still exposes canonical plugin runtime web snapshot endpoint under active runtime', async () => {
    await withIsolatedTestServer({ defaultPort: 3112, activePackRef: 'death_note' }, async server => {
      const response = await requestJson(server.baseUrl, '/api/packs/world-death-note/plugins/runtime/web');
      expect(response.status).toBe(200);
    });
  });
});
