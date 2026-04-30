import type { Express } from 'express';

import type { AppContext , NotificationStore } from '../app/context.js';
import { getRuntimeConfig } from '../config/runtime_config.js';
import type { ActivePackProvider } from '../core/active_pack_provider.js';
import type { ClockProvider } from '../core/clock_provider.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('plugin-sandbox');

export type PluginCapabilityLevel = 'readonly' | 'pack_scoped' | 'full';

/**
 * 插件能力等级说明：
 *
 * - readonly: 只读访问 pack 信息、通知推送。不可写 Prisma、不可控制模拟。
 * - pack_scoped: 同上 + 操作当前 pack 数据（world state 读写），无全局 Prisma 访问。
 * - full: 等同 AppContext，可访问所有能力。默认级别，仅向后兼容。
 *
 * 配置路径: plugins.sandbox.capability_level
 */

export interface PluginSandboxConfig {
  capabilityLevel: PluginCapabilityLevel;
  maxManifestSizeBytes: number;
  maxManifestDepth: number;
  maxRoutes: number;
  maxContextSources: number;
  warnOnFullAccess: boolean;
}

export const getPluginSandboxConfig = (): PluginSandboxConfig => {
  const config = getRuntimeConfig().plugins.sandbox;
  return {
    capabilityLevel: config.capability_level as PluginCapabilityLevel,
    maxManifestSizeBytes: config.max_manifest_size_bytes,
    maxManifestDepth: config.max_manifest_depth,
    maxRoutes: config.max_routes,
    maxContextSources: config.max_context_sources,
    warnOnFullAccess: config.warn_on_full_access
  };
};

/**
 * 只读接口 — 仅暴露 pack 信息读取和通知
 */
export interface ReadonlyPluginContext {
  readonly notifications: NotificationStore;
  readonly clock: ClockProvider;
  readonly activePack: ActivePackProvider;
  getActivePackId(): string | null;
}

/**
 * Pack 范围接口 — 继承只读，增加 pack state 读写能力
 */
export interface PackScopedPluginContext extends ReadonlyPluginContext {
  getHttpApp(): Express | null;
  getRuntimeReady(): boolean;
  assertRuntimeReady(feature: string): void;
  startupHealth: AppContext['startupHealth'];
}

/**
 * 完整接口 — 等同于 AppContext
 */
export type FullPluginContext = AppContext;

export type PluginContext = ReadonlyPluginContext | PackScopedPluginContext | FullPluginContext;

const createReadonlyContext = (context: AppContext): ReadonlyPluginContext => ({
  notifications: context.notifications,
  clock: context.clock,
  activePack: context.activePack,
  getActivePackId: () => context.activePack.getActivePack()?.metadata.id ?? null
});

const createPackScopedContext = (context: AppContext): PackScopedPluginContext => ({
  ...createReadonlyContext(context),
  getHttpApp: () => context.getHttpApp?.() ?? null,
  getRuntimeReady: () => context.isRuntimeReady!(),
  assertRuntimeReady: feature => context.assertRuntimeReady(feature),
  startupHealth: context.startupHealth
});

/**
 * 根据配置的能力等级，从 AppContext 构建受限的 PluginContext。
 *
 * full 级别：直接返回 AppContext（默认，向后兼容）。
 * 如果 warnOnFullAccess 启用，打印运行时警告。
 */
export const createPluginContext = (
  context: AppContext,
  pluginName: string,
  options?: { level?: PluginCapabilityLevel }
): PluginContext => {
  const level = options?.level ?? getPluginSandboxConfig().capabilityLevel;
  const config = getPluginSandboxConfig();

  switch (level) {
    case 'readonly':
      logger.info(`插件 ${pluginName} 以 readonly 权限运行`);
      return createReadonlyContext(context);

    case 'pack_scoped':
      logger.info(`插件 ${pluginName} 以 pack_scoped 权限运行`);
      return createPackScopedContext(context);

    case 'full':
      if (config.warnOnFullAccess) {
        logger.warn(
          `插件 ${pluginName} 以 full 权限运行，可访问 Prisma、文件系统和模拟控制。` +
          `请确保插件来源可信。风险自负。` +
          `可通过 plugins.sandbox.capability_level 配置调整权限等级。`
        );
      }
      return context;
  }
};
