import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import {
  assert,
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from './helpers.js';

const prisma = new PrismaClient();

const parsePort = (): number => {
  const value = process.env.SMOKE_PORT;
  if (!value) {
    return 3104;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`SMOKE_PORT is invalid: ${value}`);
  }
  return port;
};

const assertErrorCode = (body: unknown, expectedCode: string, label: string): void => {
  assert(isRecord(body), `${label} should return object`);
  assert(body.success === false, `${label} success should be false`);
  assert(isRecord(body.error), `${label} error should be object`);
  assert(body.error.code === expectedCode, `${label} error code should be ${expectedCode}`);
};

const ensurePolicyFixtures = async () => {
  const now = BigInt(Date.now());
  await prisma.identity.upsert({
    where: { id: 'system' },
    update: {
      type: 'system',
      name: 'System',
      provider: 'm2',
      status: 'active',
      updated_at: now
    },
    create: {
      id: 'system',
      type: 'system',
      name: 'System',
      provider: 'm2',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  });
};

const main = async () => {
  const port = parsePort();
  const server = await startServer({ port });

  try {
    await ensurePolicyFixtures();

    const headers = {
      'Content-Type': 'application/json',
      'x-m2-identity': JSON.stringify({ id: 'system', type: 'system', name: 'System' })
    };

    const createRes = await requestJson(server.baseUrl, '/api/policy', {
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
    assert(createRes.status === 200, 'POST /api/policy with valid conditions should return 200');
    assert(isRecord(createRes.body), 'policy create response should be object');
    assert(createRes.body.success === true, 'policy create response success should be true');

    const invalidPrimitiveRes = await requestJson(server.baseUrl, '/api/policy', {
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
    assert(invalidPrimitiveRes.status === 400, 'POST /api/policy with primitive conditions should return 400');
    assertErrorCode(invalidPrimitiveRes.body, 'POLICY_INVALID', 'invalid primitive conditions');

    const invalidNestedRes = await requestJson(server.baseUrl, '/api/policy', {
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
    assert(invalidNestedRes.status === 400, 'POST /api/policy with nested object conditions should return 400');
    assertErrorCode(invalidNestedRes.body, 'POLICY_INVALID', 'invalid nested conditions');

    console.log('[policy_contracts] PASS');
  } catch (error: unknown) {
    console.error('[policy_contracts] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    try {
      const statusRes = await requestJson(server.baseUrl, '/api/status');
      console.error(summarizeResponse('/api/status', statusRes));
    } catch {
      console.error('failed to re-fetch /api/status while handling policy_contracts failure');
    }

    console.error('--- server logs ---');
    console.error(server.getLogs());
    process.exitCode = 1;
  } finally {
    await server.stop();
    await prisma.$disconnect();
  }
};

void main();
