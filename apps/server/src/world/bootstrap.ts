import { logRuntimeConfigSnapshot } from '../config/runtime_config.js';
import { ensureBootstrapWorldPack, logWorldPackBootstrapResult } from '../init/world_pack_bootstrap.js';

const main = (): void => {
  logRuntimeConfigSnapshot();
  const result = ensureBootstrapWorldPack();
  logWorldPackBootstrapResult(result);
};

main();
