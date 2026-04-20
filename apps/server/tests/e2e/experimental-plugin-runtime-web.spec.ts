import { describe, expect, it } from 'vitest';

import { assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

describe('experimental plugin runtime web e2e', () => {
  it('keeps stable plugin runtime web routes active-pack scoped while exposing experimental runtime web routes separately', async () => {
    await withIsolatedTestServer(
      {
        defaultPort: 3117,
        envOverrides: {
          EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED: 'true',
          EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED: 'true'
        }
      },
      async server => {
        const loadResponse = await requestJson(server.baseUrl, '/api/experimental/runtime/packs/death_note/load', {
          method: 'POST'
        });
        expect(loadResponse.status).toBe(200);
        const loadData = assertSuccessEnvelopeData(loadResponse.body, 'experimental load runtime before plugin web routes');
        const loadedPackId = String(loadData.handle?.pack_id ?? '');
        expect(loadedPackId.length).toBeGreaterThan(0);

        const stableRuntimeResponse = await requestJson(server.baseUrl, '/api/packs/death_note/plugins/runtime/web');
        expect(stableRuntimeResponse.status).toBe(409);

        const experimentalRuntimeResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${loadedPackId}/plugins/runtime/web`);
        expect(experimentalRuntimeResponse.status).toBe(200);
        const experimentalRuntimeData = assertSuccessEnvelopeData(experimentalRuntimeResponse.body, 'experimental plugin runtime web snapshot');
        expect(experimentalRuntimeData.pack_id).toBe(loadedPackId);
        expect(Array.isArray(experimentalRuntimeData.plugins)).toBe(true);
      }
    );
  });
});
