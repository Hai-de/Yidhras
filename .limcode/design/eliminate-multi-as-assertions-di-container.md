# DI 容器类型安全重构：消除 `as unknown as` 双重断言

## 范围

- `apps/server/src/bootstrap/provider.ts` — ServiceProvider 接口与 ServiceContainer 类
- `apps/server/src/bootstrap/tokens.ts` — token 常量定义
- `apps/server/src/bootstrap/providers/*.ts` — 全部 16 个 provider 文件
- `apps/server/src/index.ts` — 容器注册与 CLI config 构建

不保留向后兼容。所有 provider 同步修改。所有引导测试同步更新。

---

## 一、问题诊断

### 1.1 病灶：`useFactory` 的类型签名

```typescript
// apps/server/src/bootstrap/provider.ts:9
export interface ServiceProvider<T = unknown> {
  deps?: ServiceToken[];
  useFactory: (deps: Record<string, unknown>) => T | Promise<T>;
  //                  ^^^^^^^^^^^^^^^^^^^^^^^^
}
```

`ServiceProvider` 仅对**产出类型** `T` 做泛型参数化，**输入类型**被写死为 `Record<string, unknown>`。容器在 `resolve()` 中构建 deps map 时也是 `Record<string, unknown>`（第 41 行），然后 `useFactory(deps)` 传入。

每个 `useFactory` 的实现者拿到 deps 后，第一行有效代码必定是：

```typescript
const d = deps as unknown as ContextProviderDeps;
```

这不是类型安全——这是在假装类型系统存在，然后手动绕过它。全仓库 16 个 provider 文件共有 20 处此模式。

### 1.2 丢失的信息

容器**在运行时**持有完整的 token→类型关联信息。每个 `register()` 调用同时提供了：
- token 字符串（`TOKENS.prisma`）
- 一个知道如何从 deps 构造 `T` 的工厂

但容器在**类型层面**完全丢弃了 deps 的类型。`resolve()` 返回 `T`（产出正确），但 `useFactory` 的入参是 `Record<string, unknown>`（输入错误）。

TypeScript 有能力表达"依赖 map 的类型由 deps token 列表决定"这一约束——只是当前设计没有利用。

### 1.3 连锁伤害

因为 `ServiceContainer.resolve()` 返回 `instance as T`（同样依赖断言，第 54 行），任何通过容器解析的服务的消费者都得到了正确的类型。问题仅存在于 provider 的**内部实现**——工厂函数内部。但 16 个文件中每个工厂函数的开头都在重复同一个谎言。

---

## 二、目标架构

### 2.1 核心原则

1. **依赖类型由 token 列表推导**——`useFactory` 收到的 deps 类型必须精确匹配 `deps` 数组中声明的 token
2. **token 即类型键**——每个 token 对应一个明确的 TypeScript 类型
3. **零 `as unknown as`**——provider 文件不再需要任何 deps 类型断言
4. **容器本身无断言**——`resolve()` 不需要 `as T`

### 2.2 token→类型注册表

建立 token 字符串到 TypeScript 类型的映射：

