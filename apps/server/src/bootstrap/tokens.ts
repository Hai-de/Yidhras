import type { TokenTypes } from './token_types.js';

type ServiceToken = keyof TokenTypes;

export const TOKENS = {
  // 基础设施
  prisma: 'prisma',
  repos: 'repos',
  conversationStore: 'conversationStore',
  packStorageAdapter: 'packStorageAdapter',
  schedulerStorage: 'schedulerStorage',
  notifications: 'notifications',

  // 核心服务
  sim: 'sim',
  packScope: 'packScope',
  packRuntimeLookup: 'packRuntimeLookup',
  packRuntimeObservation: 'packRuntimeObservation',
  packRuntimeControl: 'packRuntimeControl',
  worldEngine: 'worldEngine',
  runtimeClockProjection: 'runtimeClockProjection',
  worldEngineStepCoordinator: 'worldEngineStepCoordinator',

  // 运行时状态与配置
  runtimeState: 'runtimeState',
  cliConfig: 'cliConfig',

  // AI / Inference
  inferenceProviders: 'inferenceProviders',
  inferenceTraceSink: 'inferenceTraceSink',
  inferenceService: 'inferenceService',

  // 插件
  behaviorStateStoreInit: 'behaviorStateStoreInit',

  // 路由
  queryHandlerRegistry: 'queryHandlerRegistry',
  registerRoutes: 'registerRoutes',
  httpApp: 'httpApp',

  // 聚合
  appContext: 'appContext',

  // Wiring（内部使用）
  wiring: 'wiring',
  metricsInit: 'metricsInit'
} as const satisfies Record<string, ServiceToken>;
