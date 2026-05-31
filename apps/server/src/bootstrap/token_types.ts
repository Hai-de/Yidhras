import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type { AppContext, NotificationStore, RouteRegistrar } from '../app/context.js';
import type { PackScopeResolver } from '../app/runtime/PackScopeResolver.js';
import type { RuntimeClockProjectionService } from '../app/runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from '../app/runtime/world_engine_persistence.js';
import type { WorldEnginePort } from '../app/runtime/world_engine_ports.js';
import type { PackQueryHandlerRegistry } from '../app/services/action/pack_query_resolver.js';
import type { Repositories } from '../app/services/repositories/types.js';
import type { ConversationStore } from '../conversation/store.js';
import type { PackRuntimeControl, PackRuntimeLookupPort, PackRuntimeObservation } from '../core/pack_runtime_ports.js';
import type { SimulationManager } from '../core/simulation.js';
import type { InferenceProvider } from '../inference/provider.js';
import type { InferenceService } from '../inference/service.js';
import type { InferenceTraceSink } from '../inference/trace_sink.js';
import type { PackStorageAdapter } from '../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../packs/storage/SchedulerStorageAdapter.js';
import type { CliConfig, RuntimeState } from './token_interfaces.js';

/**
 * 每个 DI token 对应的 TypeScript 类型。
 * 这是 token → 类型的单一事实来源。
 *
 * 所有通过 ServiceContainer 注册的服务必须在此接口中有对应条目。
 * 新的 token 添加到 TOKENS 常量时，必须同步更新此接口。
 */
export interface TokenTypes {
  // 基础设施
  prisma: PrismaClient;
  repos: Repositories;
  conversationStore: ConversationStore;
  packStorageAdapter: PackStorageAdapter;
  schedulerStorage: SchedulerStorageAdapter;
  notifications: NotificationStore;

  // 核心服务
  sim: SimulationManager;
  packScope: PackScopeResolver;
  packRuntimeLookup: PackRuntimeLookupPort;
  packRuntimeObservation: PackRuntimeObservation;
  packRuntimeControl: PackRuntimeControl;
  worldEngine: WorldEnginePort;
  runtimeClockProjection: RuntimeClockProjectionService;
  worldEngineStepCoordinator: WorldEngineStepCoordinator;

  // 运行时状态与配置
  runtimeState: RuntimeState;
  cliConfig: CliConfig;

  // AI / Inference
  inferenceProviders: InferenceProvider[];
  inferenceTraceSink: InferenceTraceSink;
  inferenceService: InferenceService;

  // 路由
  queryHandlerRegistry: PackQueryHandlerRegistry;
  registerRoutes: RouteRegistrar;
  httpApp: Express;

  // 聚合
  appContext: AppContext;

  // 内部
  wiring: { multiPackLoopHost: unknown };
  metricsInit: { initialized: boolean };
  behaviorStateStoreInit: { initialized: boolean };
}
