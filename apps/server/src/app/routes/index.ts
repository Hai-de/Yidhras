import type { RouteModule } from './types.js';

// -- Re-export all global route modules ----------------------------------------
export { configRoutes } from './config.js';
export { configBackupRoutes } from './config_backup.js';
export { experimentalRuntimeRoutes } from './experimental_runtime.js';
export { openApiRoute } from './openapi.js';
export { agentBindingRoutes } from './operator_agent_bindings.js';
export { operatorAuditRoutes } from './operator_audit.js';
export { operatorAuthRoutes } from './operator_auth.js';
export { grantRoutes } from './operator_grants.js';
export { packBindingRoutes } from './operator_pack_bindings.js';
export { operatorRoutes } from './operators.js';
export { pluginRuntimeServerRoutes } from './plugin_runtime_server.js';
export { pluginRuntimeWebRoutes } from './plugin_runtime_web.js';
export { pluginRoutes } from './plugins.js';
export { systemRoutes } from './system.js';

// -- Factory-based routes (need construction-time parameters) -------------------
export { createPackActionsRoute } from './pack_actions.js';
export { createPackFrontendAssetRoutes } from './pack_frontend_assets.js';
export { createPackListRoutes } from './packs.js';

// -- Auto-collection -----------------------------------------------------------
import * as self from './index.js';

function isRouteModule(v: unknown): v is RouteModule {
  return typeof v === 'object' && v !== null && 'register' in v;
}

/** All standard global RouteModules — register in order before /:packId middleware */
export const allGlobalRoutes: RouteModule[] = Object.values(self).filter(isRouteModule);
