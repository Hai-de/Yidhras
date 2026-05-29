import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakePluginWorkerClient,
  resetFakeWorkerClientState
} from '../../helpers/fake_plugin_worker_client.js';

vi.mock('../../../src/plugins/worker/PluginWorkerClient.js', () => ({
  PluginWorkerClient: FakePluginWorkerClient
}));

const { PluginWorkerManager } = await import('../../../src/plugins/worker/PluginWorkerManager.js');
const { PLUGIN_CAPABILITY_KEY } = await import('../../../src/plugins/capability_keys.js');

const baseInstallation = (overrides: Partial<PluginInstallation> = {}): PluginInstallation => ({
  installation_id: 'installation-manager-test',
  plugin_id: 'plugin.manager.test',
  artifact_id: 'artifact-manager-test',
  version: '0.1.0',
  scope_type: 'pack_local',
  scope_ref: 'pack-manager-test',
  lifecycle_state: 'enabled',
  requested_capabilities: [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER],
  granted_capabilities: [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER],
  trust_mode: 'trusted',
  confirmed_at: '1000',
  enabled_at: '1001',
  disabled_at: undefined,
  last_error: undefined,
  ...overrides
});

const baseManifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
  manifest_version: 'plugin/v1',
  id: 'plugin.manager.test',
  name: 'Plugin Manager Test',
  version: '0.1.0',
  kind: 'other',
  entrypoints: {
    server: {
      runtime: 'node_esm',
      source: 'server.ts'
    }
  },
  compatibility: {
    yidhras: '>=0.5.0',
    host_api: '2.0.0',
    pack_id: 'pack-manager-test'
  },
  requested_capabilities: [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER],
  contributions: {
    server: {
      context_sources: [],
      prompt_workflow_steps: [],
      api_routes: [{ name: 'route', path: '/route', method: 'GET', invoke: 'route.handler' }],
      step_contributors: [],
      rule_contributors: [],
      query_contributors: [],
      data_cleaners: [],
      slot_condition_evaluators: [],
      slot_content_transformers: [],
      perception_resolvers: []
    },
    web: { panels: [], routes: [], menu_items: [] }
  },
  ...overrides
} as PluginManifest);

const createContext = () => {
  const sessions: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const upserts: Array<Record<string, unknown>> = [];

  return {
    context: {
      repos: {
        plugin: {
          createActivationSession: vi.fn(async input => {
            sessions.push(input as Record<string, unknown>);
          }),
          updateActivationSession: vi.fn(async (_id: string, input: Record<string, unknown>) => {
            updates.push(input);
          }),
          upsertInstallation: vi.fn(async input => {
            upserts.push(input as Record<string, unknown>);
          })
        }
      }
    },
    sessions,
    updates,
    upserts
  };
};

describe('PluginWorkerManager descriptor validation', () => {
  beforeEach(() => {
    resetFakeWorkerClientState();
  });

  it('activates when Worker descriptors match manifest and granted capabilities', async () => {
    FakePluginWorkerClient.nextSnapshot = {
      descriptors: [{
        type: 'api_route',
        name: 'route',
        invoke: 'route.handler',
        priority: 0,
        method: 'GET',
        path: '/route',
        config: {},
        capabilityKey: PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER
      }],
      loadedServer: true,
      threadId: 99
    };
    const manager = new PluginWorkerManager();
    const fixture = createContext();

    const activated = await manager.activateInstallation(fixture.context as never, {
      installation: baseInstallation(),
      manifest: baseManifest(),
      artifactRoot: '/tmp/plugin',
      entrypointPath: '/tmp/plugin/server.ts',
      packId: 'pack-manager-test',
      hostApiVersion: '2.0.0'
    });

    expect(activated.threadId).toBe(99);
    expect(activated.descriptors).toHaveLength(1);
    expect(fixture.updates.at(-1)).toMatchObject({ result: 'success' });
    expect(fixture.upserts.at(-1)).toMatchObject({ last_error: undefined });
  });

  it('rejects Worker descriptors requiring ungranted capabilities', async () => {
    FakePluginWorkerClient.nextSnapshot = {
      descriptors: [{
        type: 'api_route',
        name: 'route',
        invoke: 'route.handler',
        priority: 0,
        method: 'GET',
        path: '/route',
        config: {},
        capabilityKey: PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER
      }],
      loadedServer: true,
      threadId: 1
    };
    const manager = new PluginWorkerManager();
    const fixture = createContext();

    await expect(manager.activateInstallation(fixture.context as never, {
      installation: baseInstallation({ granted_capabilities: [] }),
      manifest: baseManifest(),
      artifactRoot: '/tmp/plugin',
      entrypointPath: '/tmp/plugin/server.ts',
      packId: 'pack-manager-test',
      hostApiVersion: '2.0.0'
    })).rejects.toThrow(/requires ungranted capability/);

    expect(FakePluginWorkerClient.calls.terminates).toContain('installation-manager-test:activation failed: Plugin descriptor api_route:route.handler requires ungranted capability: server.api_route.register');
    expect(fixture.updates.at(-1)).toMatchObject({ result: 'failed' });
    expect(fixture.upserts.at(-1)?.last_error).toContain('requires ungranted capability');
  });

  it('rejects descriptors missing manifest declarations', async () => {
    FakePluginWorkerClient.nextSnapshot = {
      descriptors: [{
        type: 'api_route',
        name: 'undeclared',
        invoke: 'undeclared.handler',
        priority: 0,
        method: 'GET',
        path: '/undeclared',
        config: {},
        capabilityKey: PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER
      }],
      loadedServer: true,
      threadId: 1
    };
    const manager = new PluginWorkerManager();
    const fixture = createContext();

    await expect(manager.activateInstallation(fixture.context as never, {
      installation: baseInstallation(),
      manifest: baseManifest(),
      artifactRoot: '/tmp/plugin',
      entrypointPath: '/tmp/plugin/server.ts',
      packId: 'pack-manager-test',
      hostApiVersion: '2.0.0'
    })).rejects.toThrow(/missing worker descriptors/);

    expect(fixture.upserts.at(-1)?.last_error).toContain('missing worker descriptors');
  });

  it('deactivates stale clients after pack worker replacement', async () => {
    const manager = new PluginWorkerManager();
    const first = new FakePluginWorkerClient({ installationId: 'old-installation' });
    const second = new FakePluginWorkerClient({ installationId: 'new-installation' });

    await manager.replacePackWorkers('pack-manager-test', [first as never]);
    await manager.replacePackWorkers('pack-manager-test', [second as never]);

    expect(FakePluginWorkerClient.calls.deactivates).toContain('old-installation');
    expect(FakePluginWorkerClient.calls.terminates).toContain('old-installation:replaced');
    expect(manager.getWorker('pack-manager-test', 'new-installation')).toBe(second);
  });
});
