import fs from 'fs';
import path from 'path';

import {
  getPreferredWorldPack,
  getRuntimeConfigMetadata,
  getWorldPacksDir,
  logRuntimeConfigSnapshot,
  resolveWorkspacePath
} from '../config/runtime_config.js';
import {
  buildRuntimeConfigScaffoldReport,
  buildRuntimeMetadataReport,
  buildWorldPackBootstrapReport,
  printInitReport
} from './report.js';
import { ensureRuntimeConfigScaffold,logRuntimeConfigScaffoldResult } from './runtime_scaffold.js';
import { ensureBootstrapWorldPack, logWorldPackBootstrapResult } from './world_pack_bootstrap.js';

const parseOpeningCliArg = (argv: string[]): string | undefined => {
  const openingIndex = argv.indexOf('--opening');
  if (openingIndex >= 0 && openingIndex + 1 < argv.length) {
    const candidate = argv[openingIndex + 1];
    if (candidate && !candidate.startsWith('--')) {
      return candidate;
    }
  }
  return undefined;
};

const writeStartupOpeningMarker = (openingId: string): void => {
  const runtimeDir = resolveWorkspacePath('data/runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const markerPath = path.join(runtimeDir, 'startup_opening.txt');
  fs.writeFileSync(markerPath, openingId, 'utf-8');
};

const main = async (): Promise<void> => {
  const openingId = parseOpeningCliArg(process.argv.slice(2));
  if (openingId) {
    writeStartupOpeningMarker(openingId);
    console.log(`[init:runtime] Opening set via CLI: ${openingId}`);
  }

  const scaffoldResult = ensureRuntimeConfigScaffold();
  logRuntimeConfigScaffoldResult(scaffoldResult);
  logRuntimeConfigSnapshot();

  const bootstrapResult = await ensureBootstrapWorldPack();
  logWorldPackBootstrapResult(bootstrapResult);

  printInitReport({
    kind: 'runtime',
    timestamp: new Date().toISOString(),
    runtime: buildRuntimeMetadataReport(getRuntimeConfigMetadata(), {
      worldPacksDir: getWorldPacksDir(),
      preferredWorldPack: getPreferredWorldPack()
    }),
    scaffold: buildRuntimeConfigScaffoldReport(scaffoldResult),
    world_pack_bootstrap: buildWorldPackBootstrapReport(bootstrapResult)
  });
};

void main();
