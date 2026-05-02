import { describe, expect, it } from 'vitest';

import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';

import {
  checkDependencies,
  checkReverseDependencies,
  resolveLoadOrder
} from '../../src/plugins/dependency_resolver.js';

const makeInstallation = (overrides: Partial<PluginInstallation> = {}): PluginInstallation =>
  ({
    installation_id: 'inst-1',
    plugin_id: 'test-plugin',
    artifact_id: 'artifact-1',
    version: '1.0.0',
    scope_type: 'pack_local',
    scope_ref: 'test-pack',
    lifecycle_state: 'enabled',
    requested_capabilities: [],
    granted_capabilities: [],
    trust_mode: 'trusted',
    ...overrides
  }) as PluginInstallation;

const makeManifest = (overrides: Partial<PluginManifest> = {}): PluginManifest =>
  ({
    manifest_version: 'plugin/v1',
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    kind: 'test',
    compatibility: {
      yidhras: '>=0.1.0',
      pack_id: 'test-pack'
    },
    entrypoints: {},
    requested_capabilities: [],
    contributions: {
      server: {},
      web: {}
    },
    load: { priority: 0, after: [] },
    dependencies: { interfaces: [], plugins: [] },
    provides: [],
    ...overrides
  }) as PluginManifest;

// --- resolveLoadOrder ---

describe('resolveLoadOrder', () => {
  it('returns empty array for empty input', () => {
    expect(resolveLoadOrder({ installations: [], manifests: new Map() })).toEqual([]);
  });

  it('returns single installation unchanged', () => {
    const inst = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const manifest = makeManifest({ id: 'plugin-a' });
    const manifests = new Map([[inst.installation_id, manifest]]);

    expect(resolveLoadOrder({ installations: [inst], manifests })).toEqual([inst]);
  });

  it('sorts by priority descending', () => {
    const a = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const b = makeInstallation({ installation_id: 'b', plugin_id: 'plugin-b' });
    const manifestA = makeManifest({ id: 'plugin-a', load: { priority: 10, after: [] } });
    const manifestB = makeManifest({ id: 'plugin-b', load: { priority: 100, after: [] } });
    const manifests = new Map([
      [a.installation_id, manifestA],
      [b.installation_id, manifestB]
    ]);

    const result = resolveLoadOrder({ installations: [a, b], manifests });
    expect(result[0].plugin_id).toBe('plugin-b');
    expect(result[1].plugin_id).toBe('plugin-a');
  });

  it('respects after constraints', () => {
    const a = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const b = makeInstallation({ installation_id: 'b', plugin_id: 'plugin-b' });
    const c = makeInstallation({ installation_id: 'c', plugin_id: 'plugin-c' });
    // c declares after: [a] — a must load before c
    const manifestA = makeManifest({ id: 'plugin-a', load: { priority: 0, after: [] } });
    const manifestB = makeManifest({ id: 'plugin-b', load: { priority: 0, after: [] } });
    const manifestC = makeManifest({ id: 'plugin-c', load: { priority: 100, after: ['plugin-a'] } });
    const manifests = new Map([
      [a.installation_id, manifestA],
      [b.installation_id, manifestB],
      [c.installation_id, manifestC]
    ]);

    const result = resolveLoadOrder({ installations: [a, b, c], manifests });
    // a must come before c despite c having higher priority
    const aIndex = result.findIndex(i => i.plugin_id === 'plugin-a');
    const cIndex = result.findIndex(i => i.plugin_id === 'plugin-c');
    expect(aIndex).toBeLessThan(cIndex);
  });

  it('throws on cycle detection', () => {
    const a = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const b = makeInstallation({ installation_id: 'b', plugin_id: 'plugin-b' });
    const manifestA = makeManifest({ id: 'plugin-a', load: { priority: 0, after: ['plugin-b'] } });
    const manifestB = makeManifest({ id: 'plugin-b', load: { priority: 0, after: ['plugin-a'] } });
    const manifests = new Map([
      [a.installation_id, manifestA],
      [b.installation_id, manifestB]
    ]);

    expect(() =>
      resolveLoadOrder({ installations: [a, b], manifests })
    ).toThrow(/circular/i);
  });

  it('uses pack order config as highest priority', () => {
    const a = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const b = makeInstallation({ installation_id: 'b', plugin_id: 'plugin-b' });
    const manifestA = makeManifest({ id: 'plugin-a', load: { priority: 100, after: [] } });
    const manifestB = makeManifest({ id: 'plugin-b', load: { priority: 0, after: [] } });
    const manifests = new Map([
      [a.installation_id, manifestA],
      [b.installation_id, manifestB]
    ]);

    const result = resolveLoadOrder({
      installations: [a, b],
      manifests,
      packOrderConfig: { order: ['plugin-b', 'plugin-a'] }
    });
    // pack order overrides priority
    expect(result[0].plugin_id).toBe('plugin-b');
    expect(result[1].plugin_id).toBe('plugin-a');
  });
});

// --- checkDependencies ---

