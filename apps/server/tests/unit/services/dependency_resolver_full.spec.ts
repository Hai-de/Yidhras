import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';
import { describe, expect, it } from 'vitest';

import {
  checkDependencies,
  checkReverseDependencies,
  resolveLoadOrder
} from '../../../src/plugins/dependency_resolver.js';

const makeInstallation = (overrides: Record<string, unknown> = {}): PluginInstallation => ({
  installation_id: `inst-${(overrides.plugin_id as string) ?? 'default'}`,
  plugin_id: 'plugin-a',
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixture boundary
  artifact_id: 'artifact-a' as string,
  version: '1.0.0',
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixture boundary
  scope_type: 'pack_local' as PluginInstallation['scope_type'],
  scope_ref: undefined,
  lifecycle_state: 'enabled',
  requested_capabilities: [],
  granted_capabilities: [],
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixture boundary
  trust_mode: 'permissive' as PluginInstallation['trust_mode'],
  ...overrides
});

const makeManifest = (overrides: Record<string, unknown> = {}): PluginManifest => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixture boundary
  manifest_version: 'plugin/v1' as PluginManifest['manifest_version'],
  id: 'plugin-a',
  name: 'Plugin A',
  version: '1.0.0',
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fixture boundary
  kind: 'other' as PluginManifest['kind'],
  entrypoints: { server: { runtime: 'node' as PluginManifest['entrypoints']['server'] extends { runtime: infer R } ? R : never } },
  compatibility: { yidhras: '0.1.0', host_api: '1.0.0', pack_id: 'test-pack' },
  requested_capabilities: [],
  contributions: {
    server: {
      context_sources: [],
      prompt_workflow_steps: [],
      api_routes: [],
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
  load: { priority: 0, after: [] },
  dependencies: { interfaces: [], plugins: [] },
  provides: [],
  ...overrides
});

