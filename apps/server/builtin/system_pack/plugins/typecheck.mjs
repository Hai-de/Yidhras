import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverPlugins } from './plugin_common.mjs';

const pluginsRoot = dirname(fileURLToPath(import.meta.url));
const plugins = discoverPlugins(pluginsRoot);

function runTypeScriptCheck(plugin) {
  return new Promise((resolve, reject) => {
    console.log(`Typechecking ${plugin.id} -> ${plugin.tsconfigPath}`);

    const child = spawn(
      process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
      ['-p', plugin.tsconfigPath, '--noEmit'],
      { stdio: 'inherit' }
    );

    child.on('error', (error) => {
      reject(new Error(`${plugin.id}: failed to start tsc: ${error.message}`));
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal !== null) {
        reject(new Error(`${plugin.id}: tsc terminated by signal ${signal}`));
        return;
      }

      reject(new Error(`${plugin.id}: tsc exited with code ${code}`));
    });
  });
}

for (const plugin of plugins) {
  await runTypeScriptCheck(plugin);
}

console.log(`Typechecked ${plugins.length} plugin(s)`);