```typescript
// apps/server/src/bootstrap/token_types.ts (新文件)

import type { PrismaClient } from '@prisma/client';
import type { AppContext, NotificationStore, RuntimeLoopDiagnostics, StartupHealth } from '../app/context.js';
import type { PackScopeResolver } from '../app/runtime/PackScopeResolver.js';
import type { RuntimeClockProjectionService } from '../app/runtime/runtime_clock_projection.js';
import type { WorldEngineStepCoordinator } from '../app/runtime/world_engine_persistence.js';
import type { WorldEnginePort } from '../app/runtime/world_engine_ports.js';
import type { Repositories } from '../app/services/repositories/index.js';
import type { ConversationStore } from '../conversation/store.js';
import type { PackRuntimeControl, PackRuntimeLookupPort, PackRuntimeObservation } from '../core/pack_runtime_ports.js';
import type { SimulationManager } from '../core/simulation.js';
import type { InferenceService } from '../inference/service.js';
import type { PackStorageAdapter } from '../packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../packs/storage/SchedulerStorageAdapter.js';

/**
 * 每个 DI token 对应的 TypeScript 类型。
 * 这是 token→类型的单一事实来源。
 */
export interface TokenTypes {
  prisma: PrismaClient;
  repos: Repositories;
  conversationStore: ConversationStore;
  packStorageAdapter: PackStorageAdapter;
  schedulerStorage: SchedulerStorageAdapter;
  notifications: NotificationStore;
  sim: SimulationManager;
  packScope: PackScopeResolver;
  packRuntimeLookup: PackRuntimeLookupPort;
  packRuntimeObservation: PackRuntimeObservation;
  packRuntimeControl: PackRuntimeControl;
  worldEngine: WorldEnginePort;
  runtimeClockProjection: RuntimeClockProjectionService;
  worldEngineStepCoordinator: WorldEngineStepCoordinator;
  runtimeState: RuntimeState;
  cliConfig: CliConfig;
  inferenceProviders: InferenceProviders;
  inferenceTraceSink: InferenceTraceSink;
  inferenceService: InferenceService;
  appContext: AppContext;
  httpApp: Express;
  // ...所有 token 的完整映射
}

/** 运行时状态 */
export interface RuntimeState {
  startupHealth: StartupHealth;
  assertRuntimeReady: (feature: string) => void;
  isRuntimeReady: () => boolean;
  setRuntimeReady: (ready: boolean) => void;
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  getRuntimeLoopDiagnostics: () => RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics: (next: RuntimeLoopDiagnostics) => void;
}

/** CLI 配置 */
export interface CliConfig {
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  simulationLoopIntervalMs: number;
}
```

### 2.3 类型安全的 ServiceProvider

```typescript
// apps/server/src/bootstrap/provider.ts

import type { TokenTypes } from './token_types.js';

export type ServiceToken = string & keyof TokenTypes;

/** 从 token 数组中推导出 deps record 的类型 */
type DepsFromTokens<Tokens extends readonly ServiceToken[]> = {
  [K in Tokens[number]]: TokenTypes[K];
};

export interface ServiceProvider<
  T = unknown,
  TTokens extends readonly ServiceToken[] = readonly ServiceToken[]
> {
  provide: ServiceToken;
  deps?: TTokens;
  useFactory: (deps: DepsFromTokens<TTokens>) => T | Promise<T>;
  lifecycle?: 'singleton' | 'transient';
}
```

关键变化：
- `ServiceToken` 不再只是 `string`——它是 `string & keyof TokenTypes`，确保 token 在注册表中有对应类型
- `deps` 从 `ServiceToken[]` 变为泛型 `TTokens extends readonly ServiceToken[]`，保留字面量元组类型
- `useFactory` 的 deps 参数类型从 `Record<string, unknown>` 变为 `DepsFromTokens<TTokens>`——**由 deps 数组精确推导**

`DepsFromTokens` 的工作方式：

```typescript
// 给定:
deps: ['prisma', 'sim', 'appContext'] as const
// DepsFromTokens 推导出:
{ prisma: PrismaClient; sim: SimulationManager; appContext: AppContext }
```

### 2.4 类型安全的 ServiceContainer

