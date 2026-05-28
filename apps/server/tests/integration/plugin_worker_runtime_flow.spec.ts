import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmPackPluginImport, disablePackPlugin, enablePackPlugin } from '../../src/app/services/plugin/plugins.js';
import { PLUGIN_CAPABILITY_KEY } from '../../src/plugins/capability_keys.js';
import { pluginRuntimeRegistry,refreshPackPluginRuntime } from '../../src/plugins/runtime.js';
import { createPluginStore } from '../../src/plugins/store.js';
import { PluginWorkerTimeoutError } from '../../src/plugins/worker/errors.js';
import { pluginWorkerManager } from '../../src/plugins/worker/PluginWorkerManager.js';
import { expectDefined } from '../helpers/assertions.js';
import { TestKit } from '../testkit.js';

const { FakePluginWorkerClient, resetFakeState } = vi.hoisted(() => {
  const deactivates: string[] = [];
  const terminates: string[] = [];

  class FakePluginWorkerClient {
    static nextSnapshot: { descriptors: unknown[]; loadedServer: boolean; threadId: number } = {
      descriptors: [],
      loadedServer: true,
      threadId: 1
    };

    static nextActivateError: Error | null = null;

    static calls = { deactivates, terminates };

    public readonly installationId: string;
    private _alive = true;

    constructor(input: { installationId: string }) {
      this.installationId = input.installationId;
    }

    async activate() {
      if (FakePluginWorkerClient.nextActivateError) {
        throw FakePluginWorkerClient.nextActivateError;
      }
      return FakePluginWorkerClient.nextSnapshot;
    }

    async invoke() {
      return {};
    }

    async deactivate() {
      deactivates.push(this.installationId);
    }

    async terminate(reason: string) {
      this._alive = false;
      terminates.push(`${this.installationId}:${reason}`);
    }

    isAlive() {
      return this._alive;
    }
  }

  const resetFakeState = () => {
    FakePluginWorkerClient.nextSnapshot = { descriptors: [], loadedServer: true, threadId: 1 };
    FakePluginWorkerClient.nextActivateError = null;
    deactivates.length = 0;
    terminates.length = 0;
  };

  return { FakePluginWorkerClient, resetFakeState };
});

vi.mock('../../src/plugins/worker/PluginWorkerClient.js', () => ({
  PluginWorkerClient: FakePluginWorkerClient
}));

const PACK_ID = 'worker-flow-pack';
const REMINDER_HASH = '03ee763729f5fe81f03478a3b0f487ff6c8dfc779f7e9b8d88a6d016dc17edfb';

const baseArtifact = () => ({
  artifact_id: 'artifact-worker-flow',
  plugin_id: 'plugin.worker.flow',
  version: '0.1.0',
  manifest_version: 'plugin/v1' as const,
  source_type: 'bundled_by_pack' as const,
  source_pack_id: PACK_ID,
  source_path: '/tmp/plugin-worker-flow',
  checksum: 'sha256:worker-flow',
  manifest_json: {
    manifest_version: 'plugin/v1',
    id: 'plugin.worker.flow',
    name: 'Worker Flow Plugin',
    version: '0.1.0',
    kind: 'tool_provider',
    entrypoints: { server: { runtime: 'node_esm', source: 'server.ts' } },
    compatibility: { yidhras: '>=0.5.0', host_api: '2.0.0', pack_id: PACK_ID },
    requested_capabilities: [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER],
    contributions: {
      server: {
        context_sources: [],
        prompt_workflow_steps: [],
        api_routes: [],
        step_contributors: [],
        rule_contributors: [],
        query_contributors: [],
        data_cleaners: [{
          name: 'flow-cleaner',
          key: 'data_cleaner.flow',
          version: '0.1.0',
          trigger: 'on_tick',
          priority: 0,
          invoke: 'data_cleaner.flow.clean'
        }],
        slot_condition_evaluators: [],
        slot_content_transformers: [],
        perception_resolvers: []
      },
      web: { panels: [], routes: [], menu_items: [] }
    }
  },
  imported_at: '1000'
});

const baseInstallation = (overrides: Record<string, unknown> = {}) => ({
  installation_id: 'installation-worker-flow',
  plugin_id: 'plugin.worker.flow',
  artifact_id: 'artifact-worker-flow',
  version: '0.1.0',
  scope_type: 'pack_local',
  scope_ref: PACK_ID,
  lifecycle_state: 'pending_confirmation',
  requested_capabilities: [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER],
  granted_capabilities: [],
  trust_mode: 'trusted',
  ...overrides
});

const matchingDescriptor = () => ({
  type: 'data_cleaner' as const,
  name: 'flow-cleaner',
  invoke: 'data_cleaner.flow.clean',
  priority: 0,
  key: 'data_cleaner.flow',
  version: '0.1.0',
  trigger: 'on_tick' as const,
  config: {},
  capabilityKey: PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER
});

