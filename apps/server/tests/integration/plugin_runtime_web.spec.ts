import { describe, expect, it } from 'vitest';

import { getActivePackPluginRuntimeWebSnapshot, resolveEnabledPluginWebAsset } from '../../src/app/services/plugin_runtime_web.js';
import { confirmPackPluginImport, enablePackPlugin } from '../../src/app/services/plugins.js';
import { PLUGIN_ENABLE_WARNING_TEXT } from '../../src/plugins/contracts.js';
import { refreshActivePackPluginRuntime } from '../../src/plugins/runtime.js';
import { createPluginStore } from '../../src/plugins/store.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const REMINDER_HASH = '7d49285e1f5f5893e35c1c8b3446c97f5d0b3d4c0f3d8c7f60ef7e0df63951a4';

describe('plugin runtime web integration', () => {
  it('returns canonical bundle URLs and resolves enabled plugin web assets after confirm/enable', async () => {
    const fixture = await createIsolatedAppContextFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });
      const artifact = await store.upsertArtifact({
        artifact_id: 'artifact-alpha',
        plugin_id: 'plugin.alpha',
        version: '0.1.0',
        manifest_version: 'plugin/v1',
        source_type: 'bundled_by_pack',
        source_pack_id: 'world-pack-alpha',
        source_path: 'templates/world-pack',
        checksum: 'sha256:plugin-alpha',
        manifest_json: {
          manifest_version: 'plugin/v1',
          id: 'plugin.alpha',
          name: 'Plugin Alpha',
          version: '0.1.0',
          kind: 'operator',
          entrypoints: {
            web: {
              runtime: 'browser_esm',
              dist: 'death_note.README.md'
            }
          },
          compatibility: {
            yidhras: '>=0.5.0',
            pack_id: 'world-pack-alpha'
          },
          requested_capabilities: ['web.panel.register'],
          contributions: {
            server: {
              context_sources: [],
              prompt_workflow_steps: [],
              intent_grounders: [],
              pack_projections: [],
              api_routes: []
            },
            web: {
              panels: [{ target: 'operator.pack_overview', panel_id: 'alpha_panel' }],
              routes: ['/packs/world-pack-alpha/plugins/plugin.alpha/demo'],
              menu_items: []
            }
          }
        },
        imported_at: '1000'
      });

      await store.upsertInstallation({
        installation_id: 'installation-alpha',
        plugin_id: artifact.plugin_id,
        artifact_id: artifact.artifact_id,
        version: artifact.version,
        scope_type: 'pack_local',
        scope_ref: 'world-pack-alpha',
        lifecycle_state: 'pending_confirmation',
        requested_capabilities: ['web.panel.register'],
        granted_capabilities: [],
        trust_mode: 'trusted'
      });

      fixture.context.sim.getActivePack = () => ({
        metadata: { id: 'world-pack-alpha', name: 'World Pack Alpha', version: '0.1.0' }
      }) as never;
      fixture.context.getPluginEnableWarningConfig = () => ({
        enabled: true,
        require_acknowledgement: true
      });

      await confirmPackPluginImport(fixture.context, 'installation-alpha', ['web.panel.register']);
      await enablePackPlugin(fixture.context, 'installation-alpha', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'integration'
      });
      await refreshActivePackPluginRuntime(fixture.context);

      const runtimeSnapshot = await getActivePackPluginRuntimeWebSnapshot(fixture.context, 'world-pack-alpha');
      expect(runtimeSnapshot.plugins).toHaveLength(1);
      expect(runtimeSnapshot.plugins[0]?.web_bundle_url).toBe(
        '/api/packs/world-pack-alpha/plugins/plugin.alpha/runtime/web/installation-alpha/death_note.README.md'
      );
      expect(runtimeSnapshot.plugins[0]?.runtime_module.format).toBe('browser_esm');

      const asset = await resolveEnabledPluginWebAsset(fixture.context, {
        pack_id: 'world-pack-alpha',
        plugin_id: 'plugin.alpha',
        installation_id: 'installation-alpha',
        asset_path: 'death_note.README.md'
      });

      expect(asset.relative_path).toBe('death_note.README.md');
      expect(asset.absolute_path.endsWith('apps/server/templates/world-pack/death_note.README.md')).toBe(true);
      expect(PLUGIN_ENABLE_WARNING_TEXT).toContain('With great power comes great responsibility');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects web asset resolution when installation is not enabled', async () => {
    const fixture = await createIsolatedAppContextFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });
      await store.upsertArtifact({
        artifact_id: 'artifact-beta',
        plugin_id: 'plugin.beta',
        version: '0.1.0',
        manifest_version: 'plugin/v1',
        source_type: 'bundled_by_pack',
        source_pack_id: 'world-pack-alpha',
        source_path: 'templates/world-pack',
        checksum: 'sha256:plugin-beta',
        manifest_json: {
          manifest_version: 'plugin/v1',
          id: 'plugin.beta',
          name: 'Plugin Beta',
          version: '0.1.0',
          kind: 'operator',
          entrypoints: {
            web: {
              runtime: 'browser_esm',
              dist: 'death_note.README.md'
            }
          },
          compatibility: {
            yidhras: '>=0.5.0',
            pack_id: 'world-pack-alpha'
          },
          requested_capabilities: ['web.panel.register'],
          contributions: {
            server: {
              context_sources: [],
              prompt_workflow_steps: [],
              intent_grounders: [],
              pack_projections: [],
              api_routes: []
            },
            web: {
              panels: [],
              routes: [],
              menu_items: []
            }
          }
        },
        imported_at: '1000'
      });

      await store.upsertInstallation({
        installation_id: 'installation-beta',
        plugin_id: 'plugin.beta',
        artifact_id: 'artifact-beta',
        version: '0.1.0',
        scope_type: 'pack_local',
        scope_ref: 'world-pack-alpha',
        lifecycle_state: 'confirmed_disabled',
        requested_capabilities: ['web.panel.register'],
        granted_capabilities: ['web.panel.register'],
        trust_mode: 'trusted',
        confirmed_at: '1500'
      });

      await expect(
        resolveEnabledPluginWebAsset(fixture.context, {
          pack_id: 'world-pack-alpha',
          plugin_id: 'plugin.beta',
          installation_id: 'installation-beta',
          asset_path: 'death_note.README.md'
        })
      ).rejects.toMatchObject({
        code: 'PLUGIN_WEB_ASSET_NOT_ENABLED'
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
