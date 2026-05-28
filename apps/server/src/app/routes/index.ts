// -- Global route modules ------------------------------------------------------
import { configRoutes } from './config.js';
import { configBackupRoutes } from './config_backup.js';
import { experimentalRuntimeRoutes } from './experimental_runtime.js';
import { openApiRoute } from './openapi.js';
import { agentBindingRoutes } from './operator_agent_bindings.js';
import { operatorAuditRoutes } from './operator_audit.js';
import { operatorAuthRoutes } from './operator_auth.js';
import { grantRoutes } from './operator_grants.js';
import { packBindingRoutes } from './operator_pack_bindings.js';
import { operatorRoutes } from './operators.js';
import { pluginRuntimeServerRoutes } from './plugin_runtime_server.js';
import { pluginRuntimeWebRoutes } from './plugin_runtime_web.js';
import { pluginRoutes } from './plugins.js';
import { systemRoutes } from './system.js';
import type { RouteModule } from './types.js';

export {
  agentBindingRoutes,
  configBackupRoutes,
  configRoutes,
  experimentalRuntimeRoutes,
  grantRoutes,
  openApiRoute,
  operatorAuditRoutes,
  operatorAuthRoutes,
  operatorRoutes,
  packBindingRoutes,
  pluginRoutes,
  pluginRuntimeServerRoutes,
  pluginRuntimeWebRoutes,
  systemRoutes
};

// -- Factory-based routes (need construction-time parameters) -------------------
export { createPackActionsRoute } from './pack_actions.js';
export { createPackFrontendAssetRoutes } from './pack_frontend_assets.js';
export { createPackListRoutes } from './packs.js';

/** All standard global RouteModules — register in order before /:packId middleware */
export const allGlobalRoutes: RouteModule[] = [
  configRoutes,
  configBackupRoutes,
  experimentalRuntimeRoutes,
  openApiRoute,
  agentBindingRoutes,
  operatorAuditRoutes,
  operatorAuthRoutes,
  grantRoutes,
  packBindingRoutes,
  operatorRoutes,
  pluginRuntimeServerRoutes,
  pluginRuntimeWebRoutes,
  pluginRoutes,
  systemRoutes
];