describe('plugin Worker runtime flow integration', () => {
  beforeEach(() => {
    resetFakeState();
  });

  afterEach(async () => {
    await pluginWorkerManager.replacePackWorkers(PACK_ID, []);
    pluginRuntimeRegistry.clearRuntimes(PACK_ID);
  });

  it('activates a plugin through Worker and populates registry on enable, cleans on disable', async () => {
    FakePluginWorkerClient.nextSnapshot = {
      descriptors: [matchingDescriptor()],
      loadedServer: true,
      threadId: 99
    };

    const kit = await TestKit.create();

    try {
      const store = createPluginStore({ prisma: kit.prisma });
      await store.upsertArtifact(baseArtifact());
      await store.upsertInstallation(baseInstallation());

      expectDefined(kit.context.packRuntime, 'pack runtime').getPack = () => ({
        metadata: { id: PACK_ID, name: 'Worker Flow Pack', version: '0.1.0' }
      }) as never;
      kit.context.getPluginEnableWarningConfig = () => ({
        enabled: true, require_acknowledgement: true
      });

      await refreshPackPluginRuntime(kit.context, PACK_ID);
      expect(pluginRuntimeRegistry.listRuntimes(PACK_ID)).toHaveLength(0);

      await confirmPackPluginImport(kit.context, 'installation-worker-flow',
        [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER]);
      await enablePackPlugin(kit.context, 'installation-worker-flow', {
        reminder_text_hash: REMINDER_HASH, actor_label: 'integration'
      });

      const runtimes = pluginRuntimeRegistry.listRuntimes(PACK_ID);
      expect(runtimes).toHaveLength(1);
      expect(runtimes[0]?.plugin_id).toBe('plugin.worker.flow');
      expect(runtimes[0]?.worker_client).toBeDefined();
      expect(runtimes[0]?.contribution_descriptors).toHaveLength(1);
      expect(runtimes[0]?.handler_names).toContain('data_cleaner.flow.clean');

      await disablePackPlugin(kit.context, 'installation-worker-flow');
      expect(pluginRuntimeRegistry.listRuntimes(PACK_ID)).toHaveLength(0);
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });

  it('retains old runtime when new activation fails during refresh (refresh atomicity)', async () => {
    FakePluginWorkerClient.nextSnapshot = {
      descriptors: [matchingDescriptor()],
      loadedServer: true,
      threadId: 99
    };

    const kit = await TestKit.create();

    try {
      const store = createPluginStore({ prisma: kit.prisma });
      await store.upsertArtifact(baseArtifact());
      await store.upsertInstallation(baseInstallation());

      expectDefined(kit.context.packRuntime, 'pack runtime').getPack = () => ({
        metadata: { id: PACK_ID, name: 'Worker Flow Pack', version: '0.1.0' }
      }) as never;
      kit.context.getPluginEnableWarningConfig = () => ({
        enabled: true, require_acknowledgement: true
      });

      await confirmPackPluginImport(kit.context, 'installation-worker-flow',
        [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER]);
      await enablePackPlugin(kit.context, 'installation-worker-flow', {
        reminder_text_hash: REMINDER_HASH, actor_label: 'integration'
      });

      expect(pluginRuntimeRegistry.listRuntimes(PACK_ID)).toHaveLength(1);

      // Configure next activation to fail
      FakePluginWorkerClient.nextActivateError = new PluginWorkerTimeoutError('activation timed out');

      await refreshPackPluginRuntime(kit.context, PACK_ID);

      // Old runtime must survive the failed refresh
      const runtimes = pluginRuntimeRegistry.listRuntimes(PACK_ID);
      expect(runtimes).toHaveLength(1);
      expect(runtimes[0]?.plugin_id).toBe('plugin.worker.flow');
      expect(runtimes[0]?.worker_client).toBeDefined();
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });

  it('records activation timeout as a failed session with last_error', async () => {
    FakePluginWorkerClient.nextActivateError = new PluginWorkerTimeoutError('activation timed out');

    const kit = await TestKit.create();

    try {
      const store = createPluginStore({ prisma: kit.prisma });
      await store.upsertArtifact(baseArtifact());

      await store.upsertInstallation(baseInstallation({
        lifecycle_state: 'enabled',
        granted_capabilities: [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER]
      }));

      expectDefined(kit.context.packRuntime, 'pack runtime').getPack = () => ({
        metadata: { id: PACK_ID, name: 'Worker Flow Pack', version: '0.1.0' }
      }) as never;

      await refreshPackPluginRuntime(kit.context, PACK_ID);

      expect(pluginRuntimeRegistry.listRuntimes(PACK_ID)).toHaveLength(0);

      const installation = await store.getInstallationById('installation-worker-flow');
      expectDefined(installation, 'installation');
      expect(installation.last_error).toBe('activation timed out');
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });
});
