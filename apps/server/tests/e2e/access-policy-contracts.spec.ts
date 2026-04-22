import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { isRecord, requestJson } from '../helpers/server.js';

describe('access-policy contracts e2e', () => {
  it('accepts flat primitive/array conditions and rejects primitive or nested-object conditions', async () => {
    await withIsolatedTestServer({
      defaultPort: 3117,
      activePackRef: 'example_pack',
      seededPackRefs: ['example_pack']
    }, async server => {
      const headers = {
        'Content-Type': 'application/json',
        'x-m2-identity': JSON.stringify({ id: 'system', type: 'system', name: 'System' })
      };

      const createResponse = await requestJson(server.baseUrl, '/api/access-policy', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          effect: 'allow',
          resource: 'social_post',
          action: 'read',
          field: 'content',
          conditions: {
            visibility: 'public',
            score: [1, 2, 3],
            enabled: true,
            optional: null
          },
          priority: 10
        })
      });
      expect(createResponse.status).toBe(200);
      expect(isRecord(createResponse.body)).toBe(true);
      expect((createResponse.body as Record<string, unknown>).success).toBe(true);

      const invalidPrimitiveResponse = await requestJson(server.baseUrl, '/api/access-policy', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          effect: 'allow',
          resource: 'social_post',
          action: 'read',
          field: 'content',
          conditions: 'invalid'
        })
      });
      expect(invalidPrimitiveResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidPrimitiveResponse.body,
        'POLICY_INVALID',
        'invalid primitive conditions'
      );

      const invalidNestedResponse = await requestJson(server.baseUrl, '/api/access-policy', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          effect: 'allow',
          resource: 'social_post',
          action: 'read',
          field: 'content',
          conditions: {
            nested: {
              bad: true
            }
          }
        })
      });
      expect(invalidNestedResponse.status).toBe(400);
      assertErrorEnvelope(
        invalidNestedResponse.body,
        'POLICY_INVALID',
        'invalid nested conditions'
      );
    });
  });
});
