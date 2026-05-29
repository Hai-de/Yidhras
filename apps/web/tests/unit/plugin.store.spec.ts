import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { normalizePluginRuntimeModule, usePluginRuntimeStore } from '../../stores/plugins';
import type { PluginWebManifestSnapshot } from '../../composables/api/usePluginApi';

function expectDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
}

describe('normalizePluginRuntimeModule', () => {
  it('returns empty panels and routes for non-object input', () => {
    expect(normalizePluginRuntimeModule(null)).toEqual({ panels: [], routes: [] });
    expect(normalizePluginRuntimeModule(undefined)).toEqual({ panels: [], routes: [] });
    expect(normalizePluginRuntimeModule('string')).toEqual({ panels: [], routes: [] });
    expect(normalizePluginRuntimeModule(42)).toEqual({ panels: [], routes: [] });
  });

  it('returns empty panels and routes when input has no panels or routes', () => {
    expect(normalizePluginRuntimeModule({})).toEqual({ panels: [], routes: [] });
  });

  it('normalizes valid panels', () => {
    const result = normalizePluginRuntimeModule({
      panels: [
        { target: 'sidebar', panel_id: 'panel-1', component: 'comp1' },
        { target: 'main', panel_id: 'panel-2', component: 'comp2' }
      ]
    });
    const panels = result.panels ?? [];
    expect(panels).toHaveLength(2);
    expectDefined(panels[0]);
    expect(panels[0]).toEqual({ target: 'sidebar', panel_id: 'panel-1', component: 'comp1' });
  });

  it('filters panels with empty target or panel_id', () => {
    const result = normalizePluginRuntimeModule({
      panels: [
        { target: '', panel_id: 'panel-1', component: 'comp1' },
        { target: 'sidebar', panel_id: '', component: 'comp2' },
        { target: 'sidebar', panel_id: 'panel-3', component: 'comp3' }
      ]
    });
    const panels = result.panels ?? [];
    expect(panels).toHaveLength(1);
    expectDefined(panels[0]);
    expect(panels[0].panel_id).toBe('panel-3');
  });

  it('filters non-record panel items', () => {
    const result = normalizePluginRuntimeModule({
      panels: [null, 42, { target: 'sidebar', panel_id: 'panel-1', component: 'comp1' }]
    });
    expect(result.panels ?? []).toHaveLength(1);
  });

  it('normalizes valid routes', () => {
    const result = normalizePluginRuntimeModule({
      routes: [
        { route_path: '/plugin/page', component: 'routeComp' }
      ]
    });
    const routes = result.routes ?? [];
    expect(routes).toHaveLength(1);
    expectDefined(routes[0]);
    expect(routes[0]).toEqual({ route_path: '/plugin/page', component: 'routeComp' });
  });

  it('filters routes with empty route_path', () => {
    const result = normalizePluginRuntimeModule({
      routes: [
        { route_path: '', component: 'comp1' },
        { route_path: '/valid', component: 'comp2' }
      ]
    });
    const routes = result.routes ?? [];
    expect(routes).toHaveLength(1);
    expectDefined(routes[0]);
    expect(routes[0].route_path).toBe('/valid');
  });
});

