import { describe, expect, it } from 'vitest';

import type { PluginManifest } from '@yidhras/contracts';

import { getRootAuthHeaders } from '../helpers/auth.js';
import { assertErrorEnvelope, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { createIsolatedRuntimeEnvironment, createPrismaClientForEnvironment, prepareIsolatedRuntime } from '../helpers/runtime.js';
import type { RunningServer, TestServerOptions } from '../helpers/server.js';
import { requestJson, withTestServer } from '../helpers/server.js';

const PACK_REF = 'example_pack';
const PACK_ID = 'world-example-pack';

interface PluginSeed {
  artifact_id: string;
  plugin_id: string;
  installation_id: string;
  checksum: string;
  manifestOverrides?: Record<string, unknown>;
  scope_type?: string;
  lifecycle_state?: string;
}

const ensureRootPackBinding = async (
  databaseUrl: string,
  packId: string
): Promise<void> => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } }
  });

  try {
    const rootOp = await prisma.operator.findUnique({ where: { username: 'root' } });
    if (!rootOp) return;

    await prisma.operatorPackBinding.upsert({
      where: { operator_id_pack_id: { operator_id: rootOp.id, pack_id: packId } },
      create: {
        operator_id: rootOp.id,
        pack_id: packId,
        binding_type: 'owner',
        bound_at: BigInt(Date.now()),
        bound_by: null,
        created_at: BigInt(Date.now())
      },
      update: {}
    });
  } finally {
    await prisma.$disconnect();
  }
};