describe('dependency_resolver', () => {
  describe('resolveLoadOrder', () => {
    it('returns empty array for empty input', () => {
      expect(resolveLoadOrder({ installations: [], manifests: new Map() })).toEqual([]);
    });

    it('returns single installation unchanged', () => {
      const inst = makeInstallation({ plugin_id: 'only' });
      const result = resolveLoadOrder({ installations: [inst], manifests: new Map() });
      expect(result).toHaveLength(1);
      expect(result[0].plugin_id).toBe('only');
    });

    it('respects load.after dependencies', () => {
      const instA = makeInstallation({ plugin_id: 'a', installation_id: 'inst-a' });
      const instB = makeInstallation({ plugin_id: 'b', installation_id: 'inst-b' });
      const manifests = new Map([
        ['inst-a', makeManifest({ id: 'a', load: { after: ['b'] } })],
        ['inst-b', makeManifest({ id: 'b' })]
      ]);

      const result = resolveLoadOrder({ installations: [instA, instB], manifests });
      // b should come before a
      expect(result[0].plugin_id).toBe('b');
      expect(result[1].plugin_id).toBe('a');
    });

    it('respects pack order config', () => {
      const instA = makeInstallation({ plugin_id: 'a', installation_id: 'inst-a' });
      const instB = makeInstallation({ plugin_id: 'b', installation_id: 'inst-b' });
      const manifests = new Map([
        ['inst-a', makeManifest({ id: 'a' })],
        ['inst-b', makeManifest({ id: 'b' })]
      ]);

      const result = resolveLoadOrder({
        installations: [instA, instB],
        manifests,
        packOrderConfig: { order: ['b', 'a'] }
      });
      expect(result[0].plugin_id).toBe('b');
      expect(result[1].plugin_id).toBe('a');
    });

    it('detects circular dependencies', () => {
      const instA = makeInstallation({ plugin_id: 'a', installation_id: 'inst-a' });
      const instB = makeInstallation({ plugin_id: 'b', installation_id: 'inst-b' });
      const manifests = new Map([
        ['inst-a', makeManifest({ id: 'a', load: { after: ['b'] } })],
        ['inst-b', makeManifest({ id: 'b', load: { after: ['a'] } })]
      ]);

      expect(() => resolveLoadOrder({ installations: [instA, instB], manifests }))
        .toThrow(/Circular dependency/);
    });
  });

  describe('checkDependencies', () => {
    it('returns satisfied when no dependencies', () => {
      const result = checkDependencies({
        installation: makeInstallation({ plugin_id: 'test' }),
        manifest: makeManifest({ id: 'test' }),
        enabledInstallations: [],
        enabledManifests: new Map()
      });

      expect(result.satisfied).toBe(true);
      expect(result.missingHardDeps).toEqual([]);
      expect(result.missingInterfaceDeps).toEqual([]);
      expect(result.missingOptionalDeps).toEqual([]);
    });

    it('reports missing hard plugin dependency', () => {
      const result = checkDependencies({
        installation: makeInstallation({ plugin_id: 'test' }),
        manifest: makeManifest({
          id: 'test',
          dependencies: {
            plugins: [{ plugin_id: 'dep-a', optional: false }],
            interfaces: []
          }
        }),
        enabledInstallations: [],
        enabledManifests: new Map()
      });

      expect(result.satisfied).toBe(false);
      expect(result.missingHardDeps).toHaveLength(1);
      expect(result.missingHardDeps[0].plugin_id).toBe('dep-a');
    });

    it('reports missing optional plugin dependency', () => {
      const result = checkDependencies({
        installation: makeInstallation({ plugin_id: 'test' }),
        manifest: makeManifest({
          id: 'test',
          dependencies: {
            plugins: [{ plugin_id: 'dep-a', optional: true }],
            interfaces: []
          }
        }),
        enabledInstallations: [],
        enabledManifests: new Map()
      });

      expect(result.satisfied).toBe(true);
      expect(result.missingOptionalDeps).toHaveLength(1);
      expect(result.missingOptionalDeps[0].key).toBe('dep-a');
    });

    it('satisfied when hard dependency is enabled', () => {
      const depInst = makeInstallation({ plugin_id: 'dep-a', installation_id: 'inst-dep' });
      const depManifest = makeManifest({ id: 'dep-a', version: '1.0.0' });
      const enabledManifests = new Map([['inst-dep', depManifest]]);

      const result = checkDependencies({
        installation: makeInstallation({ plugin_id: 'test' }),
        manifest: makeManifest({
          id: 'test',
          dependencies: {
            plugins: [{ plugin_id: 'dep-a', optional: false }],
            interfaces: []
          }
        }),
        enabledInstallations: [depInst],
        enabledManifests
      });

      expect(result.satisfied).toBe(true);
    });

    it('reports missing interface dependency', () => {
      const result = checkDependencies({
        installation: makeInstallation({ plugin_id: 'test' }),
        manifest: makeManifest({
          id: 'test',
          dependencies: {
            plugins: [],
            interfaces: [{ key: 'server.api_route', optional: false }]
          }
        }),
        enabledInstallations: [],
        enabledManifests: new Map()
      });

      expect(result.satisfied).toBe(false);
      expect(result.missingInterfaceDeps).toHaveLength(1);
    });

    it('satisfied when interface dependency is provided', () => {
      const providerInst = makeInstallation({ plugin_id: 'provider', installation_id: 'inst-prov' });
      const providerManifest = makeManifest({
        id: 'provider',
        version: '1.0.0',
        provides: [{ key: 'server.api_route', version: '1.0.0' }]
      });

      const result = checkDependencies({
        installation: makeInstallation({ plugin_id: 'test' }),
        manifest: makeManifest({
          id: 'test',
          dependencies: {
            plugins: [],
            interfaces: [{ key: 'server.api_route', optional: false }]
          }
        }),
        enabledInstallations: [providerInst],
        enabledManifests: new Map([['inst-prov', providerManifest]])
      });

      expect(result.satisfied).toBe(true);
    });
  });

  describe('checkReverseDependencies', () => {
    it('returns empty when no reverse deps', () => {
      const result = checkReverseDependencies('plugin-a', [], new Map());
      expect(result).toEqual([]);
    });

    it('finds plugins that depend on given plugin', () => {
      const instB = makeInstallation({ plugin_id: 'plugin-b', installation_id: 'inst-b' });
      const manifestB = makeManifest({
        id: 'plugin-b',
        dependencies: {
          plugins: [{ plugin_id: 'plugin-a', optional: false }],
          interfaces: []
        }
      });

      const result = checkReverseDependencies(
        'plugin-a',
        [instB],
        new Map([['inst-b', manifestB]])
      );

      expect(result).toEqual(['plugin-b']);
    });

    it('ignores optional dependencies', () => {
      const instB = makeInstallation({ plugin_id: 'plugin-b', installation_id: 'inst-b' });
      const manifestB = makeManifest({
        id: 'plugin-b',
        dependencies: {
          plugins: [{ plugin_id: 'plugin-a', optional: true }],
          interfaces: []
        }
      });

      const result = checkReverseDependencies(
        'plugin-a',
        [instB],
        new Map([['inst-b', manifestB]])
      );

      expect(result).toEqual([]);
    });

    it('ignores self-references', () => {
      const instA = makeInstallation({ plugin_id: 'plugin-a', installation_id: 'inst-a' });
      const manifestA = makeManifest({
        id: 'plugin-a',
        dependencies: {
          plugins: [{ plugin_id: 'plugin-a', optional: false }],
          interfaces: []
        }
      });

      const result = checkReverseDependencies(
        'plugin-a',
        [instA],
        new Map([['inst-a', manifestA]])
      );

      expect(result).toEqual([]);
    });
  });
});
