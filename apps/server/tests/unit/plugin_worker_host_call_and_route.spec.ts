import type { WorldStateQuery } from '@yidhras/contracts';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import { pluginRuntimeServerRoutes } from '../../src/app/routes/plugin_runtime_server.js';
import { getRuntimeConfig } from '../../src/config/runtime_config.js';
import { PLUGIN_CAPABILITY_KEY } from '../../src/plugins/capability_keys.js';
import { pluginRuntimeRegistry, type RegisteredServerPluginRuntime } from '../../src/plugins/runtime.js';
import type { WorkerPackRouteProxy } from '../../src/plugins/worker/contribution_proxy.js';
import { PluginWorkerTimeoutError } from '../../src/plugins/worker/errors.js';
import { handlePluginWorkerHostCall } from '../../src/plugins/worker/host_call_handler.js';
import { pluginWorkerManager } from '../../src/plugins/worker/PluginWorkerManager.js';

const packId = 'worker-route-pack';
const installationId = 'installation-worker-route';
const pluginId = 'plugin.worker.route';

const servers: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const server of servers.splice(0, servers.length)) {
    server.close();
  }
  pluginRuntimeRegistry.clearRuntimes(packId);
  await pluginWorkerManager.replacePackWorkers(packId, []);
});

const createRouteRuntime = (route: WorkerPackRouteProxy): RegisteredServerPluginRuntime => ({
  installation_id: installationId,
  plugin_id: pluginId,
  pack_id: packId,
  manifest: {
    manifest_version: 'plugin/v1',
    id: pluginId,
    name: 'Plugin Worker Route',
    version: '0.1.0',
    kind: 'ui_panel',
    entrypoints: {},
    compatibility: { yidhras: '>=0.5.0', host_api: '1.0.0', pack_id: packId },
    requested_capabilities: [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER],
    contributions: {
      server: {
        context_sources: [],
        prompt_workflow_steps: [],
        api_routes: [{ name: 'route', priority: 0, path: '/hello', method: 'GET', invoke: 'route' }],
        step_contributors: [],
        rule_contributors: [],
        query_contributors: [],
        data_cleaners: [],
        slot_condition_evaluators: [],
        slot_content_transformers: [],
        perception_resolvers: []
      },
      web: { panels: [], routes: [], menu_items: [] }
    }
  },
  granted_capabilities: [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER],
  context_sources: [],
  prompt_workflow_steps: [],
  pack_routes: [route],
  step_contributors: [],
  rule_contributors: [],
  query_contributors: [],
  perception_resolvers: [],
  contribution_descriptors: [],
  handler_names: ['route'],
  worker_client: { isAlive: () => true } as never
});

const request = async (app: express.Express, path: string): Promise<{ status: number; body: unknown }> => {
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind a TCP port');
  }
  const response = await fetch(`http://127.0.0.1:${String(address.port)}${path}`);
  return { status: response.status, body: await response.json() };
};

