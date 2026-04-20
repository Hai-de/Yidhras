import { describe, expect, it } from 'vitest';

import { confirmPackPluginImport, disablePackPlugin, enablePackPlugin } from '../../src/app/services/plugins.js';
import { pluginRuntimeRegistry,refreshActivePackPluginRuntime } from '../../src/plugins/runtime.js';
import { createPluginStore } from '../../src/plugins/store.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const REMINDER_HASH = '03ee763729f5fe81f03478a3b0f487ff6c8dfc779f7e9b8d88a6d016dc17edfb';

describe('plugin runtime refresh integration', () => {
  it('refreshes plugin runtime registry after confirm -> enable -> disable', async () => {
    const fixture = await createIsolatedAppContextFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });
      await store.upsertArtifact({
        artifact_id: 'artifact-runtime-alpha',
        plugin_id: 'plugin.runtime.alpha',
        version: '0.1.0',
        manifest_version: 'plugin/v1',
        source_type: 'bundled_by_pack',
        source_pack_id: 'world-pack-runtime',
        source_path: 'templates/world-pack',
        checksum: 'sha256:runtime-alpha',
        manifest_json: {
          manifest_version: 'plugin/v1',
          id: 'plugin.runtime.alpha',
          name: 'Plugin Runtime Alpha',
          version: '0.1.0',
          kind: 'operator',
          entrypoints: {
            server: {
              runtime: 'node_esm',
              dist: 'dist/server/index.mjs'
            },
            web: {
              runtime: 'browser_esm',
              dist: 'death_note.README.md'
            }
          },
          compatibility: {
            yidhras: '>=0.5.0',
            pack_id: 'world-pack-runtime'
          },
          requested_capabilities: ['server.api_route.register', 'web.panel.register'],
          contributions: {
            server: {
              context_sources: [],
              prompt_workflow_steps: [],
              intent_grounders: [],
              pack_projections: [],
              api_routes: ['/api/packs/:packId/plugins/:pluginId/runtime-alpha']
            },
            web: {
              panels: [{ target: 'operator.pack_overview', panel_id: 'runtime_alpha_panel' }],
              routes: ['/packs/world-pack-runtime/plugins/plugin.runtime.alpha/runtime-alpha'],
              menu_items: []
            }
          }
        },
        imported_at: '1000'
      });

      await store.upsertInstallation({
        installation_id: 'installation-runtime-alpha',
        plugin_id: 'plugin.runtime.alpha',
        artifact_id: 'artifact-runtime-alpha',
        version: '0.1.0',
        scope_type: 'pack_local',
        scope_ref: 'world-pack-runtime',
        lifecycle_state: 'pending_confirmation',
        requested_capabilities: ['server.api_route.register', 'web.panel.register'],
        granted_capabilities: [],
        trust_mode: 'trusted'
      });

      fixture.context.sim.getActivePack = () => ({
        metadata: { id: 'world-pack-runtime', name: 'Runtime Pack', version: '0.1.0' }
      }) as never;
      fixture.context.getPluginEnableWarningConfig = () => ({
        enabled: true,
        require_acknowledgement: true
      });

      await refreshActivePackPluginRuntime(fixture.context);
      expect(pluginRuntimeRegistry.listRuntimes('world-pack-runtime')).toHaveLength(0);

      await confirmPackPluginImport(fixture.context, 'installation-runtime-alpha', ['server.api_route.register', 'web.panel.register']);
      await enablePackPlugin(fixture.context, 'installation-runtime-alpha', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'integration'
      });

      const enabledRuntimes = pluginRuntimeRegistry.listRuntimes('world-pack-runtime');
      expect(enabledRuntimes).toHaveLength(1);
      expect(enabledRuntimes[0]?.plugin_id).toBe('plugin.runtime.alpha');
      expect(enabledRuntimes[0]?.pack_routes).toHaveLength(1);

      await disablePackPlugin(fixture.context, 'installation-runtime-alpha');
      expect(pluginRuntimeRegistry.listRuntimes('world-pack-runtime')).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
