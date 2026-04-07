import { logRuntimeConfigSnapshot } from '../config/runtime_config.js';
import { ensureBootstrapWorldPack, logWorldPackBootstrapResult } from '../init/world_pack_bootstrap.js';

const main = async (): Promise<void> => {
  logRuntimeConfigSnapshot();
  const result = await ensureBootstrapWorldPack();
  logWorldPackBootstrapResult(result);
};

void main();
