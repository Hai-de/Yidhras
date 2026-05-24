import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import YAML from 'yaml';

const SERVER_ENTRYPOINT_SOURCE = 'dist/server.js';

function readYamlFile(path) {
  const content = readFileSync(path, 'utf8');
  return YAML.parse(content);
}

function assertRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

function readPluginOrder(pluginsRoot) {
  const orderPath = join(pluginsRoot, 'order.yaml');
  if (!existsSync(orderPath)) {
    throw new Error(`Missing plugin order file: ${orderPath}`);
  }

  const document = assertRecord(readYamlFile(orderPath), orderPath);
  const order = document.order;
  if (!Array.isArray(order) || order.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`${orderPath} must contain a non-empty string array at key "order"`);
  }

  const seen = new Set();
  for (const pluginId of order) {
    if (seen.has(pluginId)) {
      throw new Error(`${orderPath} contains duplicate plugin id: ${pluginId}`);
    }
    seen.add(pluginId);
  }

  return order;
}

function readPluginManifest(manifestPath) {
  return assertRecord(readYamlFile(manifestPath), manifestPath);
}

function validatePluginManifest(pluginId, pluginDir, manifest) {
  if (manifest.id !== pluginId) {
    throw new Error(`${pluginDir}: manifest id must be "${pluginId}", got ${JSON.stringify(manifest.id)}`);
  }

  const entrypoints = assertRecord(manifest.entrypoints, `${pluginDir}/plugin.manifest.yaml entrypoints`);
  const server = assertRecord(entrypoints.server, `${pluginDir}/plugin.manifest.yaml entrypoints.server`);

  if (server.source !== SERVER_ENTRYPOINT_SOURCE) {
    throw new Error(
      `${pluginDir}: entrypoints.server.source must be "${SERVER_ENTRYPOINT_SOURCE}", got ${JSON.stringify(server.source)}`
    );
  }

  if (server.runtime !== 'node_esm') {
    throw new Error(`${pluginDir}: entrypoints.server.runtime must be "node_esm", got ${JSON.stringify(server.runtime)}`);
  }
}

function findManifestPluginDirectories(pluginsRoot) {
  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'dist')
    .map((entry) => entry.name)
    .filter((pluginId) => existsSync(join(pluginsRoot, pluginId, 'plugin.manifest.yaml')));
}

export function discoverPlugins(pluginsRoot) {
  const orderedPluginIds = readPluginOrder(pluginsRoot);
  const orderedSet = new Set(orderedPluginIds);
  const manifestPluginIds = findManifestPluginDirectories(pluginsRoot);

  for (const pluginId of manifestPluginIds) {
    if (!orderedSet.has(pluginId)) {
      throw new Error(`${pluginsRoot}: plugin directory has manifest but is missing from order.yaml: ${pluginId}`);
    }
  }

  return orderedPluginIds.map((pluginId) => {
    const pluginDir = join(pluginsRoot, pluginId);
    const manifestPath = join(pluginDir, 'plugin.manifest.yaml');
    const serverPath = join(pluginDir, 'server.ts');
    const tsconfigPath = join(pluginDir, 'tsconfig.json');
    const outfile = join(pluginDir, SERVER_ENTRYPOINT_SOURCE);

    if (!existsSync(pluginDir)) {
      throw new Error(`${pluginsRoot}: order.yaml references missing plugin directory: ${pluginId}`);
    }
    if (!existsSync(manifestPath)) {
      throw new Error(`${pluginDir}: missing plugin.manifest.yaml`);
    }
    if (!existsSync(serverPath)) {
      throw new Error(`${pluginDir}: missing server.ts`);
    }
    if (!existsSync(tsconfigPath)) {
      throw new Error(`${pluginDir}: missing tsconfig.json`);
    }

    const manifest = readPluginManifest(manifestPath);
    validatePluginManifest(pluginId, pluginDir, manifest);

    return {
      id: pluginId,
      dir: pluginDir,
      manifestPath,
      serverPath,
      tsconfigPath,
      outfile,
      label: basename(pluginDir)
    };
  });
}

export { SERVER_ENTRYPOINT_SOURCE };