```typescript
export class ServiceContainer {
  private providers = new Map<ServiceToken, ServiceProvider<any, any>>();
  private instances = new Map<ServiceToken, unknown>();

  register<T, TTokens extends readonly ServiceToken[]>(
    provider: ServiceProvider<T, TTokens>
  ): this {
    if (this.providers.has(provider.provide)) {
      throw new Error(`Duplicate provider: ${provider.provide}`);
    }
    this.providers.set(provider.provide, provider);
    return this;
  }

  async resolve<T>(token: ServiceToken): Promise<T> {
    const cached = this.instances.get(token);
    if (cached !== undefined) return cached as T; // 此断言合理：缓存值在插入时已验证类型

    const provider = this.providers.get(token);
    if (!provider) throw new Error(`Unknown service: ${token}`);

    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency: ${[...this.resolving, token].join(' → ')}`);
    }
    this.resolving.add(token);

    // deps 的类型是 Record<string, unknown>——但在运行时每个值都经过了对应 provider 的工厂验证
    const deps: Record<string, unknown> = {};
    for (const dep of provider.deps ?? []) {
      deps[dep] = await this.resolve(dep);
    }

    const instance = await provider.useFactory(deps as any);
    //                                              ^^^^^^ 此 any 是容器内部的必要妥协——
    // 运行时 deps map 的构建无法在类型层面验证。但 provider 的 useFactory
    // 签名已由 register() 时的泛型约束保证正确，此处转换安全。

    if (provider.lifecycle !== 'transient') {
      this.instances.set(token, instance);
    }

    this.resolving.delete(token);
    return instance as T;
  }
}
```

容器内部保留一处 `as any`（第 43 行 deps 传入 useFactory）。这是运行时的必要妥协——容器在运行时动态构建 deps map，TypeScript 无法验证动态拼接的 `Record<string, unknown>` 确实满足 `DepsFromTokens<TTokens>`。但这**仅此一处**，且局限在容器实现内部，不再泄漏到 16 个 provider 文件中。

### 2.5 Provider 文件的变更

**变更前**（以 `wiring.ts` 为例）：

```typescript
interface WiringDeps {
  sim: SimulationManager;
  worldEngine: WorldEnginePort;
  inferenceService: InferenceService;
  appContext: AppContext;
  cliConfig: CliConfig;
}

export const wiringProvider: ServiceProvider = {
  provide: TOKENS.wiring,
  deps: [
    TOKENS.sim,
    TOKENS.worldEngine,
    TOKENS.inferenceService,
    TOKENS.appContext,
    TOKENS.cliConfig
  ],
  useFactory: (deps) => {
    const d = deps as unknown as WiringDeps;  // ← 删除此行
    // ...
  }
};
```

**变更后**：

```typescript
// WiringDeps 接口删除——类型由 DepsFromTokens 自动推导

