import type { PluginInstallation, PluginManifest } from '@yidhras/contracts';
import path from 'path';
import YAML from 'yaml';

import { ApiError } from '../utils/api_error.js';
import { safeFs } from '../utils/safe_fs.js';

// --- Semver helpers (minimal, no external deps) ---

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/;

const parseSemver = (version: string): SemverParts | null => {
  const match = version.trim().match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ''
  };
};

const compareSemver = (a: SemverParts, b: SemverParts): number => {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return a.prerelease.localeCompare(b.prerelease);
};

const matchesVersion = (actual: string, constraint: string): boolean => {
  const trimmed = constraint.trim();

  if (trimmed === '*') return true;

  const actualParts = parseSemver(actual);
  if (!actualParts) return false;

  if (trimmed.startsWith('>=')) {
    const target = parseSemver(trimmed.slice(2));
    return target ? compareSemver(actualParts, target) >= 0 : false;
  }

  if (trimmed.startsWith('<=')) {
    const target = parseSemver(trimmed.slice(2));
    return target ? compareSemver(actualParts, target) <= 0 : false;
  }

  if (trimmed.startsWith('>')) {
    const target = parseSemver(trimmed.slice(1));
    return target ? compareSemver(actualParts, target) > 0 : false;
  }

  if (trimmed.startsWith('<')) {
    const target = parseSemver(trimmed.slice(1));
    return target ? compareSemver(actualParts, target) < 0 : false;
  }

  if (trimmed.startsWith('^')) {
    const target = parseSemver(trimmed.slice(1));
    if (!target) return false;
    return (
      actualParts.major === target.major &&
      compareSemver(actualParts, target) >= 0
    );
  }

  if (trimmed.startsWith('~')) {
    const target = parseSemver(trimmed.slice(1));
    if (!target) return false;
    return (
      actualParts.major === target.major &&
      actualParts.minor === target.minor &&
      compareSemver(actualParts, target) >= 0
    );
  }

  const target = parseSemver(trimmed);
  return target ? compareSemver(actualParts, target) === 0 : false;
};

// --- Load ordering ---

export interface PackLoadOrderConfig {
  order: string[];
}

export interface LoadOrderInput {
  installations: PluginInstallation[];
  manifests: Map<string, PluginManifest>;
  packOrderConfig?: PackLoadOrderConfig | null;
}

export interface DependencyCheckInput {
  installation: PluginInstallation;
  manifest: PluginManifest;
  enabledInstallations: PluginInstallation[];
  enabledManifests: Map<string, PluginManifest>;
}

export interface DependencyCheckResult {
  satisfied: boolean;
  missingHardDeps: { plugin_id: string; version?: string; required_by: string }[];
  missingInterfaceDeps: { key: string; version?: string; required_by: string }[];
  missingOptionalDeps: { key: string; version?: string }[];
}

/**
 * Topological sort resolving load order from:
 * 1. Pack-level order.yaml (highest priority)
 * 2. Manifest load.priority (secondary)
 * 3. Manifest load.after constraints
 * 4. Discovery order (fallback — preserves input order)
 */
export const resolveLoadOrder = (input: LoadOrderInput): PluginInstallation[] => {
  const { installations, manifests, packOrderConfig } = input;

  if (installations.length <= 1) return [...installations];

  const packOrderIndex = new Map<string, number>();
  if (packOrderConfig) {
    for (let i = 0; i < packOrderConfig.order.length; i++) {
      packOrderIndex.set(packOrderConfig.order[i], i);
    }
  }

  // Build adjacency for load.after: after[B] means B must load before this plugin
  // Edge direction: dependency (B) → dependent (A)
  const edges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const inst of installations) {
    const id = inst.plugin_id;
    if (!edges.has(id)) edges.set(id, []);
    if (!inDegree.has(id)) inDegree.set(id, 0);
  }

  for (const inst of installations) {
    const manifest = manifests.get(inst.installation_id);
    const afterList = manifest?.load?.after ?? [];

    for (const afterId of afterList) {
      if (!edges.has(afterId)) continue;
      const deps = edges.get(afterId)!;

      if (!deps.includes(inst.plugin_id)) {
        deps.push(inst.plugin_id);
        inDegree.set(inst.plugin_id, (inDegree.get(inst.plugin_id) ?? 0) + 1);
      }
    }
  }

  // Detect cycles via standard Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Sort queue by priority descending, then by pack order, then alphabetically
    queue.sort((a, b) => {
      const packOrderA = packOrderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
      const packOrderB = packOrderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (packOrderA !== packOrderB) return packOrderA - packOrderB;

      const manifestA = [...manifests.values()].find(m => m.id === a);
      const manifestB = [...manifests.values()].find(m => m.id === b);
      const priorityA = manifestA?.load?.priority ?? 0;
      const priorityB = manifestB?.load?.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;

      return a.localeCompare(b);
    });

    const current = queue.shift()!;
    sorted.push(current);

    for (const dependent of edges.get(current) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== installations.length) {
    const remaining = installations.filter(i => !sorted.includes(i.plugin_id));
    throw new ApiError(
      400,
      'PLUGIN_LOAD_CYCLE_DETECTED',
      'Circular dependency detected in plugin load order',
      { cycle_plugins: remaining.map(i => i.plugin_id) }
    );
  }

  return sorted.map(id => installations.find(i => i.plugin_id === id)!);
};

