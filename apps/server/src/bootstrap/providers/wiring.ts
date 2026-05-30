import { MultiPackLoopHost } from '../../app/runtime/MultiPackLoopHost.js';
import type { WorldEngineSidecarClient } from '../../app/runtime/sidecar/world_engine_sidecar_client.js';
import { TOKENS } from '../tokens.js';

export const wiringProvider = {
  provide: TOKENS.wiring,
  deps: [
    TOKENS.sim,
    TOKENS.worldEngine,
    TOKENS.inferenceService,
    TOKENS.appContext,
    TOKENS.cliConfig
  ] as const,
  useFactory: (deps) => {
    // 1. sim.setWorldEngine
    deps.sim.setWorldEngine(deps.worldEngine);

    // 2. 构造 MultiPackLoopHost 并绑定到 sim
    const multiPackLoopHost = new MultiPackLoopHost({
      context: deps.appContext,
      inferenceService: deps.inferenceService,
      decisionWorkerId: deps.cliConfig.decisionWorkerId,
      actionDispatcherWorkerId: deps.cliConfig.actionDispatcherWorkerId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- WorldEnginePort narrowed to sidecar client for MultiPackLoopHost
      worldEngine: deps.worldEngine as WorldEngineSidecarClient,
      intervalMs: deps.cliConfig.simulationLoopIntervalMs
    });
    deps.sim.setMultiPackLoopHost(multiPackLoopHost);

    return { multiPackLoopHost };
  }
} as const satisfies import('../provider.js').ServiceProvider;
