import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pluginDirs = readdirSync(__dirname, { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() &&
      !e.name.startsWith('.') &&
      e.name !== 'dist'
  )
  .map((e) => join(__dirname, e.name));

const results = await Promise.allSettled(
  pluginDirs.map(async (dir) => {
    const entry = join(dir, 'server.ts');
    const outdir = join(dir, 'dist');
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: join(outdir, 'server.js'),
      external: ['node:*', '@yidhras/contracts'],
      logLevel: 'error'
    });
    return { dir, status: 'ok' };
  })
);

const failures = results.filter((r) => r.status === 'rejected');
if (failures.length > 0) {
  for (const f of failures) {
    console.error(f.reason);
  }
  process.exit(1);
}

console.log(`Built ${results.length} plugin(s)`);
