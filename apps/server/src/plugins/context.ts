import type { AppContext , NotificationStore } from '../app/context.js';
import type { PackRuntimePort } from '../app/services/pack/pack_runtime_ports.js';
import { resolvePackTick } from '../app/services/pack/pack_runtime_resolution.js';
import { getRuntimeConfig } from '../config/runtime_config.js';
import type { ClockProvider } from '../core/clock_provider.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('plugin-sandbox');

export type PluginCapabilityLevel = 'readonly' | 'pack_scoped';

/**
 * 插件能力等级说明：
 *
 * - readonly: 只读访问 pack 信息、通知推送。不可写 Prisma、不可控制模拟。
 * - pack_scoped: 同上 + 当前 pack 只读运行时元数据。所有 Host API 调用必须通过 Worker IPC 边界。
 *
 * 配置路径: plugins.sandbox.capability_level
 */

export interface PluginSandboxConfig {
  capabilityLevel: PluginCapabilityLevel;
  maxManifestSizeBytes: number;
  maxManifestDepth: number;
  maxRoutes: number;
  maxContextSources: number;
}

export const getPluginSandboxConfig = (): PluginSandboxConfig => {
  const config = getRuntimeConfig().plugins.sandbox;
  return {
    capabilityLevel: config.capability_level,
    maxManifestSizeBytes: config.max_manifest_size_bytes,
    maxManifestDepth: config.max_manifest_depth,
    maxRoutes: config.max_routes,
    maxContextSources: config.max_context_sources
  };
};

/**
 * 只读接口 — 仅暴露 pack 信息读取和通知
 */
export interface ReadonlyPluginContext {
  readonly notifications: NotificationStore;
  readonly clock: ClockProvider;
  readonly packRuntime: {
    getPack(): import('../packs/manifest/loader.js').WorldPack | undefined;
    getCurrentRevision(): bigint;
  };
  getPackId(): string | null;
}

/**
 * Pack 范围接口 — 继承只读，增加 pack state 读写能力
 */
export interface PackScopedPluginContext extends ReadonlyPluginContext {
  getRuntimeReady(): boolean;
  assertRuntimeReady(feature: string): void;
}

export type PluginContext = ReadonlyPluginContext | PackScopedPluginContext;

const createReadonlyContext = (context: AppContext, packRuntime?: PackRuntimePort): ReadonlyPluginContext => ({
  notifications: context.notifications,
  clock: { getCurrentTick: () => resolvePackTick(context, packRuntime) },
  packRuntime: {
    getPack: () => packRuntime?.getPack(),
    getCurrentRevision: () => packRuntime?.getCurrentRevision() ?? 0n
  },
  getPackId: () => packRuntime?.getPackId() ?? null
});

const createPackScopedContext = (context: AppContext, packRuntime?: PackRuntimePort): PackScopedPluginContext => ({
  ...createReadonlyContext(context, packRuntime),
  getRuntimeReady: () => context.isRuntimeReady(),
  assertRuntimeReady: feature => { context.assertRuntimeReady(feature); }
});

/**
 * 根据配置的能力等级，从 AppContext 构建受限的 PluginContext。
 *
 * 此函数只返回受限只读对象；不会返回 AppContext。
 * Worker-only 插件不得通过此路径获取主线程对象引用。
 */
export const createPluginContext = (
  context: AppContext,
  pluginName: string,
  options?: { level?: PluginCapabilityLevel; packRuntime?: PackRuntimePort }
): PluginContext => {
  const level = options?.level ?? getPluginSandboxConfig().capabilityLevel;

  switch (level) {
    case 'readonly':
      logger.info(`插件 ${pluginName} 以 readonly 权限运行`);
      return createReadonlyContext(context, options?.packRuntime);

    case 'pack_scoped':
      logger.info(`插件 ${pluginName} 以 pack_scoped 权限运行`);
      return createPackScopedContext(context, options?.packRuntime);
  }
};