export const wiringProvider = {
  provide: TOKENS.wiring,
  deps: [
    TOKENS.sim,
    TOKENS.worldEngine,
    TOKENS.inferenceService,
    TOKENS.appContext,
    TOKENS.cliConfig
  ] as const,  // ← as const 保留字面量元组类型
  useFactory: (deps) => {
    // deps 类型自动推导为:
    // { sim: SimulationManager; worldEngine: WorldEnginePort;
    //   inferenceService: InferenceService; appContext: AppContext;
    //   cliConfig: CliConfig }
    deps.sim.setWorldEngine(deps.worldEngine);  // 直接使用，无断言
    // ...
  }
} satisfies ServiceProvider;
//  ^^^^^^^^ satisfies 确保类型兼容但不扩宽类型
```

每个 provider 文件的变更量：
1. 删除手写的 `XxxDeps` 接口
2. 在 `deps` 数组后加 `as const`
3. 删除 `const d = deps as unknown as XxxDeps`
4. 将 `d.xxx` 改为 `deps.xxx`
5. 加 `satisfies ServiceProvider` 验证

### 2.6 TOKENS 常量保留

`TOKENS` 对象保持不变。token 字符串值继续作为容器中的键使用。`ServiceToken` 的 `string & keyof TokenTypes` 约束确保只有注册表中存在的 token 才能被使用。

---

## 三、实施步骤

### 步骤 1：创建 `token_types.ts`

新建 `apps/server/src/bootstrap/token_types.ts`，定义 `TokenTypes` 接口及所有辅助类型（`RuntimeState`、`CliConfig` 等）。

### 步骤 2：重写 `provider.ts`

修改 `ServiceProvider` 接口和 `ServiceContainer` 类。此为破坏性变更——所有 provider 文件将立即类型报错，后续步骤逐一修复。

### 步骤 3：逐个迁移 provider 文件

按依赖从少到多的顺序（无 deps 的优先）：

| 优先级 | 文件 | deps 数量 | 备注 |
|--------|------|----------|------|
| 1 | `config_context.ts` | 1 | 最简单，验证方案可行性 |
| 2 | `metrics.ts` | 1 | |
| 3 | `database.ts` | 1 | |
| 4 | `storage.ts` | 1 | |
| 5 | `pack_scope.ts` | 1 | |
| 6 | `simulation.ts` | 2 | |
| 7 | `notifications.ts` | 2 | |
| 8 | `inference.ts` | 3 | |
| 9 | `runtime_ports.ts` | 3 | |
| 10 | `world_engine.ts` | 3 | |
| 11 | `clock.ts` | 3 | |
| 12 | `routes.ts` | 4 | |
| 13 | `plugin.ts` | 4 | |
| 14 | `context.ts` | 14 | deps 最多，逻辑最复杂 |
| 15 | `wiring.ts` | 5 | |

每次迁移后运行 `pnpm typecheck` 验证。

### 步骤 4：清理 `index.ts`

`index.ts` 中的容器注册调用需同步更新。CLI config 构建逻辑保持不变。

### 步骤 5：处理循环依赖的特殊情况

`context.ts` 的 `useFactory` 中有 Step 2 回填逻辑（`(ctx as unknown as Record<string, unknown>)['packHostApi'] = ...`）。这些回填是因为 `AppContext` 中存在循环依赖字段（`packHostApi` 工厂接收 `AppContext`，但 `AppContext` 包含 `packHostApi`）。

回填的类型安全问题独立于 DI 容器的 deps 类型问题。处理方式：
- 使用 `Partial<AppContext>` 作为构建阶段的中间类型
- 或者将循环依赖字段改为 lazy getter，消除显式回填

### 步骤 6：添加 token 类型注册表的完整性测试

```typescript
// tests/unit/bootstrap/token_types.spec.ts
// 验证每个 TOKENS 条目在 TokenTypes 中都有对应类型
```

---

## 四、风险与边界

### 4.1 容器内部的 `deps as any`

`ServiceContainer.resolve()` 第 43 行的 `deps as any` 无法消除。这是因为容器在运行时动态构建 deps map——`for (const dep of provider.deps)` 循环拼接——TypeScript 无法在编译期验证动态 map 与静态类型之间的一致性。这是 DI 容器的固有局限，任何 TypeScript DI 实现都有此问题。

但关键区别在于：此 `as any` **仅存在于容器实现内部一处**，不再扩散到所有 provider 文件中。Provider 作者（即开发者）在编写 `useFactory` 时获得完整的 deps 类型推导。

### 4.2 `as const` 的必要性

Provider 的 `deps` 数组必须使用 `as const` 以保留字面量元组类型。没有 `as const`，TypeScript 会将 `deps: ['prisma', 'sim']` 推断为 `string[]`，丢失字面量信息。

这是 TypeScript 的已知限制（`as const` 是唯一的字面量类型保留手段）。相比之前每个文件需要 `as unknown as` 断言，一个 `as const` 是净改进。

### 4.3 不影响运行时行为

此重构是纯类型层面的变更。`ServiceContainer` 的运行时逻辑完全不变——token 解析、依赖图行走、缓存、循环检测均保持原样。所有现有测试应在无逻辑变更的情况下通过。

### 4.4 不引入外部 DI 库

此方案保持手写 DI 容器，不引入 `tsyringe`、`inversify`、`typedi` 等外部库。原因：
- 现有容器 ~60 行，功能充分（singleton/transient、循环检测、延迟解析）
- 外部库的装饰器方案与 `module: NodeNext` 的兼容性不确定
- 最小化变更面

---

## 五、验证标准

重构完成的判定条件：

```bash
# 零 as unknown as 的 deps 断言
grep -rn "as unknown as.*Deps" apps/server/src/bootstrap/providers/
# 预期输出：空

# 所有 provider 通过类型检查
pnpm typecheck
# 预期：0 errors

# 引导流程测试通过
pnpm --filter yidhras-server test:unit -- --reporter=verbose
# 预期：全部通过

# 集成测试通过
pnpm --filter yidhras-server test:integration
# 预期：全部通过

# 服务可正常启动
pnpm dev:server
# 预期：正常监听 :3001，无启动错误
```
