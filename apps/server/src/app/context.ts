/**
 * @deprecated 导入角色接口请使用 './context/index.js'。
 * 此文件保留向后兼容的 re-export。Phase 11 移除。
 */
import type { DataContext } from './context/data_context.js';
import type { PortContext } from './context/port_context.js';
import type { RuntimeContext } from './context/runtime_context.js';

export type { DataContext } from './context/data_context.js';
export type {
  RuntimeContext,
  NotificationStore,
  StartupHealth,
  RuntimeLoopDiagnostics
} from './context/runtime_context.js';
export type { HealthLevel } from './context/runtime_context.js';
export type { PortContext } from './context/port_context.js';
export type { AppContext, RouteRegistrar } from './context/app_context.js';

/**
 * @deprecated 使用 DataContext、RuntimeContext、PortContext 代替。
 * AppInfrastructure 是过渡类型，将在 Phase 11 移除。
 */
export type AppInfrastructure = DataContext &
  RuntimeContext &
  Pick<PortContext, 'conversationStore' | 'requestPluginInference' | 'pluginRuntime'>;
