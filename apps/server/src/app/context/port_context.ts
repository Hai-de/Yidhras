import type { ConversationStore } from '../../conversation/store.js';
import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { PackRuntimeControl, PackRuntimeLookupPort, PackRuntimeObservation } from '../../core/pack_runtime_ports.js';
import type { RuntimeDatabaseBootstrap } from '../runtime/runtime_bootstrap.js';
import type { RuntimeClockProjectionService } from '../runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from '../runtime/world_engine_coordinator.js';
export interface PortContext {
  readonly conversationStore: ConversationStore;

  readonly worldEngine?: import('../runtime/world_engine_ports.js').WorldEnginePort;
  readonly packHostApi?: import('../runtime/world_engine_ports.js').PackHostApi;
  readonly worldEngineStepCoordinator?: WorldEngineStepCoordinator;
  readonly runtimeClockProjection?: RuntimeClockProjectionService;
  readonly contextAssembly?: import('../../context/ports.js').ContextAssemblyPort;
  readonly runtimeBootstrap?: RuntimeDatabaseBootstrap;
  readonly packRuntimeObservation?: PackRuntimeObservation;
  readonly packRuntimeControl?: PackRuntimeControl;
  readonly packRuntimeLookup?: PackRuntimeLookupPort;

  getPackRuntimeHost(packId: string): PackRuntimeHost | null;

  readonly pluginRuntime?: {
    getContextSourceAdapters(packId: string): unknown[];
    getPerceptionResolvers(packId: string): unknown[];
  };
  readonly pluginRuntimeControl?: {
    reload(packId: string): Promise<{ pack_id: string; runtime_count: number }>;
  };
  requestPluginInference?(input: import('../../plugins/types.js').PluginInferenceRequest): Promise<import('../../plugins/types.js').PluginInferenceResult>;
  getPluginEnableWarningConfig(): { enabled: boolean; require_acknowledgement: boolean };
}
