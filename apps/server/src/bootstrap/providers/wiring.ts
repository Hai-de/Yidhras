/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { AppContext } from '../../app/context.js';
import { MultiPackLoopHost } from '../../app/runtime/MultiPackLoopHost.js';
import type { WorldEngineSidecarClient } from '../../app/runtime/sidecar/world_engine_sidecar_client.js';
import type { WorldEnginePort } from '../../app/runtime/world_engine_ports.js';
import type { SimulationManager } from '../../core/simulation.js';
import type { InferenceService } from '../../inference/service.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

interface CliConfig {
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  simulationLoopIntervalMs: number;
}

interface WiringDeps {
  sim: SimulationManager;
  worldEngine: WorldEnginePort;
  inferenceService: InferenceService;
  appContext: AppContext;
  cliConfig: CliConfig;
}

export const wiringProvider: ServiceProvider = {
  provide: TOKENS.wiring,
  deps: [
    TOKENS.sim,
    TOKENS.worldEngine,
    TOKENS.inferenceService,
    TOKENS.appContext,
    TOKENS.cliConfig
  ],
  useFactory: (deps) => {
    const d = deps as unknown as WiringDeps;

    // 1. sim.setWorldEngine
    d.sim.setWorldEngine(d.worldEngine);

    // 2. 构造 MultiPackLoopHost 并绑定到 sim
    const multiPackLoopHost = new MultiPackLoopHost({
      context: d.appContext,
      inferenceService: d.inferenceService,
      decisionWorkerId: d.cliConfig.decisionWorkerId,
      actionDispatcherWorkerId: d.cliConfig.actionDispatcherWorkerId,
       
      worldEngine: d.worldEngine as WorldEngineSidecarClient,
      intervalMs: d.cliConfig.simulationLoopIntervalMs
    });
    d.sim.setMultiPackLoopHost(multiPackLoopHost);

    return { multiPackLoopHost };
  }
};
