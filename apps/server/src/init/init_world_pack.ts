import {
  getPreferredWorldPack,
  getRuntimeConfigMetadata,
  getWorldPacksDir,
  logRuntimeConfigSnapshot
} from '../config/runtime_config.js';
import {
  buildRuntimeMetadataReport,
  buildWorldPackBootstrapReport,
  printInitReport
} from './report.js';
import { ensureBootstrapWorldPack, logWorldPackBootstrapResult } from './world_pack_bootstrap.js';

const main = (): void => {
  logRuntimeConfigSnapshot();
  const result = ensureBootstrapWorldPack();
  logWorldPackBootstrapResult(result);
  printInitReport({
    kind: 'world_pack',
    timestamp: new Date().toISOString(),
    runtime: buildRuntimeMetadataReport(getRuntimeConfigMetadata(), {
      worldPacksDir: getWorldPacksDir(),
      preferredWorldPack: getPreferredWorldPack()
    }),
    world_pack_bootstrap: buildWorldPackBootstrapReport(result)
  });
};

main();
