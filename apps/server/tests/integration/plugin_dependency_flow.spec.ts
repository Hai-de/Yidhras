import { describe, expect, it } from 'vitest';

import type { PluginManifest } from '@yidhras/contracts';

import { confirmPackPluginImport, disablePackPlugin, enablePackPlugin } from '../../src/app/services/plugins.js';
import { pluginRuntimeRegistry, refreshActivePackPluginRuntime } from '../../src/plugins/runtime.js';
import { createPluginStore } from '../../src/plugins/store.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const REMINDER_HASH = '03ee763729f5fe81f03478a3b0f487ff6c8dfc779f7e9b8d88a6d016dc17edfb';

const PACK_ID = 'test-dependency-pack';

interface ArtifactInput {
  artifact_id: string;
  plugin_id: string;
  checksum: string;
  manifestOverrides?: Record<string, unknown>;
}

const createArtifact = (input: ArtifactInput) => ({
  artifact_id: input.artifact_id,
  plugin_id: input.plugin_id,
  version: '1.0.0',
  manifest_version: 'plugin/v1' as const,
  source_type: 'bundled_by_pack' as const,
  source_pack_id: PACK_ID,
  source_path: 'tests/fixtures',
  checksum: input.checksum,
  manifest_json: {
    manifest_version: 'plugin/v1',
    id: input.plugin_id,
    name: input.plugin_id,
    version: '1.0.0',
    kind: 'other',
    entrypoints: {},
    compatibility: { yidhras: '>=0.5.0', pack_id: PACK_ID },
    requested_capabilities: [],
    contributions: {
      server: {
        context_sources: [],
        prompt_workflow_steps: [],
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
    ...(input.manifestOverrides ?? {})
  } as PluginManifest,
  imported_at: '1000'
});

interface InstallationInput {
  installation_id: string;
  plugin_id: string;
  artifact_id: string;
  lifecycle_state?: string;
  scope_type?: string;
  scope_ref?: string | null;
}

const createInstall = (input: InstallationInput) => ({
  installation_id: input.installation_id,
  plugin_id: input.plugin_id,
  artifact_id: input.artifact_id,
  version: '1.0.0',
  scope_type: input.scope_type ?? 'pack_local',
  scope_ref: 'scope_ref' in input ? (input.scope_ref ?? undefined) : PACK_ID,
  lifecycle_state: input.lifecycle_state ?? 'pending_confirmation',
  requested_capabilities: [],
  granted_capabilities: [],
  trust_mode: 'trusted' as const
});

const setupFixture = async () => {
  const fixture = await createIsolatedAppContextFixture();

  fixture.context.sim.getActivePack = () => ({
    metadata: { id: PACK_ID, name: 'Test Dependency Pack', version: '0.1.0' }
  }) as never;
  fixture.context.getPluginEnableWarningConfig = () => ({
    enabled: true,
    require_acknowledgement: true
  });

  return fixture;
};

// --- Dependency checking on enable ---

describe('plugin dependency check on enable', () => {
  it('blocks enable when a required interface dependency is missing', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-regex-consumer',
        plugin_id: 'plugin.regex.consumer',
        checksum: 'sha256:regex-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [{ key: 'data_cleaner.regex', optional: false }],
            plugins: []
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-regex-consumer',
        plugin_id: 'plugin.regex.consumer',
        artifact_id: 'artifact-regex-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      await expect(
        enablePackPlugin(fixture.context, 'installation-regex-consumer', {
          reminder_text_hash: REMINDER_HASH,
          actor_label: 'test'
        })
      ).rejects.toMatchObject({
        code: 'PLUGIN_DEPENDENCIES_UNSATISFIED'
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('allows enable when required interface dependency is provided', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      // Provider
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-regex-provider',
        plugin_id: 'plugin.regex.provider',
        checksum: 'sha256:regex-provider',
        manifestOverrides: { provides: [{ key: 'data_cleaner.regex', version: '1.0.0' }] }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-regex-provider',
        plugin_id: 'plugin.regex.provider',
        artifact_id: 'artifact-regex-provider',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Consumer depends on data_cleaner.regex
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-regex-consumer',
        plugin_id: 'plugin.regex.consumer',
        checksum: 'sha256:regex-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [{ key: 'data_cleaner.regex', optional: false }],
            plugins: []
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-regex-consumer',
        plugin_id: 'plugin.regex.consumer',
        artifact_id: 'artifact-regex-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Enable provider first
      await confirmPackPluginImport(fixture.context, 'installation-regex-provider', []);
      await enablePackPlugin(fixture.context, 'installation-regex-provider', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      // Consumer should now succeed
      await confirmPackPluginImport(fixture.context, 'installation-regex-consumer', []);
      const result = await enablePackPlugin(fixture.context, 'installation-regex-consumer', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      expect(result.lifecycle_state).toBe('enabled');
    } finally {
      await fixture.cleanup();
    }
  });

  it('allows enable when optional interface dependency is missing', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-optional-consumer',
        plugin_id: 'plugin.optional.consumer',
        checksum: 'sha256:optional-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [{ key: 'data_cleaner.regex', optional: true }],
            plugins: []
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-optional-consumer',
        plugin_id: 'plugin.optional.consumer',
        artifact_id: 'artifact-optional-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      await confirmPackPluginImport(fixture.context, 'installation-optional-consumer', []);
      const result = await enablePackPlugin(fixture.context, 'installation-optional-consumer', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      expect(result.lifecycle_state).toBe('enabled');
    } finally {
      await fixture.cleanup();
    }
  });

  it('blocks enable when required hard plugin dependency is missing', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-hard-consumer',
        plugin_id: 'plugin.hard.consumer',
        checksum: 'sha256:hard-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [],
            plugins: [{ plugin_id: 'plugin.nonexistent', optional: false }]
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-hard-consumer',
        plugin_id: 'plugin.hard.consumer',
        artifact_id: 'artifact-hard-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      await confirmPackPluginImport(fixture.context, 'installation-hard-consumer', []);

      await expect(
        enablePackPlugin(fixture.context, 'installation-hard-consumer', {
          reminder_text_hash: REMINDER_HASH,
          actor_label: 'test'
        })
      ).rejects.toMatchObject({
        code: 'PLUGIN_DEPENDENCIES_UNSATISFIED'
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('resolves interface dependency from a global-scope plugin', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      // Global-scope provider
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-global-provider',
        plugin_id: 'plugin.global.provider',
        checksum: 'sha256:global-provider',
        manifestOverrides: { provides: [{ key: 'data_cleaner.string', version: '1.0.0' }] }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-global-provider',
        plugin_id: 'plugin.global.provider',
        artifact_id: 'artifact-global-provider',
        scope_type: 'global',
        scope_ref: undefined,
        lifecycle_state: 'confirmed_disabled'
      }));

      // Pack-local consumer depends on the global provider
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-local-consumer',
        plugin_id: 'plugin.local.consumer',
        checksum: 'sha256:local-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [{ key: 'data_cleaner.string', optional: false }],
            plugins: []
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-local-consumer',
        plugin_id: 'plugin.local.consumer',
        artifact_id: 'artifact-local-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Enable global provider
      await confirmPackPluginImport(fixture.context, 'installation-global-provider', []);
      await enablePackPlugin(fixture.context, 'installation-global-provider', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      // Local consumer sees the global provider
      await confirmPackPluginImport(fixture.context, 'installation-local-consumer', []);
      const result = await enablePackPlugin(fixture.context, 'installation-local-consumer', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      expect(result.lifecycle_state).toBe('enabled');
    } finally {
      await fixture.cleanup();
    }
  });
});

// --- Reverse dependency check on disable ---

describe('plugin reverse dependency check on disable', () => {
  it('warns but allows disable when dependents exist (non-strict mode)', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      // Provider
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-disable-provider',
        plugin_id: 'plugin.disable.provider',
        checksum: 'sha256:disable-provider',
        manifestOverrides: { provides: [{ key: 'data_cleaner.test', version: '1.0.0' }] }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-disable-provider',
        plugin_id: 'plugin.disable.provider',
        artifact_id: 'artifact-disable-provider',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Hard-dependent consumer
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-disable-consumer',
        plugin_id: 'plugin.disable.consumer',
        checksum: 'sha256:disable-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [],
            plugins: [{ plugin_id: 'plugin.disable.provider', optional: false }]
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-disable-consumer',
        plugin_id: 'plugin.disable.consumer',
        artifact_id: 'artifact-disable-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Enable both
      await confirmPackPluginImport(fixture.context, 'installation-disable-provider', []);
      await enablePackPlugin(fixture.context, 'installation-disable-provider', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      await confirmPackPluginImport(fixture.context, 'installation-disable-consumer', []);
      await enablePackPlugin(fixture.context, 'installation-disable-consumer', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      // Disable provider — succeeds with warning (non-strict default)
      const result = await disablePackPlugin(fixture.context, 'installation-disable-provider');
      expect(result.lifecycle_state).toBe('disabled');
    } finally {
      await fixture.cleanup();
    }
  });

  it('blocks disable when strict mode is on and dependents exist', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      // Provider
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-strict-provider',
        plugin_id: 'plugin.strict.provider',
        checksum: 'sha256:strict-provider',
        manifestOverrides: { provides: [{ key: 'data_cleaner.test', version: '1.0.0' }] }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-strict-provider',
        plugin_id: 'plugin.strict.provider',
        artifact_id: 'artifact-strict-provider',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Consumer with hard dep
      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-strict-consumer',
        plugin_id: 'plugin.strict.consumer',
        checksum: 'sha256:strict-consumer',
        manifestOverrides: {
          dependencies: {
            interfaces: [],
            plugins: [{ plugin_id: 'plugin.strict.provider', optional: false }]
          }
        }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-strict-consumer',
        plugin_id: 'plugin.strict.consumer',
        artifact_id: 'artifact-strict-consumer',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Enable both
      await confirmPackPluginImport(fixture.context, 'installation-strict-provider', []);
      await enablePackPlugin(fixture.context, 'installation-strict-provider', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      await confirmPackPluginImport(fixture.context, 'installation-strict-consumer', []);
      await enablePackPlugin(fixture.context, 'installation-strict-consumer', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      // Enable strict mode by setting the config property directly
      const { getRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const depConfig = getRuntimeConfig().plugins.dependency as { strict: boolean };
      const originalStrict = depConfig.strict;
      depConfig.strict = true;

      try {
        await expect(
          disablePackPlugin(fixture.context, 'installation-strict-provider')
        ).rejects.toMatchObject({
          code: 'PLUGIN_HAS_DEPENDENTS'
        });
      } finally {
        depConfig.strict = originalStrict;
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it('allows disable when no dependents exist', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-solo',
        plugin_id: 'plugin.solo',
        checksum: 'sha256:solo'
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-solo',
        plugin_id: 'plugin.solo',
        artifact_id: 'artifact-solo',
        lifecycle_state: 'confirmed_disabled'
      }));

      await confirmPackPluginImport(fixture.context, 'installation-solo', []);
      await enablePackPlugin(fixture.context, 'installation-solo', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      const result = await disablePackPlugin(fixture.context, 'installation-solo');
      expect(result.lifecycle_state).toBe('disabled');
    } finally {
      await fixture.cleanup();
    }
  });
});

// --- Load ordering in runtime ---

describe('plugin load order in runtime', () => {
  it('loads plugins sorted by priority', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-low',
        plugin_id: 'plugin.low',
        checksum: 'sha256:low',
        manifestOverrides: { load: { priority: 10, after: [] } }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-low',
        plugin_id: 'plugin.low',
        artifact_id: 'artifact-low',
        lifecycle_state: 'confirmed_disabled'
      }));

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-high',
        plugin_id: 'plugin.high',
        checksum: 'sha256:high',
        manifestOverrides: { load: { priority: 100, after: [] } }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-high',
        plugin_id: 'plugin.high',
        artifact_id: 'artifact-high',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Enable both
      await confirmPackPluginImport(fixture.context, 'installation-low', []);
      await enablePackPlugin(fixture.context, 'installation-low', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      await confirmPackPluginImport(fixture.context, 'installation-high', []);
      await enablePackPlugin(fixture.context, 'installation-high', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      await refreshActivePackPluginRuntime(fixture.context);

      const runtimes = pluginRuntimeRegistry.listRuntimes(PACK_ID);
      expect(runtimes).toHaveLength(2);
      expect(runtimes[0].manifest.id).toBe('plugin.high');
      expect(runtimes[1].manifest.id).toBe('plugin.low');
    } finally {
      await fixture.cleanup();
    }
  });

  it('respects after constraint over priority', async () => {
    const fixture = await setupFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-base',
        plugin_id: 'plugin.base',
        checksum: 'sha256:base',
        manifestOverrides: { load: { priority: 10, after: [] } }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-base',
        plugin_id: 'plugin.base',
        artifact_id: 'artifact-base',
        lifecycle_state: 'confirmed_disabled'
      }));

      await store.upsertArtifact(createArtifact({
        artifact_id: 'artifact-after-base',
        plugin_id: 'plugin.after-base',
        checksum: 'sha256:after-base',
        manifestOverrides: { load: { priority: 100, after: ['plugin.base'] } }
      }));

      await store.upsertInstallation(createInstall({
        installation_id: 'installation-after-base',
        plugin_id: 'plugin.after-base',
        artifact_id: 'artifact-after-base',
        lifecycle_state: 'confirmed_disabled'
      }));

      // Enable both
      await confirmPackPluginImport(fixture.context, 'installation-base', []);
      await enablePackPlugin(fixture.context, 'installation-base', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      await confirmPackPluginImport(fixture.context, 'installation-after-base', []);
      await enablePackPlugin(fixture.context, 'installation-after-base', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'test'
      });

      await refreshActivePackPluginRuntime(fixture.context);

      const runtimes = pluginRuntimeRegistry.listRuntimes(PACK_ID);
      expect(runtimes).toHaveLength(2);
      expect(runtimes[0].manifest.id).toBe('plugin.base');
      expect(runtimes[1].manifest.id).toBe('plugin.after-base');
    } finally {
      await fixture.cleanup();
    }
  });
});
