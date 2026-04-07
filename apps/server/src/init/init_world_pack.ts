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

const main = async (): Promise<void> => {
  logRuntimeConfigSnapshot();
  const result = await ensureBootstrapWorldPack();
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

void main();