describe('checkDependencies', () => {
  it('reports satisfied when no dependencies declared', () => {
    const inst = makeInstallation();
    const manifest = makeManifest();
    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [],
      enabledManifests: new Map()
    });

    expect(result.satisfied).toBe(true);
  });

  it('reports missing hard plugin dependency', () => {
    const inst = makeInstallation({ plugin_id: 'plugin-a' });
    const manifest = makeManifest({
      id: 'plugin-a',
      dependencies: {
        interfaces: [],
        plugins: [{ plugin_id: 'plugin-b', optional: false }]
      }
    });

    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [],
      enabledManifests: new Map()
    });

    expect(result.satisfied).toBe(false);
    expect(result.missingHardDeps).toHaveLength(1);
    expect(result.missingHardDeps[0].plugin_id).toBe('plugin-b');
  });

  it('allows optional hard dep to be missing', () => {
    const inst = makeInstallation({ plugin_id: 'plugin-a' });
    const manifest = makeManifest({
      id: 'plugin-a',
      dependencies: {
        interfaces: [],
        plugins: [{ plugin_id: 'plugin-b', optional: true }]
      }
    });

    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [],
      enabledManifests: new Map()
    });

    expect(result.satisfied).toBe(true);
    expect(result.missingOptionalDeps).toHaveLength(1);
  });

  it('reports missing interface dependency', () => {
    const inst = makeInstallation({ plugin_id: 'plugin-a' });
    const manifest = makeManifest({
      id: 'plugin-a',
      dependencies: {
        interfaces: [{ key: 'data_cleaner.regex', optional: false }],
        plugins: []
      }
    });

    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [],
      enabledManifests: new Map()
    });

    expect(result.satisfied).toBe(false);
    expect(result.missingInterfaceDeps).toHaveLength(1);
    expect(result.missingInterfaceDeps[0].key).toBe('data_cleaner.regex');
  });

  it('resolves interface dependency from another plugin', () => {
    const inst = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const manifest = makeManifest({
      id: 'plugin-a',
      dependencies: {
        interfaces: [{ key: 'data_cleaner.regex', optional: false }],
        plugins: []
      }
    });

    const provider = makeInstallation({ installation_id: 'b', plugin_id: 'regex-engine' });
    const providerManifest = makeManifest({
      id: 'regex-engine',
      provides: [{ key: 'data_cleaner.regex', version: '1.0.0' }]
    });

    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [provider],
      enabledManifests: new Map([[provider.installation_id, providerManifest]])
    });

    expect(result.satisfied).toBe(true);
  });

  it('checks version constraint on interface dependency', () => {
    const inst = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const manifest = makeManifest({
      id: 'plugin-a',
      dependencies: {
        interfaces: [{ key: 'data_cleaner.regex', version: '>=2.0.0', optional: false }],
        plugins: []
      }
    });

    const provider = makeInstallation({ installation_id: 'b', plugin_id: 'regex-engine' });
    const providerManifest = makeManifest({
      id: 'regex-engine',
      provides: [{ key: 'data_cleaner.regex', version: '1.0.0' }]
    });

    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [provider],
      enabledManifests: new Map([[provider.installation_id, providerManifest]])
    });

    expect(result.satisfied).toBe(false);
    expect(result.missingInterfaceDeps).toHaveLength(1);
  });

  it('satisfies version constraint with matching version', () => {
    const inst = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const manifest = makeManifest({
      id: 'plugin-a',
      dependencies: {
        interfaces: [{ key: 'data_cleaner.regex', version: '>=1.0.0', optional: false }],
        plugins: []
      }
    });

    const provider = makeInstallation({ installation_id: 'b', plugin_id: 'regex-engine' });
    const providerManifest = makeManifest({
      id: 'regex-engine',
      provides: [{ key: 'data_cleaner.regex', version: '2.0.0' }]
    });

    const result = checkDependencies({
      installation: inst,
      manifest,
      enabledInstallations: [provider],
      enabledManifests: new Map([[provider.installation_id, providerManifest]])
    });

    expect(result.satisfied).toBe(true);
  });
});

// --- checkReverseDependencies ---

describe('checkReverseDependencies', () => {
  it('returns empty when no plugins depend on the target', () => {
    const a = makeInstallation({ installation_id: 'a', plugin_id: 'plugin-a' });
    const manifestA = makeManifest({ id: 'plugin-a' });

    const result = checkReverseDependencies('plugin-a', [a], new Map([[a.installation_id, manifestA]]));
    expect(result).toEqual([]);
  });

  it('finds plugins that have a hard dependency on the target', () => {
    const target = makeInstallation({ installation_id: 'target', plugin_id: 'target-plugin' });
    const dependent = makeInstallation({ installation_id: 'dep', plugin_id: 'dependent-plugin' });
    const targetManifest = makeManifest({ id: 'target-plugin' });
    const dependentManifest = makeManifest({
      id: 'dependent-plugin',
      dependencies: {
        interfaces: [],
        plugins: [{ plugin_id: 'target-plugin', optional: false }]
      }
    });

    const result = checkReverseDependencies(
      'target-plugin',
      [target, dependent],
      new Map([
        [target.installation_id, targetManifest],
        [dependent.installation_id, dependentManifest]
      ])
    );

    expect(result).toEqual(['dependent-plugin']);
  });

  it('ignores optional hard dependencies', () => {
    const target = makeInstallation({ installation_id: 'target', plugin_id: 'target-plugin' });
    const dependent = makeInstallation({ installation_id: 'dep', plugin_id: 'dependent-plugin' });
    const targetManifest = makeManifest({ id: 'target-plugin' });
    const dependentManifest = makeManifest({
      id: 'dependent-plugin',
      dependencies: {
        interfaces: [],
        plugins: [{ plugin_id: 'target-plugin', optional: true }]
      }
    });

    const result = checkReverseDependencies(
      'target-plugin',
      [target, dependent],
      new Map([
        [target.installation_id, targetManifest],
        [dependent.installation_id, dependentManifest]
      ])
    );

    expect(result).toEqual([]);
  });
});