describe('plugin Worker host_call boundary', () => {
  it('denies requestInference without server.inference.request capability', async () => {
    await expect(handlePluginWorkerHostCall({
      appContext: {} as AppContext,
      packId,
      pluginId,
      installationId,
      grantedCapabilities: []
    }, 'requestInference', {
      purpose: 'test',
      systemPrompt: 'system',
      userPrompt: 'user'
    })).rejects.toMatchObject({
      status: 403,
      code: 'PLUGIN_CAPABILITY_DENIED'
    });
  });

  it('allows requestInference only through the host-provided executor', async () => {
    const requestPluginInference = vi.fn(async () => ({
      content: 'ok',
      usage: { inputTokens: 1, outputTokens: 2 }
    }));

    await expect(handlePluginWorkerHostCall({
      appContext: { requestPluginInference } as unknown as AppContext,
      packId,
      pluginId,
      installationId,
      grantedCapabilities: [PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST]
    }, 'requestInference', {
      purpose: 'test',
      systemPrompt: 'system',
      userPrompt: 'user'
    })).resolves.toMatchObject({ content: 'ok' });

    expect(requestPluginInference).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'test' }));
  });

  it('denies queryWorldState for a different pack id', async () => {
    const query: WorldStateQuery = {
      protocol_version: 'world_engine/v1alpha1',
      pack_id: 'other-pack',
      query_name: 'pack_summary',
      selector: {}
    };

    await expect(handlePluginWorkerHostCall({
      appContext: {} as AppContext,
      packId,
      pluginId,
      installationId,
      grantedCapabilities: []
    }, 'queryWorldState', query)).rejects.toMatchObject({
      status: 403,
      code: 'PLUGIN_PACK_SCOPE_DENIED'
    });
  });
  it('returns null for emitLog host call', async () => {
    await expect(handlePluginWorkerHostCall({
      appContext: {} as AppContext,
      packId,
      pluginId,
      installationId,
      grantedCapabilities: []
    }, 'emitLog', { level: 'info', message: 'test' })).resolves.toBeNull();
  });

  it('rejects unknown host methods at the protocol schema layer', async () => {
    const { hostMethodNameSchema } = await import('../../src/plugins/worker/protocol.js');

    expect(() => hostMethodNameSchema.parse('dangerousEscalation')).toThrow();
    expect(() => hostMethodNameSchema.parse('')).toThrow();
    expect(hostMethodNameSchema.parse('emitLog')).toBe('emitLog');
  });
});

describe('plugin runtime server route host', () => {
  it('invokes matching Worker route proxies through the fixed route host', async () => {
    const handle = vi.fn(async payload => ({ ok: true, payload }));
    const route = {
      method: 'GET',
      path: '/hello',
      name: 'route',
      handle
    } as unknown as WorkerPackRouteProxy;
    pluginRuntimeRegistry.replaceRuntimes(packId, [createRouteRuntime(route)]);

    const app = express();
    app.use(express.json());
    pluginRuntimeServerRoutes.register(app, {} as AppContext);

    const response = await request(
      app,
      `/api/packs/${packId}/plugins/${pluginId}/runtime/server/${installationId}/routes/hello?name=Ada`
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/hello',
      query: expect.objectContaining({ name: 'Ada' })
    }), getRuntimeConfig().plugins.isolation.route_timeout_ms);
  });

  const jsonErrorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
    const candidate = err as { status?: number; code?: string; message?: string };
    res.status(candidate.status ?? 500).json({
      code: candidate.code ?? 'INTERNAL_ERROR',
      message: candidate.message ?? String(err)
    });
  };

  it('returns 404 when route path is not declared for the runtime', async () => {
    const route = {
      method: 'GET',
      path: '/hello',
      name: 'route',
      handle: vi.fn()
    } as unknown as WorkerPackRouteProxy;
    pluginRuntimeRegistry.replaceRuntimes(packId, [createRouteRuntime(route)]);

    const app = express();
    app.use(express.json());
    pluginRuntimeServerRoutes.register(app, {} as AppContext);
    app.use(jsonErrorHandler);

    const response = await request(
      app,
      `/api/packs/${packId}/plugins/${pluginId}/runtime/server/${installationId}/routes/missing`
    );

    expect(response).toMatchObject({
      status: 404,
      body: { code: 'PLUGIN_ROUTE_NOT_FOUND' }
    });
  });

  it('maps Worker route timeout errors to 504', async () => {
    const route = {
      method: 'GET',
      path: '/hello',
      name: 'route',
      handle: vi.fn(async () => {
        throw new PluginWorkerTimeoutError('route timed out');
      })
    } as unknown as WorkerPackRouteProxy;
    pluginRuntimeRegistry.replaceRuntimes(packId, [createRouteRuntime(route)]);

    const app = express();
    app.use(express.json());
    pluginRuntimeServerRoutes.register(app, {} as AppContext);
    app.use(jsonErrorHandler);

    const response = await request(
      app,
      `/api/packs/${packId}/plugins/${pluginId}/runtime/server/${installationId}/routes/hello`
    );

    expect(response).toMatchObject({
      status: 504,
      body: { code: 'PLUGIN_ROUTE_TIMEOUT' }
    });
  });
});
