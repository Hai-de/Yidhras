import type { ConversationStore } from '../../conversation/store.js';
import type { PackRuntimeControl, PackRuntimeLookupPort, PackRuntimeObservation } from '../../core/pack_runtime_ports.js';
import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { RuntimeDatabaseBootstrap } from '../runtime/runtime_bootstrap.js';
import type { RuntimeClockProjectionService } from '../runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from '../runtime/world_engine_coordinator.js';
import type { PackHostApi, WorldEnginePort } from '../runtime/world_engine_ports.js';
import type { ContextAssemblyPort } from '../../context/ports.js';

export interface PortContext {
  readonly conversationStore: ConversationStore;

  readonly worldEngine?: WorldEnginePort;
  readonly packHostApi?: PackHostApi;
  readonly worldEngineStepCoordinator?: WorldEngineStepCoordinator;
  readonly runtimeClockProjection?: RuntimeClockProjectionService;
  readonly contextAssembly?: ContextAssemblyPort;
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