describe('usePluginRuntimeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const makePlugin = (installationId: string, pluginId = 'plugin-1'): PluginWebManifestSnapshot => ({
    installation_id: installationId,
    plugin_id: pluginId,
    pack_id: 'pack-1',
    web_bundle_url: null,
    runtime_module: { format: 'browser_esm', export_name: 'default', panel_export: 'panels', route_export: 'routes' },
    contributions: { panels: [], routes: [], menu_items: [] }
  });

  describe('initial state', () => {
    it('starts with null runtime', () => {
      const store = usePluginRuntimeStore();
      expect(store.runtime).toBeNull();
      expect(store.isFetching).toBe(false);
      expect(store.errorMessage).toBeNull();
      expect(store.lastSyncedAt).toBeNull();
      expect(store.bundleStates).toEqual({});
    });
  });

  describe('applyRuntime', () => {
    it('sets runtime and lastSyncedAt', () => {
      const store = usePluginRuntimeStore();
      const snapshot = {
        pack_id: 'pack-1',
        plugins: [makePlugin('inst-1')]
      };
      store.applyRuntime(snapshot as never);
      expect(store.runtime).toStrictEqual(snapshot);
      expect(store.lastSyncedAt).toBeGreaterThan(0);
    });

    it('creates bundle state for new plugins', () => {
      const store = usePluginRuntimeStore();
      store.applyRuntime({
        pack_id: 'pack-1',
        plugins: [makePlugin('inst-1')]
      } as never);
      expect(store.bundleStates['inst-1']).toBeDefined();
      expectDefined(store.bundleStates['inst-1']);
      expect(store.bundleStates['inst-1'].status).toBe('idle');
    });

    it('removes bundle states for plugins no longer in snapshot', () => {
      const store = usePluginRuntimeStore();
      store.applyRuntime({
        pack_id: 'pack-1',
        plugins: [makePlugin('inst-1'), makePlugin('inst-2')]
      } as never);
      expect(store.bundleStates['inst-1']).toBeDefined();
      expect(store.bundleStates['inst-2']).toBeDefined();

      store.applyRuntime({
        pack_id: 'pack-1',
        plugins: [makePlugin('inst-1')]
      } as never);
      expect(store.bundleStates['inst-1']).toBeDefined();
      expect(store.bundleStates['inst-2']).toBeUndefined();
    });

    it('preserves existing bundle states', () => {
      const store = usePluginRuntimeStore();
      store.applyRuntime({
        pack_id: 'pack-1',
        plugins: [makePlugin('inst-1')]
      } as never);
      store.markBundleLoading(makePlugin('inst-1'));
      expectDefined(store.bundleStates['inst-1']);
      expect(store.bundleStates['inst-1'].status).toBe('loading');

      store.applyRuntime({
        pack_id: 'pack-1',
        plugins: [makePlugin('inst-1')]
      } as never);
      expectDefined(store.bundleStates['inst-1']);
      expect(store.bundleStates['inst-1'].status).toBe('loading');
    });
  });

  describe('setFetching', () => {
    it('sets fetching state', () => {
      const store = usePluginRuntimeStore();
      store.setFetching(true);
      expect(store.isFetching).toBe(true);
      store.setFetching(false);
      expect(store.isFetching).toBe(false);
    });
  });

  describe('setErrorMessage', () => {
    it('sets error message', () => {
      const store = usePluginRuntimeStore();
      store.setErrorMessage('Something went wrong');
      expect(store.errorMessage).toBe('Something went wrong');
      store.setErrorMessage(null);
      expect(store.errorMessage).toBeNull();
    });
  });

  describe('markBundleLoading', () => {
    it('sets bundle state to loading', () => {
      const store = usePluginRuntimeStore();
      store.markBundleLoading(makePlugin('inst-1', 'plugin-a'));
      expectDefined(store.bundleStates['inst-1']);
      expect(store.bundleStates['inst-1'].status).toBe('loading');
      expect(store.bundleStates['inst-1'].plugin_id).toBe('plugin-a');
    });

    it('clears error message on loading', () => {
      const store = usePluginRuntimeStore();
      store.markBundleError(makePlugin('inst-1'), 'old error');
      store.markBundleLoading(makePlugin('inst-1'));
      expectDefined(store.bundleStates['inst-1']);
      expect(store.bundleStates['inst-1'].error_message).toBeNull();
    });
  });

  describe('markBundleLoaded', () => {
    it('sets bundle state to loaded with normalized module', () => {
      const store = usePluginRuntimeStore();
      store.markBundleLoaded(makePlugin('inst-1', 'plugin-a'), {
        panels: [{ target: 'sidebar', panel_id: 'p1', component: 'comp1' }],
        routes: [{ route_path: '/page', component: 'route1' }]
      });
      const state = store.bundleStates['inst-1'];
      expect(state).toBeDefined();
      expect(state!.status).toBe('loaded');
      expect(state!.loaded_at).toBeGreaterThan(0);
      expect(state!.panels).toHaveLength(1);
      expect(state!.panels![0]!.target).toBe('sidebar');
      expect(state!.routes).toHaveLength(1);
    });
  });

  describe('markBundleError', () => {
    it('sets bundle state to error', () => {
      const store = usePluginRuntimeStore();
      store.markBundleError(makePlugin('inst-1', 'plugin-a'), 'Load failed');
      const state = store.bundleStates['inst-1'];
      expect(state).toBeDefined();
      expect(state!.status).toBe('error');
      expect(state!.error_message).toBe('Load failed');
      expect(state!.panels).toEqual([]);
      expect(state!.routes).toEqual([]);
    });
  });

  describe('getters', () => {
    it('panelPlugins filters by target', () => {
      const store = usePluginRuntimeStore();
      store.applyRuntime({
        pack_id: 'pack-1',
        plugins: [
          {
            installation_id: 'inst-1',
            plugin_id: 'p1',
            manifest: { id: 'p1', version: '1', name: 'P1', description: '', entry: '', contributions: { panels: [{ target: 'sidebar', panel_id: 'panel-a' }], routes: [] } },
            contributions: { panels: [{ target: 'sidebar', panel_id: 'panel-a' }], routes: [] }
          },
          {
            installation_id: 'inst-2',
            plugin_id: 'p2',
            manifest: { id: 'p2', version: '1', name: 'P2', description: '', entry: '', contributions: { panels: [{ target: 'main', panel_id: 'panel-b' }], routes: [] } },
            contributions: { panels: [{ target: 'main', panel_id: 'panel-b' }], routes: [] }
          }
        ]
      } as never);
      const sidebarPlugins = store.panelPlugins('sidebar');
      expect(sidebarPlugins).toHaveLength(1);
      expect(sidebarPlugins[0]!.installation_id).toBe('inst-1');
    });

    it('resolvedPanels filters by target', () => {
      const store = usePluginRuntimeStore();
      store.markBundleLoaded(makePlugin('inst-1'), {
        panels: [
          { target: 'sidebar', panel_id: 'p1', component: 'c1' },
          { target: 'main', panel_id: 'p2', component: 'c2' }
        ]
      });
      const sidebarPanels = store.resolvedPanels('sidebar');
      expect(sidebarPanels).toHaveLength(1);
      expect(sidebarPanels[0]!.panel_id).toBe('p1');
    });

    it('resolvedRoute finds route by path', () => {
      const store = usePluginRuntimeStore();
      store.markBundleLoaded(makePlugin('inst-1'), {
        routes: [{ route_path: '/plugin/page', component: 'comp' }]
      });
      expect(store.resolvedRoute('/plugin/page')).not.toBeNull();
      expect(store.resolvedRoute('/other')).toBeNull();
    });

    it('bundleState returns state by installation id', () => {
      const store = usePluginRuntimeStore();
      store.markBundleLoading(makePlugin('inst-1'));
      expect(store.bundleState('inst-1')).not.toBeNull();
      expect(store.bundleState('nonexistent')).toBeNull();
    });
  });
});