/**
 * Check whether a plugin's dependencies are satisfied by the currently
 * enabled installations in the same pack.
 */
export const checkDependencies = (input: DependencyCheckInput): DependencyCheckResult => {
  const { installation, manifest, enabledInstallations, enabledManifests } = input;

  const result: DependencyCheckResult = {
    satisfied: true,
    missingHardDeps: [],
    missingInterfaceDeps: [],
    missingOptionalDeps: []
  };

  const deps = manifest.dependencies ?? { interfaces: [], plugins: [] };

  // Build a map of provided interfaces: key → [{ plugin_id, version }]
  const providedInterfaces = new Map<string, { plugin_id: string; version: string }[]>();
  for (const enabledInst of enabledInstallations) {
    const m = enabledManifests.get(enabledInst.installation_id);
    if (!m || !m.provides) continue;

    for (const p of m.provides) {
      const providers = providedInterfaces.get(p.key) ?? [];
      providers.push({ plugin_id: m.id, version: p.version });
      providedInterfaces.set(p.key, providers);
    }
  }

  // Check hard plugin dependencies
  for (const dep of deps.plugins ?? []) {
    const enabled = enabledInstallations.find(i => i.plugin_id === dep.plugin_id);

    if (!enabled) {
      if (dep.optional) {
        result.missingOptionalDeps.push({
          key: dep.plugin_id,
          version: dep.version
        });
      } else {
        result.satisfied = false;
        result.missingHardDeps.push({
          plugin_id: dep.plugin_id,
          version: dep.version,
          required_by: installation.plugin_id
        });
      }
      continue;
    }

    if (dep.version) {
      const enabledManifest = enabledManifests.get(enabled.installation_id);
      const actualVersion = enabledManifest?.version ?? enabled.version;

      if (!matchesVersion(actualVersion, dep.version)) {
        if (dep.optional) {
          result.missingOptionalDeps.push({
            key: dep.plugin_id,
            version: dep.version
          });
        } else {
          result.satisfied = false;
          result.missingHardDeps.push({
            plugin_id: dep.plugin_id,
            version: dep.version,
            required_by: installation.plugin_id
          });
        }
      }
    }
  }

  // Check interface dependencies
  for (const dep of deps.interfaces ?? []) {
    const providers = providedInterfaces.get(dep.key) ?? [];

    if (providers.length === 0) {
      if (dep.optional) {
        result.missingOptionalDeps.push({
          key: dep.key,
          version: dep.version
        });
      } else {
        result.satisfied = false;
        result.missingInterfaceDeps.push({
          key: dep.key,
          version: dep.version,
          required_by: installation.plugin_id
        });
      }
      continue;
    }

    if (dep.version) {
      const matchingProvider = providers.find(p => matchesVersion(p.version, dep.version!));

      if (!matchingProvider) {
        if (dep.optional) {
          result.missingOptionalDeps.push({
            key: dep.key,
            version: dep.version
          });
        } else {
          result.satisfied = false;
          result.missingInterfaceDeps.push({
            key: dep.key,
            version: dep.version,
            required_by: installation.plugin_id
          });
        }
      }
    }
  }

  return result;
};

/**
 * Find all enabled plugins that have a hard dependency on the given plugin.
 * Used to warn/block when disabling a plugin.
 */
export const checkReverseDependencies = (
  pluginId: string,
  enabledInstallations: PluginInstallation[],
  enabledManifests: Map<string, PluginManifest>
): string[] => {
  const dependents: string[] = [];

  for (const inst of enabledInstallations) {
    if (inst.plugin_id === pluginId) continue;

    const manifest = enabledManifests.get(inst.installation_id);
    if (!manifest?.dependencies?.plugins) continue;

    for (const dep of manifest.dependencies.plugins) {
      if (dep.plugin_id === pluginId && !dep.optional) {
        dependents.push(inst.plugin_id);
        break;
      }
    }
  }

  return dependents;
};

// --- Pack-level order.yaml reading ---

const ORDER_CONFIG_PATH = 'plugins/order.yaml';

export const readPackOrderConfig = (packRootDir: string): PackLoadOrderConfig | null => {
  const orderPath = path.join(packRootDir, ORDER_CONFIG_PATH);
  if (!safeFs.existsSync(packRootDir, orderPath)) {
    return null;
  }

  try {
    const content = safeFs.readFileSync(packRootDir, orderPath, 'utf-8');
    const parsed = YAML.parse(content) as Record<string, unknown> | null;

    if (!parsed || !Array.isArray(parsed.order)) {
      return null;
    }

    return { order: parsed.order as string[] };
  } catch {
    return null;
  }
};
