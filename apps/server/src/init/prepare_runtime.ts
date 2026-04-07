import {
  getPreferredWorldPack,
  getRuntimeConfigMetadata,
  getWorldPacksDir,
  logRuntimeConfigSnapshot
} from '../config/runtime_config.js';
import {
  buildRuntimeConfigScaffoldReport,
  buildRuntimeMetadataReport,
  buildWorldPackBootstrapReport,
  printInitReport
} from './report.js';
import { ensureRuntimeConfigScaffold,logRuntimeConfigScaffoldResult } from './runtime_scaffold.js';
import { ensureBootstrapWorldPack, logWorldPackBootstrapResult } from './world_pack_bootstrap.js';

const main = async (): Promise<void> => {
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
