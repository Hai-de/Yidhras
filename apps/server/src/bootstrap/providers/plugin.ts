 
import { createMemoryBehaviorStateStore, setBehaviorStateStore } from '../../app/behavior_state_store.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

/**
 * pluginRuntimeControl、pluginAiTaskService、requestPluginInference 与 AppContext
 * 存在循环依赖，已内联到 context.ts 的 appContextProvider 工厂中（Step 2 回填模式）。
 */
export const behaviorStateStoreInitProvider: ServiceProvider = {
  provide: TOKENS.behaviorStateStoreInit,
  useFactory: () => {
    setBehaviorStateStore(createMemoryBehaviorStateStore());
    return { initialized: true };
  }
};
