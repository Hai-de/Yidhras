import { createWorldEngineSidecarClient } from '../../app/runtime/sidecar/world_engine_sidecar_client.js';
import { getWorldEngineConfig } from '../../config/runtime_config.js';
import { TOKENS } from '../tokens.js';

export const worldEngineProvider = {
  provide: TOKENS.worldEngine,
  useFactory: () => {
    const config = getWorldEngineConfig();
    return createWorldEngineSidecarClient({
      binaryPath: config.binary_path,
      timeoutMs: config.timeout_ms,
      autoRestart: config.auto_restart
    });
  }
} as const satisfies import('../provider.js').ServiceProvider;
