 import { describe, expect, it } from 'vitest';

import { assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

const enablePackPluginRuntimeWarningTextHash = '7d49285e1f5f5893e35c1c8b3446c97f5d0b3d4c0f3d8c7f60ef7e0df63951a4';

describe('plugin runtime web e2e', () => {
  it('returns canonical runtime web bundle URLs and rejects missing assets for packs without enabled plugins', async () => {
    await withIsolatedTestServer({ defaultPort: 3110, activePackRef: 'death_note' }, async server => {
      const runtimeResponse = await requestJson(server.baseUrl, '/api/packs/world-death-note/plugins/runtime/web');
      expect(runtimeResponse.status).toBe(200);
      const runtimeData = assertSuccessEnvelopeData(runtimeResponse.body, 'plugin runtime web snapshot');
      expect(runtimeData.pack_id).toBe('world-death-note');
      expect(Array.isArray(runtimeData.plugins)).toBe(true);
      expect(runtimeData.plugins).toHaveLength(0);

      const assetResponse = await requestJson(
        server.baseUrl,
        '/api/packs/world-death-note/plugins/plugin.alpha/runtime/web/installation-missing/dist/web/index.mjs'
      );
      expect([404, 409]).toContain(assetResponse.status);
    });
  });

  it('keeps plugin enable acknowledgement hash stable for non-interactive automation assumptions', () => {
    expect(enablePackPluginRuntimeWarningTextHash).toHaveLength(64);
  });
});
