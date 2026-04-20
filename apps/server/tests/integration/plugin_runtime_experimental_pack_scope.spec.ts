import { describe, expect, it } from 'vitest';

import { loadExperimentalPackRuntime } from '../../src/app/services/experimental_multi_pack_runtime.js';
import { getExperimentalPackPluginRuntimeWebSnapshot } from '../../src/app/services/plugin_runtime_web.js';
import { confirmPackPluginImport, enablePackPlugin } from '../../src/app/services/plugins.js';
import { pluginRuntimeRegistry } from '../../src/plugins/runtime.js';
import { createPluginStore } from '../../src/plugins/store.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const REMINDER_HASH = '03ee763729f5fe81f03478a3b0f487ff6c8dfc779f7e9b8d88a6d016dc17edfb';

describe('plugin runtime experimental pack scope integration', () => {
  it('loads pack-local plugin runtime for an experimentally loaded pack without changing active-pack stable mode', async () => {
    const fixture = await createIsolatedAppContextFixture();

    try {
      const store = createPluginStore({ prisma: fixture.prisma });
      await store.upsertArtifact({
        artifact_id: 'artifact-experimental-alpha',
        plugin_id: 'plugin.experimental.alpha',
        version: '0.1.0',
        manifest_version: 'plugin/v1',
        source_type: 'bundled_by_pack',
        source_pack_id: 'world-pack-experimental',
        source_path: 'templates/world-pack',
        checksum: 'sha256:plugin-experimental-alpha',
        manifest_json: {
          manifest_version: 'plugin/v1',
          id: 'plugin.experimental.alpha',
          name: 'Plugin Experimental Alpha',
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
            pack_id: 'world-pack-experimental'
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
              panels: [{ target: 'operator.pack_overview', panel_id: 'experimental_alpha_panel' }],
              routes: ['/packs/world-pack-experimental/plugins/plugin.experimental.alpha/demo'],
              menu_items: []
            }
          }
        },
        imported_at: '1000'
      });

      await store.upsertInstallation({
        installation_id: 'installation-experimental-alpha',
        plugin_id: 'plugin.experimental.alpha',
        artifact_id: 'artifact-experimental-alpha',
        version: '0.1.0',
        scope_type: 'pack_local',
        scope_ref: 'world-pack-experimental',
        lifecycle_state: 'pending_confirmation',
        requested_capabilities: ['web.panel.register'],
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
      fixture.context.sim.isExperimentalMultiPackRuntimeEnabled = () => true;
      fixture.context.sim.loadExperimentalPackRuntime = async () => ({
        handle: {
          pack_id: 'world-pack-experimental',
          pack_folder_name: 'world-pack-experimental',
          pack: {
            metadata: { id: 'world-pack-experimental', name: 'World Pack Experimental', version: '0.1.0' }
          }
        } as never,
        loaded: true,
        already_loaded: false
      });
      fixture.context.sim.getPackRuntimeHandle = (packId: string) => {
        return packId === 'world-pack-experimental'
          ? ({
              pack_id: 'world-pack-experimental'
            } as never)
          : null;
      };

      await confirmPackPluginImport(fixture.context, 'installation-experimental-alpha', ['web.panel.register']);
      await enablePackPlugin(fixture.context, 'installation-experimental-alpha', {
        reminder_text_hash: REMINDER_HASH,
        actor_label: 'integration'
      });

      await loadExperimentalPackRuntime(fixture.context, 'world-pack-experimental');

      const snapshot = await getExperimentalPackPluginRuntimeWebSnapshot(fixture.context, 'world-pack-experimental');
      expect(snapshot.pack_id).toBe('world-pack-experimental');
      expect(snapshot.plugins).toHaveLength(1);
      expect(snapshot.plugins[0]?.pack_id).toBe('world-pack-experimental');
      expect(pluginRuntimeRegistry.listRuntimes('world-pack-experimental')).toHaveLength(1);
      expect(fixture.context.sim.getActivePack()?.metadata.id).toBe('world-pack-runtime');
    } finally {
      await fixture.cleanup();
    }
  });
});
