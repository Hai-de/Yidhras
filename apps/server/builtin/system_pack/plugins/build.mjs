import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverPlugins } from './plugin_common.mjs';

const pluginsRoot = dirname(fileURLToPath(import.meta.url));
const plugins = discoverPlugins(pluginsRoot);
const watchMode = process.argv.includes('--watch');

function createBuildOptions(plugin) {
  return {
    entryPoints: [plugin.serverPath],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: plugin.outfile,
    external: ['node:*', '@yidhras/contracts'],
    sourcemap: true,
    logLevel: 'error'
  };
}

async function buildPlugin(plugin) {
  console.log(`Building ${plugin.id} -> ${plugin.outfile}`);
  await esbuild.build(createBuildOptions(plugin));

  if (!existsSync(plugin.outfile)) {
    throw new Error(`${plugin.id}: esbuild completed but output file is missing: ${plugin.outfile}`);
  }

  console.log(`Built ${plugin.id}`);
}

if (watchMode) {
  const contexts = [];

  try {
    for (const plugin of plugins) {
      console.log(`Watching ${plugin.id} -> ${plugin.outfile}`);
      const context = await esbuild.context(createBuildOptions(plugin));
      await context.watch();
      contexts.push(context);
    }

    console.log(`Watching ${plugins.length} plugin(s)`);
  } catch (error) {
    for (const context of contexts) {
      await context.dispose();
    }
    throw error;
  }
} else {
  const results = await Promise.allSettled(plugins.map((plugin) => buildPlugin(plugin)));
  const failures = results.filter((result) => result.status === 'rejected');

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure.reason);
    }
    process.exit(1);
  }

  console.log(`Built ${plugins.length} plugin(s)`);
}