const seedPlugin = async (
  databaseUrl: string,
  seed: PluginSeed
): Promise<void> => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } }
  });

  try {
    const manifestJson = {
      manifest_version: 'plugin/v1',
      id: seed.plugin_id,
      name: seed.plugin_id,
      version: '1.0.0',
      kind: 'test',
      entrypoints: {},
      compatibility: { yidhras: '>=0.5.0', pack_id: PACK_ID },
      requested_capabilities: [],
      contributions: {
        server: {
          context_sources: [],
          prompt_workflow_steps: [],
          intent_grounders: [],
          pack_projections: [],
          api_routes: [],
          step_contributors: [],
          rule_contributors: [],
          query_contributors: []
        },
        web: {
          panels: [],
          routes: [],
          menu_items: []
        }
      },
      load: { priority: 0, after: [] },
      dependencies: { interfaces: [], plugins: [] },
      provides: [],
      ...(seed.manifestOverrides ?? {})
    } as PluginManifest;

    await prisma.pluginArtifact.create({
      data: {
        artifact_id: seed.artifact_id,
        plugin_id: seed.plugin_id,
        version: '1.0.0',
        manifest_version: 'plugin/v1',
        source_type: 'bundled_by_pack',
        source_pack_id: PACK_ID,
        source_path: 'tests/e2e/fixtures',
        checksum: seed.checksum,
        manifest_json: JSON.parse(JSON.stringify(manifestJson)),
        imported_at: String(Date.now())
      }
    });

    await prisma.pluginInstallation.create({
      data: {
        installation_id: seed.installation_id,
        plugin_id: seed.plugin_id,
        artifact_id: seed.artifact_id,
        version: '1.0.0',
        scope_type: seed.scope_type ?? 'pack_local',
        scope_ref: seed.scope_type === 'global' ? null : PACK_ID,
        lifecycle_state: seed.lifecycle_state ?? 'confirmed_disabled',
        requested_capabilities: '',
        granted_capabilities: '',
        trust_mode: 'trusted'
      }
    });
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Custom test helper: creates an isolated runtime environment, seeds plugin
 * data into the database, then starts the server. This allows testing the
 * HTTP API against pre-existing plugin installations.
 */
const withSeededServer = async <T>(
  options: TestServerOptions & { activePackRef: string },
  seeds: PluginSeed[],
  run: (server: RunningServer) => Promise<T>
): Promise<T> => {
  const environment = await createIsolatedRuntimeEnvironment({
    appEnv: 'test',
    seededPackRefs: [PACK_REF],
    activePackRef: options.activePackRef
  });

  try {
    await prepareIsolatedRuntime(environment);

    // Ensure root operator has a pack binding for the target pack
    await ensureRootPackBinding(environment.databaseUrl, PACK_ID);

    // Seed plugin data before server starts
    for (const seed of seeds) {
      await seedPlugin(environment.databaseUrl, seed);
    }

    return await withTestServer(
      {
        ...options,
        envOverrides: {
          ...environment.envOverrides,
          ...(options.envOverrides ?? {})
        },
        prepareRuntime: false
      },
      run
    );
  } finally {
    await environment.cleanup();
  }
};

const REMINDER_HASH = '03ee763729f5fe81f03478a3b0f487ff6c8dfc779f7e9b8d88a6d016dc17edfb';

// --- E2E: Plugin dependency flow via HTTP API ---

describe('plugin dependency flow e2e', () => {
  it('lists plugin installations for a pack (no plugins)', async () => {
    await withSeededServer({ defaultPort: 3120, activePackRef: PACK_REF }, [], async server => {
      const headers = await getRootAuthHeaders(server.baseUrl);
      const res = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins`, { headers });

      expect(res.status).toBe(200);
      const data = assertSuccessEnvelopeData(res.body, 'list plugins');
      expect(data.pack_id).toBe(PACK_ID);
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items).toHaveLength(0);
      expect(data.enable_warning.enabled).toBe(true);
    });
  });

  it('returns 404 when enabling a non-existent installation', async () => {
    await withSeededServer({ defaultPort: 3121, activePackRef: PACK_REF }, [], async server => {
      const headers = {
        ...await getRootAuthHeaders(server.baseUrl),
        'Content-Type': 'application/json'
      };
      const res = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/nonexistent-inst/enable`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' }
        })
      });

      expect(res.status).toBe(404);
      assertErrorEnvelope(res.body, 'PLUGIN_INSTALLATION_NOT_FOUND', 'enable missing');
    });
  });

  it('returns 404 when disabling a non-existent installation', async () => {
    await withSeededServer({ defaultPort: 3122, activePackRef: PACK_REF }, [], async server => {
      const headers = {
        ...await getRootAuthHeaders(server.baseUrl),
        'Content-Type': 'application/json'
      };
      const res = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/nonexistent-inst/disable`, {
        method: 'POST',
        headers
      });

      expect(res.status).toBe(404);
      assertErrorEnvelope(res.body, 'PLUGIN_INSTALLATION_NOT_FOUND', 'disable missing');
    });
  });

  it('enables a plugin when dependencies are satisfied', async () => {
    const seeds: PluginSeed[] = [
      {
        artifact_id: 'artifact-provider',
        plugin_id: 'plugin.provider',
        installation_id: 'installation-provider',
        checksum: 'sha256:e2e-provider',
        manifestOverrides: { provides: [{ key: 'data_cleaner.string', version: '1.0.0' }] }
      },
      {
        artifact_id: 'artifact-consumer',
        plugin_id: 'plugin.consumer',
        installation_id: 'installation-consumer',
        checksum: 'sha256:e2e-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [{ key: 'data_cleaner.string', optional: false }],
            plugins: []
          }
        }
      }
    ];

    await withSeededServer({ defaultPort: 3123, activePackRef: PACK_REF }, seeds, async server => {
      const headers = {
        ...await getRootAuthHeaders(server.baseUrl),
        'Content-Type': 'application/json'
      };

      // Confirm provider
      const confirmProvRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-provider/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      expect(confirmProvRes.status).toBe(200);

      // Enable provider first
      const enableProvRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-provider/enable`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' }
        })
      });
      expect(enableProvRes.status).toBe(200);
      const providerData = assertSuccessEnvelopeData(enableProvRes.body, 'enable provider');
      expect(providerData.installation).toBeDefined();

      // Confirm consumer
      const confirmConsRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-consumer/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      expect(confirmConsRes.status).toBe(200);

      // Enable consumer — dependency satisfied by provider
      const enableConsRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-consumer/enable`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' }
        })
      });
      expect(enableConsRes.status).toBe(200);
      const consumerData = assertSuccessEnvelopeData(enableConsRes.body, 'enable consumer');
      expect(consumerData.installation).toBeDefined();

      // List plugins — both should be enabled
      const listRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins`, { headers: await getRootAuthHeaders(server.baseUrl) });
      expect(listRes.status).toBe(200);
      const listData = assertSuccessEnvelopeData(listRes.body, 'list plugins after enable');
      const enabledItems = (listData.items as Array<{ lifecycle_state: string }>).filter(
        i => i.lifecycle_state === 'enabled'
      );
      expect(enabledItems).toHaveLength(2);
    });
  });

  it('rejects enable when required interface dependency is missing', async () => {
    const seeds: PluginSeed[] = [
      {
        artifact_id: 'artifact-lonely',
        plugin_id: 'plugin.lonely',
        installation_id: 'installation-lonely',
        checksum: 'sha256:e2e-lonely',
        manifestOverrides: {
          dependencies: {
            interfaces: [{ key: 'data_cleaner.missing', optional: false }],
            plugins: []
          }
        }
      }
    ];

    await withSeededServer({ defaultPort: 3124, activePackRef: PACK_REF }, seeds, async server => {
      const headers = {
        ...await getRootAuthHeaders(server.baseUrl),
        'Content-Type': 'application/json'
      };

      // Confirm
      const confirmRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-lonely/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      expect(confirmRes.status).toBe(200);

      // Enable — should fail because no plugin provides data_cleaner.missing
      const enableRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-lonely/enable`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' }
        })
      });

      expect(enableRes.status).toBe(400);
      assertErrorEnvelope(enableRes.body, 'PLUGIN_DEPENDENCIES_UNSATISFIED', 'enable with missing deps');
    });
  });

  it('allows disable even when dependents exist (non-strict default)', async () => {
    const seeds: PluginSeed[] = [
      {
        artifact_id: 'artifact-with-deps',
        plugin_id: 'plugin.with.deps',
        installation_id: 'installation-with-deps',
        checksum: 'sha256:e2e-with-deps',
        manifestOverrides: { provides: [{ key: 'data_cleaner.x', version: '1.0.0' }] }
      },
      {
        artifact_id: 'artifact-depends-on',
        plugin_id: 'plugin.depends.on',
        installation_id: 'installation-depends-on',
        checksum: 'sha256:e2e-depends-on',
        manifestOverrides: {
          dependencies: {
            interfaces: [],
            plugins: [{ plugin_id: 'plugin.with.deps', optional: false }]
          }
        }
      }
    ];

    await withSeededServer({ defaultPort: 3125, activePackRef: PACK_REF }, seeds, async server => {
      const headers = {
        ...await getRootAuthHeaders(server.baseUrl),
        'Content-Type': 'application/json'
      };

      // Confirm and enable both
      await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-with-deps/confirm`, {
        method: 'POST', headers, body: JSON.stringify({})
      });
      await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-with-deps/enable`, {
        method: 'POST', headers,
        body: JSON.stringify({ acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' } })
      });

      await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-depends-on/confirm`, {
        method: 'POST', headers, body: JSON.stringify({})
      });
      await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-depends-on/enable`, {
        method: 'POST', headers,
        body: JSON.stringify({ acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' } })
      });

      // Disable provider — should succeed with warning (non-strict default)
      const disableRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-with-deps/disable`, {
        method: 'POST',
        headers: { ...await getRootAuthHeaders(server.baseUrl), 'Content-Type': 'application/json' }
      });

      // Non-strict mode: disable succeeds despite active dependents
      expect(disableRes.status).toBe(200);
      const data = assertSuccessEnvelopeData(disableRes.body, 'disable with dependents (non-strict)');
      expect(data.installation).toBeDefined();
    });
  });

  it('disables a plugin when no dependents exist', async () => {
    const seeds: PluginSeed[] = [
      {
        artifact_id: 'artifact-solo-e2e',
        plugin_id: 'plugin.solo.e2e',
        installation_id: 'installation-solo-e2e',
        checksum: 'sha256:e2e-solo'
      }
    ];

    await withSeededServer({ defaultPort: 3126, activePackRef: PACK_REF }, seeds, async server => {
      const headers = {
        ...await getRootAuthHeaders(server.baseUrl),
        'Content-Type': 'application/json'
      };

      // Confirm and enable
      await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-solo-e2e/confirm`, {
        method: 'POST', headers, body: JSON.stringify({})
      });
      await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-solo-e2e/enable`, {
        method: 'POST', headers,
        body: JSON.stringify({ acknowledgement: { reminder_text_hash: REMINDER_HASH, actor_label: 'e2e' } })
      });

      // Disable
      const disableRes = await requestJson(server.baseUrl, `/api/packs/${PACK_ID}/plugins/installation-solo-e2e/disable`, {
        method: 'POST',
        headers: { ...await getRootAuthHeaders(server.baseUrl), 'Content-Type': 'application/json' }
      });

      expect(disableRes.status).toBe(200);
      const data = assertSuccessEnvelopeData(disableRes.body, 'disable solo plugin');
      expect(data.installation).toBeDefined();
    });
  });
});
