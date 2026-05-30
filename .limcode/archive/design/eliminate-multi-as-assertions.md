# 消除多重 `as` 断言 — 总览

## 范围总表

| # | 设计文档 | 根因 | 断言数 | 涉及文件 | 可消除比例 |
|---|---------|------|--------|---------|-----------|
| 1 | `eliminate-multi-as-assertions-di-container.md` | `ServiceProvider.useFactory` deps 类型为 `Record<string, unknown>` | ~20 | 16 provider 文件 + provider.ts | 100% → 容器内部 1 处 `as any` |
| 2 | `eliminate-multi-as-assertions-world-engine-boundary.md` | `WorldEngineSessionContext` 五个数组类型为 `ReadonlyArray<Record<string, unknown>>` | ~14 | 合约层 1 文件 + 引擎层 2 文件 + 插件代理 1 文件 | 100%（内部路径）→ 插件边界的传输 schema 保留 `Record<string, unknown>` |
| 3 | `eliminate-multi-as-assertions-calendar-config.md` | Zod schema `ratio: optional` vs 手写 interface `ratio: required` 矛盾 | 5 | constitution_schema.ts + clock/types.ts + 5 个使用点 | 100% |
| 4 | `eliminate-multi-as-assertions-app-context-lie.md` | 函数签名接受窄类型 `AppInfrastructure`，实现需要宽类型 `AppContext`；Zod `.loose()`；`deepMerge` 泛型缺失 | ~6 | 投影层 1 文件 + 快照 1 文件 + 插件代理 1 文件 + AI 工具层 2 文件 | 100% |
| 5 | `eliminate-multi-as-assertions-json-parse-and-boundaries.md` | `JSON.parse` 返回 `any`（TS 标准库缺陷）；边车 IPC 缺少契约类型 | ~40 | ~30 文件（JSON.parse）+ 2 文件（边车） | JSON.parse: 收敛到工具函数（断言不消失但集中化）; 边车: 100% |

**合计**：~85 处多重/不安全断言，分布于 ~55 个文件。其中 ~70 处可彻底消除，~15 处（JSON.parse 收敛）集中到工具函数。

---

## 问题分类的本质

五个问题不是同等级别。按性质分为三层：

### 层一：类型架构缺陷（问题 1、2、3）

这些问题不是"某处缺了一个类型标注"——是**系统级的类型架构决策导致了断言在多个调用方扩散**。

- **DI 容器**（问题 1）：容器接口设计时选择了 `Record<string, unknown>` 作为 deps 类型，导致每个 provider（16 个文件）都需要断言。修复容器接口一处，16 个文件获益。
- **World Engine 边界**（问题 2）：合约类型选择了最低公分母 `Record<string, unknown>`，导致所有提供消费双方都需要断言。修复合约类型一处，10+ 处使用点获益。
- **CalendarConfig 双轨**（问题 3）：同一概念在两个位置独立定义，已经语义分歧。统一为单一事实来源，5 处断言消失。

### 层二：局部类型谎言（问题 4）

函数签名声明需要 X，实现需要 Y（Y extends X），通过断言弥合。每处独立，修复方式各不相同，但模式一致：**签名说谎，断言补漏**。

### 层三：语言/平台边界（问题 5）

`JSON.parse` 返回 `any` 是 TypeScript 标准库决定的，不是项目代码能改变的。`as unknown` 是行业标准防御实践。此类断言不是"问题"——它们是**TypeScript 的 JSON 处理中最安全的模式**。

边车 IPC 属于另一类：跨进程序列化的类型擦除不可避免，但可以通过 Zod schema 在序列化前后提供验证，将"断言"替换为"验证"。

---

## 实施顺序

按"收效最大、风险最低"排序：

```
Phase 1: CalendarConfig 统一（问题 3）
  ├─ 影响 5 个文件，每处删除一行代码
  ├─ 修改 constitution_schema.ts 导出类型 + clock/types.ts 重导出
  ├─ 运行时不变量：ratio 从 required → optional（正确反映现实）
  └─ 预估：1–2 小时

Phase 2: AppInfrastructure 签名修复（问题 4）
  ├─ 影响 4–5 个文件
  ├─ 每个修复独立，可逐个提交
  ├─ 无运行时行为变更
  └─ 预估：2–3 小时

Phase 3: DI 容器类型安全（问题 1）
  ├─ 影响 ~17 个文件，但变更是机械性的
  ├─ 按 deps 数量从少到多逐个迁移
  ├─ 无运行时行为变更
  └─ 预估：4–6 小时

Phase 4: World Engine 边界类型（问题 2）
  ├─ 影响 3–5 个文件
  ├─ 可能涉及 bigint→string 转换逻辑
  ├─ 合约层变更影响插件 API（需审查插件实现）
  └─ 预估：3–5 小时

Phase 5: JSON.parse + 边车 IPC（问题 5）
  ├─ JSON.parse 收敛：创建工具函数 + 逐步替换（可选）
  ├─ 边车 IPC：为每个边车方法定义 Zod 契约
  ├─ 边车变更风险较高（涉及 Rust 端响应结构审查）
  └─ 预估：4–8 小时（取决于边车审查深度）
```

---

## 不变量的守护

所有重构必须满足：

1. **`pnpm typecheck` 零错误**——每个 phase 结束后验证
2. **现有测试不退化**——`pnpm test:unit` 和 `pnpm test:integration` 在每个 phase 后通过
3. **服务器可正常启动**——`pnpm dev:server` 无启动错误
4. **运行时行为不变**——除类型定义外，不改变任何运行时逻辑（除非原断言遮盖了 bug）

### 特别警告

- **Phase 3（DI 容器）**：`ServiceContainer.resolve()` 内部的 `deps as any` 无法消除——这是所有 TypeScript DI 容器的固有局限。这是容器内部实现细节，不会扩散到 provider 文件。
- **Phase 1（CalendarConfig）**：`TimeUnit.ratio` 变为 `number | undefined` 后，所有消费 `ratio` 的代码需要处理 undefined。当前的 `required` 类型可能遮盖了 `irregular_ratios` 路径的 bug（当 `ratio` 缺失时产生 `NaN` 而非报错）。
- **Phase 4（World Engine）**：合约类型从 `ReadonlyArray<Record<string, unknown>>` 改为具体 snapshot 类型后，插件代码中的 `StepContributor` 实现需要同步更新类型签名。如果插件代码不在本仓库中（外部插件），需要提供过渡期。

---

## 各文档路径

- [DI 容器](./eliminate-multi-as-assertions-di-container.md)
- [World Engine 边界](./eliminate-multi-as-assertions-world-engine-boundary.md)
- [CalendarConfig 双轨统一](./eliminate-multi-as-assertions-calendar-config.md)
- [AppInfrastructure → AppContext 签名谎言](./eliminate-multi-as-assertions-app-context-lie.md)
- [JSON.parse / 边车 IPC / 存储边界](./eliminate-multi-as-assertions-json-parse-and-boundaries.md)

---


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

---


# World Engine 边界类型擦除重构

## 范围

- `packages/contracts/src/world_engine_contributors.ts` — `WorldEngineSessionContext` 接口定义
- `apps/server/src/domain/rule/enforcement_engine.ts` — 7 处 `as unknown as`（规则执行引擎）
- `apps/server/src/app/runtime/world_engine_persistence.ts` — 5 处 `as unknown as`（步骤协调器）
- `apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts` — 1 处（边车传输）
- `apps/server/src/memory/blocks/rust_sidecar_client.ts` — 1 处（边车传输）
- `apps/server/src/plugins/worker/contribution_proxy.ts` — 2 处（Zod loose schema 断言）

不保留向后兼容。所有 StepContributor / RuleContributor / QueryContributor 实现同步修改。

---

## 一、问题诊断

### 1.1 合约层的类型自毁

`packages/contracts/src/world_engine_contributors.ts` 定义了插件协议的核心接口：

```typescript
export interface WorldEngineSessionContext {
  readonly world_entities: ReadonlyArray<Record<string, unknown>>;
  readonly entity_states: ReadonlyArray<Record<string, unknown>>;
  readonly authority_grants: ReadonlyArray<Record<string, unknown>>;
  readonly mediator_bindings: ReadonlyArray<Record<string, unknown>>;
  readonly rule_execution_records: ReadonlyArray<Record<string, unknown>>;
}
```

五个领域集合全部擦除为 `ReadonlyArray<Record<string, unknown>>`。这意味着：
- 贡献者（插件）对数据的结构一无所知，只能通过字符串键访问
- 提供者（引擎）持有精确类型但被迫在传入时销毁类型信息
- 任何一方如果对字段名或值类型做出错误假设，错误只能在运行时被发现

### 1.2 上游持有精确类型

数据源函数返回的就是精确类型：

```typescript
// apps/server/src/packs/storage/entity_repo.ts
listPackWorldEntities(adapter, packId): Promise<PackRuntimeWorldEntityRecord[]>

// apps/server/src/packs/storage/entity_state_repo.ts
listPackEntityStates(adapter, packId): Promise<PackRuntimeEntityStateRecord[]>

// ...其余三个同理
```

`PackRuntimeWorldEntityRecord` 有 12 个精确类型化的字段（`id: string`、`entity_kind: string`、`created_at: bigint` 等）。这些类型信息在传入 `WorldEngineSessionContext` 时被主动丢弃：

```typescript
// world_engine_persistence.ts:403
world_entities: worldEntities as unknown as ReadonlyArray<Record<string, unknown>>,
```

### 1.3 下游用字符串键访问

`enforcement_engine.ts` 中，插件适配器通过 `Record<string, unknown>` 访问数据：

```typescript
// enforcement_engine.ts:123
const prismaCandidate = context.prisma as unknown;
// 然后通过 isRecord() 守卫和字符串键访问
```

插件贡献者（`StepContributor.contributePrepare()`）收到的 `WorldEngineSessionContext` 中的这些数组，只能通过 `['field_name']` 访问，没有任何自动补全或编译期验证。

### 1.4 边车 IPC 的类型擦除

```typescript
// scheduler_decision_sidecar_client.ts:106
input as unknown as Record<string, unknown>
```

边车客户端将类型化的输入擦除为 `Record<string, unknown>` 再序列化发送给 Rust 边车进程。反序列化回来的数据同样没有类型保证。这是跨进程通信的固有边界，但当前实现连基本的序列化契约类型都没有定义。

### 1.5 Zod `.loose()` + 双重断言

```typescript
// plugins/worker/contribution_proxy.ts:95
z.object({...}).loose() as unknown as z.ZodType<ContextNode>

// plugins/worker/contribution_proxy.ts:123
z.object({...}).loose() as unknown as z.ZodType<PromptWorkflowState>
```

使用 `.loose()` 创建宽松 schema（允许额外属性），然后断言为严格类型。`z.looseObject()` 的 `z.infer<>` 类型与目标类型不兼容（loose 允许额外属性），所以需要 `as unknown as` 桥接。

---

## 二、目标架构

### 2.1 核心原则

1. **合约层定义具体类型**——`WorldEngineSessionContext` 使用精确的 snapshot 类型，而非 `Record<string, unknown>`
2. **内部路径零断言**——`world_engine_persistence.ts` 和 `enforcement_engine.ts` 不再需要任何类型断言来适配数据
3. **插件边界为唯一转换点**——类型擦除仅在插件工作线程的序列化边界发生
4. **边车 IPC 定义传输契约**——每个边车方法定义明确的输入/输出 Zod schema

### 2.2 合约层的具体类型

`packages/contracts` 中已有对应的 snapshot 类型。将 `WorldEngineSessionContext` 改为使用它们：

```typescript
// packages/contracts/src/world_engine_contributors.ts

import type {
  WorldEntitySnapshot,
  WorldEntityStateSnapshot,
  WorldAuthorityGrantSnapshot,
  WorldMediatorBindingSnapshot,
  WorldRuleExecutionRecordSnapshot
} from './world_engine.js';

export interface WorldEngineSessionContext {
  readonly pack_id: string;
  readonly mode: 'active' | 'experimental';
  readonly current_tick: string;
  readonly current_revision: string;
  readonly world_entities: ReadonlyArray<WorldEntitySnapshot>;
  readonly entity_states: ReadonlyArray<WorldEntityStateSnapshot>;
  readonly authority_grants: ReadonlyArray<WorldAuthorityGrantSnapshot>;
  readonly mediator_bindings: ReadonlyArray<WorldMediatorBindingSnapshot>;
  readonly rule_execution_records: ReadonlyArray<WorldRuleExecutionRecordSnapshot>;
}
```

需要验证 snapshot 类型与 `PackRuntime*Record` 类型之间的兼容性。如果 snapshot 类型是 Zod 推导的（`z.infer<>`），它们应该与手写的 `PackRuntime*Record` 在结构上兼容。如果存在字段差异（如 `bigint` vs `string`），需要在类型层面处理。

### 2.3 内部路径：从 `PackRuntime*Record` 到 snapshot 的转换

`world_engine_persistence.ts` 当前将 `PackRuntimeWorldEntityRecord[]` 强制转换为 `ReadonlyArray<Record<string, unknown>>`。改为：

**方案 A（首选）：统一为 snapshot 类型**

如果 `WorldEntitySnapshot` 与 `PackRuntimeWorldEntityRecord` 结构兼容（字段名和值类型一致），直接将 `listPackWorldEntities()` 的返回值传给 `WorldEngineSessionContext`，无需转换。

**方案 B（如 bigint vs string 不兼容）：创建转换函数**

```typescript
// apps/server/src/domain/rule/snapshot_mapping.ts (新文件)

import type { WorldEntitySnapshot } from '@yidhras/contracts';
import type { PackRuntimeWorldEntityRecord } from '../../packs/runtime/core_models.js';

export function toWorldEntitySnapshot(record: PackRuntimeWorldEntityRecord): WorldEntitySnapshot {
  return {
    id: record.id,
    pack_id: record.pack_id,
    entity_kind: record.entity_kind,
    entity_type: record.entity_type,
    label: record.label,
    tags: record.tags,
    static_schema_ref: record.static_schema_ref,
    payload_json: record.payload_json,
    created_at: record.created_at.toString(),  // bigint → string
    updated_at: record.updated_at.toString()
  };
}
```

这比当前的 `as unknown as ReadonlyArray<Record<string, unknown>>` 更冗长，但**多了实际的类型安全**——如果上游类型增加字段，此函数会编译报错而非静默通过。

### 2.4 插件边界：序列化层处理擦除

插件运行在独立工作线程中。贡献代理（`contribution_proxy.ts`）负责将 `WorldEngineSessionContext` 序列化传递给插件。

在此边界处，将 snapshot 类型转换为插件可消费的格式。使用 Zod schema 定义传输格式：

```typescript
// packages/contracts/src/world_engine_contributors.ts (新增)

import { z } from 'zod';

/** 插件工作线程传输用的 session context schema */
export const worldEngineSessionContextTransportSchema = z.object({
  pack_id: z.string(),
  mode: z.enum(['active', 'experimental']),
  current_tick: z.string(),
  current_revision: z.string(),
  world_entities: z.array(z.record(z.string(), z.unknown())),
  entity_states: z.array(z.record(z.string(), z.unknown())),
  authority_grants: z.array(z.record(z.string(), z.unknown())),
  mediator_bindings: z.array(z.record(z.string(), z.unknown())),
  rule_execution_records: z.array(z.record(z.string(), z.unknown()))
});

export type WorldEngineSessionContextTransport = z.infer<
  typeof worldEngineSessionContextTransportSchema
>;
```

此 schema 在**唯一需要 `Record<string, unknown>` 的地方**使用 `z.record(z.string(), z.unknown())`——插件工作线程的序列化边界。内部代码全部使用 `WorldEngineSessionContext`（强类型版本）。

### 2.5 Zod `.loose()` 问题

`contribution_proxy.ts` 中的模式：

```typescript
z.object({...}).loose() as unknown as z.ZodType<ContextNode>
```

**根因**：使用了 `.loose()`（允许额外属性），但 `z.infer<typeof looseSchema>` 与目标类型不兼容（loose schema 的推断类型包含索引签名）。

**修复**：使用 `z.object({...}).passthrough()` 或重构为两步：
1. 用严格 schema 验证已知字段
2. 显式声明输出类型

```typescript
// 变更前
const schema = z.object({
  id: z.string(),
  label: z.string()
}).loose() as unknown as z.ZodType<ContextNode>;

// 变更后
const schema = z.object({
  id: z.string(),
  label: z.string()
}).passthrough();  // .passthrough() 的 z.infer<> 更接近目标类型

// 在解析时显式声明目标类型
function parseContextNode(input: unknown): ContextNode {
  return schema.parse(input) as ContextNode;
  // 此断言合理：.passthrough() 保留了所有额外字段，
  // parse 已验证已知字段类型正确
}
```

---

## 三、实施步骤

### 步骤 1：审查 snapshot 类型与 Record 类型的一致性

对比 `packages/contracts/src/world_engine.ts` 中的 snapshot 类型和 `apps/server/src/packs/runtime/core_models.ts` 中的 Record 类型：

- 确认字段名一致
- 确认 `bigint` vs `string` 差异（Record 用 `bigint`，snapshot 用 `string`）
- 确认 `Record<string, unknown>` vs 具体类型的差异

### 步骤 2：重定义 `WorldEngineSessionContext`

在 `packages/contracts/src/world_engine_contributors.ts` 中：
- 将五个数组的类型改为具体 snapshot 类型
- 更新所有 `StepContributor`、`RuleContributor`、`QueryContributor` 接口签名
- 导出新的传输层 schema（`worldEngineSessionContextTransportSchema`）

### 步骤 3：修复内部调用方

按顺序修改：

1. `apps/server/src/app/runtime/world_engine_persistence.ts`——移除 5 处 `as unknown as`，添加 snapshot 转换（如需要）
2. `apps/server/src/domain/rule/enforcement_engine.ts`——移除 7 处 `as unknown as`，更新 `buildSidecarObjectiveExecutionRequest` 的类型
3. 任何自定义 `StepContributor` / `RuleContributor` 实现

### 步骤 4：修复插件代理层

修改 `apps/server/src/plugins/worker/contribution_proxy.ts`：
- 在向插件工作线程发送数据前，使用传输 schema 进行序列化
- 修复 `.loose()` 断言

### 步骤 5：修复边车 IPC

修改边车客户端文件，为每个边车方法定义明确的输入/输出 Zod schema：

```typescript
// scheduler_decision_sidecar_client.ts
const decideRequestSchema = z.object({
  // ... 具体字段
});
const decideResponseSchema = z.object({
  // ... 具体字段
});

async decide(input: DecideInput): Promise<DecideOutput> {
  const request = decideRequestSchema.parse(input);   // 验证而非断言
  const raw = await this.send(request);
  return decideResponseSchema.parse(raw);             // 验证而非断言
}
```

### 步骤 6：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
```

---

## 四、影响面评估

| 变更点 | 文件数 | 风险等级 | 理由 |
|--------|--------|---------|------|
| `WorldEngineSessionContext` 类型重定义 | 1 | 低 | 合约层变更，类型收窄，调用方被迫适配 |
| `world_engine_persistence.ts` 转换 | 1 | 中 | 涉及 bigint→string 转换逻辑 |
| `enforcement_engine.ts` 解除断言 | 1 | 中 | 最大单文件断言集中地（7 处） |
| 插件代理层 | 1 | 中 | 跨线程序列化边界 |
| 边车客户端 | 2 | 低 | 添加 Zod 验证层 |
| StepContributor 实现 | 不确定 | 低 | 类型收窄后调用方获得更好的自动补全 |

---

## 五、验证标准

```bash
# world_engine_persistence.ts 中零 as unknown as
grep -n "as unknown as" apps/server/src/app/runtime/world_engine_persistence.ts
# 预期：空

# enforcement_engine.ts 中零 as unknown as
grep -n "as unknown as" apps/server/src/domain/rule/enforcement_engine.ts
# 预期：空

# 类型检查通过
pnpm typecheck

# 世界引擎相关测试通过
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/world_engine

# 启动正常
pnpm dev:server
```

---


# CalendarConfig 双轨类型统一重构

## 范围

- `apps/server/src/clock/types.ts` — `CalendarConfig` 和 `TimeUnit` 接口（手写）
- `apps/server/src/packs/schema/constitution_schema.ts` — `calendarConfigSchema` 和 `timeUnitSchema`（Zod）
- `apps/server/src/index.ts` — 第 213 行 `as unknown as CalendarConfig[]`
- `apps/server/src/core/pack_runtime_instance.ts` — 第 13 行 `as unknown as CalendarConfig[]`
- `apps/server/src/core/runtime_activation.ts` — 第 103 行 `as unknown as CalendarConfig[]`
- `apps/server/src/packs/snapshots/snapshot_restore.ts` — 第 370 行 `as unknown as CalendarConfig[]`
- `apps/server/src/packs/orchestration/pack_runtime_registry_service.ts` — 第 182 行 `as unknown as CalendarConfig[]`

不保留向后兼容。所有引用 `CalendarConfig` 和 `TimeUnit` 的模块同步修改。

---

## 一、问题诊断

### 1.1 同一概念，两套类型定义

**类型 A：手写 TypeScript 接口**

```typescript
// apps/server/src/clock/types.ts
export interface TimeUnit {
  name: string;
  ratio: number;                              // ← required
  irregular_ratios?: number[] | undefined;
}

export interface CalendarConfig {
  id: string;
  name: string;
  is_primary?: boolean | undefined;
  tick_rate: number;
  units: TimeUnit[];
}
```

**类型 B：Zod schema `z.infer<>` 推导**

```typescript
// apps/server/src/packs/schema/constitution_schema.ts
const timeUnitSchema = z.object({
  name: nonEmptyStringSchema,
  ratio: z.number().int().positive().optional(),           // ← optional
  irregular_ratios: z.array(z.number().int().positive()).optional()
}).strict().superRefine((value, ctx) => {
  if (value.ratio === undefined && value.irregular_ratios === undefined) {
    ctx.addIssue({ code: "custom", message: '...' });
  }
});

const calendarConfigSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  is_primary: z.boolean().optional(),
  tick_rate: z.number().int().positive(),
  units: z.array(timeUnitSchema)
}).strict();
```

**`z.infer<typeof timeUnitSchema>` 推导出的类型**：

```typescript
{ name: string; ratio?: number | undefined; irregular_ratios?: number[] | undefined }
```

`ratio` 是 optional，因为 Zod schema 中声明为 `.optional()`。`superRefine` 在运行时保证至少存在 `ratio` 或 `irregular_ratios` 之一，但 TypeScript 无法从 `superRefine` 推导出此约束。

**`z.infer<typeof calendarConfigSchema>` 推导出的类型**：

```typescript
{ id: string; name: string; is_primary?: boolean; tick_rate: number;
  units: Array<{ name: string; ratio?: number; irregular_ratios?: number[] }> }
```

与 `CalendarConfig` 的区别：`units[].ratio` 是 `number | undefined` vs `number`。

### 1.2 五处同样的断言

所有取用 `pack.time_systems` 的地方都必须在同一个不兼容点上强行桥接：

```typescript
// 五个文件，完全相同的模式：
const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
```

`?? []` 处理了 `time_systems` 是 `optional` 的情况。`as unknown as CalendarConfig[]` 处理了 `ratio` optional vs required 的不兼容。

### 1.3 根本原因

没有单一事实来源。`CalendarConfig` / `TimeUnit` 的类型信息存在于两个独立位置：
1. `clock/types.ts`（手写 interface）
2. `constitution_schema.ts`（Zod schema，通过 `z.infer<>` 推导）

两个定义已经语义分歧：Zod schema 准确反映了"ratio 和 irregular_ratios 至少有一个"的业务规则，但 TypeScript 类型无法表达此约束。手写 interface 选择了简化——让 `ratio` 为 required——但付出了与 Zod schema 不兼容的代价。

---

## 二、目标架构

### 2.1 核心原则

1. **Zod schema 是类型的单一事实来源**——`CalendarConfig` 类型从 `calendarConfigSchema` 推导
2. **运行时验证决定类型**——经过 Zod 验证的数据使用 Zod 推导的类型，不另定义 interface
3. **消除手写类型的重复定义**——`clock/types.ts` 中的 `TimeUnit` 和 `CalendarConfig` 删除，改为从 schema 重新导出

### 2.2 方案：Zod schema 收窄 `TimeUnit` 类型

`timeUnitSchema` 的 `superRefine` 确保了 `ratio` 或 `irregular_ratios` 至少存在一个，但 TypeScript 无法表达此约束。我们改为用 Zod 的 `discriminatedUnion` 或接受 `ratio` 在类型层面为 optional：

```typescript
// apps/server/src/packs/schema/constitution_schema.ts

// 选项 1：接受 ratio 为 optional（与 Zod 定义一致）
// 好处：零断言，类型与 schema 完全同步
// 代价：消费方需要处理 ratio 可能为 undefined 的情况

// 选项 2：定义精确的 Zod 类型（branded type / z.output）
// 使用 .transform() 将验证后的数据转为具体类型

// 选项 3（推荐）：Zod schema 重定义为更精确的结构
```

### 2.3 推荐方案：统一到 Zod 推导类型

**步骤 A：从 schema 导出类型**

```typescript
// apps/server/src/packs/schema/constitution_schema.ts (新增导出)

// 直接从 schema 推导类型，不做手写 interface
export type CalendarConfigFromSchema = z.infer<typeof calendarConfigSchema>;
export type TimeUnitFromSchema = z.infer<typeof timeUnitSchema>;
```

**步骤 B：`clock/types.ts` 改为从 schema 重新导出**

```typescript
// apps/server/src/clock/types.ts

import type { calendarConfigSchema, timeUnitSchema } from '../packs/schema/constitution_schema.js';
import type { z } from 'zod';

// CalendarConfig 和 TimeUnit 从 Zod schema 推导，不再是独立定义
export type TimeUnit = z.infer<typeof timeUnitSchema>;
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;

// TimeFormatted 保持不变（手写类型，来自运行时格式化输出，无对应 schema）
export interface TimeFormatted {
  calendar_id: string;
  calendar_name: string;
  display: string;
  units: Record<string, bigint | number>;
}
```

**步骤 C：处理 `ratio` 为 optional 的后果**

`TimeUnit.ratio` 从 `number`（required）变为 `number | undefined`（optional）。所有消费 `TimeUnit.ratio` 的代码需要处理 undefined 情况。审查消费方：

```bash
grep -rn "\.ratio" --include="*.ts" apps/server/src/clock/
grep -rn "TimeUnit" --include="*.ts" apps/server/src/
```

预期的消费方：
- `clock/` 下的时间计算逻辑（`tick_to_time` 等）——需要处理 `ratio === undefined`（使用 `irregular_ratios`）
- 序列化/格式化逻辑——需要处理
- API 路由——需要处理

这些消费方**本就应该**处理 `irregular_ratios` 的情况——当前代码如果遇到一个只有 `irregular_ratios` 没有 `ratio` 的合法时间单位配置，会因为 `ratio: undefined` 产生 `NaN` 而非报错。`required` 类型反而隐藏了这个运行时风险。

### 2.4 五个调用点的变更

**变更前**：

```typescript
const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
```

**变更后**：

```typescript
const calendars = pack.time_systems ?? [];
```

不再需要任何断言。`pack.time_systems` 的类型就是 `CalendarConfig[] | undefined`（因为 `CalendarConfig` 现在从同一个 Zod schema 推导）。

---

## 三、实施步骤

### 步骤 1：从 `constitution_schema.ts` 导出类型

在 `calendarConfigSchema` 和 `timeUnitSchema` 定义后添加显式类型导出：

```typescript
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;
export type TimeUnit = z.infer<typeof timeUnitSchema>;
```

### 步骤 2：重写 `clock/types.ts`

将 `CalendarConfig` 和 `TimeUnit` 的定义替换为从 `constitution_schema.ts` 的重新导出。保留 `TimeFormatted`（无对应 schema）。

### 步骤 3：更新所有导入

`clock/types.ts` 现在是重新导出点。所有 `import { CalendarConfig, TimeUnit } from '../../clock/types.js'` 保持不变——导入路径不变，只是类型来源变了。

### 步骤 4：移除五处断言

逐个文件修改：

| 文件 | 变更 |
|------|------|
| `index.ts:213` | 移除 `as unknown as CalendarConfig[]`，保留 `?? []` |
| `core/pack_runtime_instance.ts:13` | 同上 |
| `core/runtime_activation.ts:103` | 同上 |
| `packs/snapshots/snapshot_restore.ts:370` | 同上 |
| `packs/orchestration/pack_runtime_registry_service.ts:182` | 同上 |

### 步骤 5：修复 `ratio` optional 导致的消费方差错

搜索所有访问 `TimeUnit.ratio` 的代码，确认它们处理了 `undefined` 情况。对于时间计算逻辑，`ratio === undefined` 时应使用 `irregular_ratios` 数组。当前代码可能已经处理了（因为 runtime 通过 Zod 验证，`superRefine` 保证至少一个存在），但类型层面从未强制。

### 步骤 6：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit -- clock
pnpm --filter yidhras-server test:integration
```

---

## 四、替代方案评估

### 方案 B：`CalendarConfig` 改为使用 `.transform()` 输出更精确的类型

```typescript
const calendarConfigSchema = z.object({
  // ...
  units: z.array(timeUnitSchema.transform(unit => ({
    ...unit,
    // transform 无法改变 z.infer<> 的输出类型
    // 此方案本质上不解决静态类型问题
  })))
});
```

评估：Zod 的 `.transform()` 会改变 `z.output<>` 类型但不改变 `z.infer<>` 类型。对于验证+使用的场景（我们的场景），`z.infer<>` 才是关键。因此 `.transform()` 不适合。

### 方案 C：创建 discriminated union 替代 superRefine

```typescript
const timeUnitSchema = z.discriminatedUnion('_type', [
  z.object({ name: ..., ratio: z.number(), _type: z.literal('regular') }),
  z.object({ name: ..., irregular_ratios: z.array(...), _type: z.literal('irregular') }),
]);
```

评估：给运行时数据添加了人工的 `_type` 鉴别字段。过于侵入性，与 YAML 配置格式冲突。不采用。

### 推荐方案确认

方案 A（统一到 Zod 推导类型）是唯一不需要修改运行时行为、不影响 YAML 配置格式、且消除所有断言的方案。`ratio` 变为 optional 是正确的类型表示——它本就可能不存在。

---

## 五、验证标准

```bash
# 五处 time_systems 断言全部清除
grep -rn "time_systems.*as unknown as CalendarConfig" apps/server/src/
# 预期：空

# CalendarConfig 只在一处定义（从 schema 重新导出不算重复定义）
# clock/types.ts 应为重新导出，constitution_schema.ts 为 schema 定义

# 类型检查通过
pnpm typecheck

# 时钟相关测试通过
pnpm --filter yidhras-server test:unit -- clock

# 时间格式化逻辑正确（手动验证：启动服务，查看时钟端点输出）
pnpm dev:server
# curl localhost:3001/api/clock → 验证格式化时间输出正确
```

---


# AppInfrastructure → AppContext 签名谎言修复

## 范围

- `apps/server/src/app/context.ts` — `AppInfrastructure` 和 `AppContext` 接口定义
- `apps/server/src/packs/runtime/projections/pack_projection_metadata_resolver.ts` — `as unknown as AppContext`
- `apps/server/src/packs/snapshots/snapshot_restore.ts` — `as unknown as AppContext`
- `apps/server/src/plugins/worker/contribution_proxy.ts` — Zod `.loose()` 双重断言
- `apps/server/src/inference/slot_condition_evaluators.ts` — `as unknown as SlotLogicExpr`
- `apps/server/src/context/workflow/executors/fragment_assembly.ts` — `as unknown as Record<string, string>`
- `apps/server/src/ai/tool_loop_runner.ts` — `as unknown as { model_entry?: ... }`
- `apps/server/src/ai/registry.ts` — `deepMerge(...) as unknown as T`

不保留向后兼容。所有调用方同步修改。

---

## 一、问题诊断

### 1.1 `AppInfrastructure` → `AppContext`：接受窄类型，使用宽类型

```typescript
// pack_projection_metadata_resolver.ts:27-31
export const createPackProjectionMetadataResolver = (
  context: AppInfrastructure  // ← 声明只需要 AppInfrastructure
): PackProjectionMetadataResolver => {
  const ctx = context as unknown as AppContext;  // ← 实际需要 AppContext
```

`AppContext extends AppInfrastructure`，但反之不成立。函数签名声称只需要 `AppInfrastructure`，实现却调用了 `AppContext` 独有的方法（`getPackRuntimeHandle`、`packScope`）。

这是**签名在说谎**。不是类型系统的限制——纯粹是开发者选择了错误的参数类型。

`schema/` 中的情况相同：

```typescript
// pack_projection_metadata_resolver.ts（同一文件中还有类似模式）
```

以及 `snapshot_restore.ts:388`：

```typescript
{
  packStorageAdapter,
  getPackRuntimeHandle
} as unknown as import('../../app/context.js').AppContext
```

这里甚至更糟——构造了一个只有两个字段的普通对象，然后断言为完整的 `AppContext`。如果 `AppContext` 的其他方法在此上下文中被调用（通过任何间接路径），将是运行时崩溃。

### 1.2 Zod `.loose()` 双重断言

```typescript
// plugins/worker/contribution_proxy.ts:95
z.object({...}).loose() as unknown as z.ZodType<ContextNode>

// plugins/worker/contribution_proxy.ts:123
z.object({...}).loose() as unknown as z.ZodType<PromptWorkflowState>
```

`z.object({...}).loose()` 创建了索引签名类型（允许任意额外属性）。`z.ZodType<ContextNode>` 没有索引签名（严格类型）。TypeScript 不允许此赋值，所以需要 `as unknown as` 绕行。

根本问题：宽松 schema 的 `z.infer<>` 类型与严格目标类型不兼容。

### 1.3 `deepMerge` 的泛型断言

```typescript
// ai/registry.ts:616
return deepMerge(a, b) as unknown as T;
```

`deepMerge` 函数的返回类型不够精确，调用方被迫在每次使用时断言。这是工具函数的类型签名缺陷。

### 1.4 杂项断言

```typescript
// slot_condition_evaluators.ts:325
condition.expression as unknown as SlotLogicExpr

// fragment_assembly.ts:113
(context as unknown as Record<string, string>)['inference_id']

// tool_loop_runner.ts:104
input.task_config as unknown as { model_entry?: { model_name?: string; ... } }
```

这些都是"我知道这里的数据形状，但类型系统不知道"的实例。每一处都是一个微小的类型设计缺陷。

---

## 二、目标架构与修复方案

### 2.1 `AppInfrastructure` → `AppContext`：接受正确的类型

**修复**：将参数类型改为 `AppContext`。

```typescript
// pack_projection_metadata_resolver.ts

import type { AppContext } from '../../app/context.js';

export const createPackProjectionMetadataResolver = (
  context: AppContext  // ← 直接声明实际需要的类型
): PackProjectionMetadataResolver => {
  // 不再需要 as unknown as AppContext
  return {
    resolve(packId: string, feature: string): Promise<PackProjectionResolution> {
      const resolvedPackId = assertPackScope(context, packId, feature);
      const handle = context.getPackRuntimeHandle(resolvedPackId);
      // ...
    }
  };
};
```

`snapshot_restore.ts:388` 的情况更严重。当前代码：

```typescript
const fakeContext = {
  packStorageAdapter,
  getPackRuntimeHandle
} as unknown as import('../../app/context.js').AppContext;
```

**修复**：定义最小依赖接口，让 `snapshot_restore.ts` 的函数仅接收它实际需要的字段：

```typescript
// snapshot_restore.ts

interface SnapshotRestoreContext {
  packStorageAdapter: PackStorageAdapter;
  getPackRuntimeHandle: (packId: string) => PackRuntimeHandle | null;
}

// 调用方传入真实 AppContext 或实现了此接口的对象
```

这比断言为完整 `AppContext` 更安全——类型明确声明了此上下文中可用的方法，不会意外调用未提供的方法。

### 2.2 Zod `.loose()` → `.passthrough()` + 显式解析函数

```typescript
// plugins/worker/contribution_proxy.ts

// 变更前
const contextNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  // ...
}).loose() as unknown as z.ZodType<ContextNode>;

// 变更后
const contextNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  // ...
}).passthrough();  // .passthrough() 保留额外属性，.z.infer<> 类型更接近目标

// 显式声明解析函数，隔离断言
function parseContextNode(input: unknown): ContextNode {
  return contextNodeSchema.parse(input) as ContextNode;
  // 此断言安全：parse 已验证已知字段，passthrough 保留额外字段
}
```

关键变化：断言从 schema 定义处移到解析函数处。Schema 定义本身是类型安全的（`.passthrough()` 不需要断言），唯一的断言在受控的解析函数中，且有明确注释说明其安全性。

### 2.3 `deepMerge` 修复类型签名

当前可能的签名：

```typescript
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown>;
```

修复为：

```typescript
function deepMerge<T extends Record<string, unknown>, U extends Record<string, unknown>>(
  a: T,
  b: U
): T & U;
```

或者更精确地（处理嵌套对象的递归合并）：

```typescript
type DeepMerge<T, U> = T extends Record<string, unknown>
  ? U extends Record<string, unknown>
    ? { [K in keyof T | keyof U]: K extends keyof U ? U[K] : K extends keyof T ? T[K] : never }
    : T & U
  : T & U;

function deepMerge<T, U>(a: T, b: U): DeepMerge<T, U>;
```

如果 `deepMerge` 的实际实现比简单合并更复杂（如递归合并嵌套对象），使用函数重载声明精确类型：

```typescript
function deepMerge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T;
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  // 实现
}
```

### 2.4 杂项：逐个修复

**`slot_condition_evaluators.ts`**：

```typescript
// 变更前
condition.expression as unknown as SlotLogicExpr

// 方案：为 condition 的 expression 字段提供正确的 Zod schema，
// 或者如果 expression 来自 YAML 解析，使用 Zod 验证而非断言
const expr = slotLogicExprSchema.parse(condition.expression);
```

**`fragment_assembly.ts`**：

```typescript
// 变更前
(context as unknown as Record<string, string>)['inference_id']

// 方案：为 context 添加 inference_id 的类型声明，
// 或使用类型守卫安全访问
const inferenceId = typeof context === 'object' && context !== null && 'inference_id' in context
  ? String(context.inference_id)
  : undefined;
```

**`tool_loop_runner.ts`**：

```typescript
// 变更前
input.task_config as unknown as { model_entry?: { model_name?: string; ... } }

// 方案：为 task_config 定义具体类型（可能在 contracts 包中）
interface TaskConfig {
  model_entry?: {
    model_name?: string;
    provider?: string;
  };
}
```

---

## 三、实施步骤

### 步骤 1：修复 `AppInfrastructure` → `AppContext`

1. `pack_projection_metadata_resolver.ts`：参数类型 `AppInfrastructure` → `AppContext`，删除断言
2. 向上追溯调用链：确保调用方传入的是 `AppContext` 而非 `AppInfrastructure`
3. `snapshot_restore.ts`：替换 `as unknown as AppContext` 为最小接口 `SnapshotRestoreContext`

### 步骤 2：修复 Zod `.loose()` 断言

1. `contribution_proxy.ts`：`.loose()` → `.passthrough()`，添加显式解析函数
2. 验证插件工作线程中的类型仍然兼容

### 步骤 3：修复 `deepMerge`

1. 审查 `deepMerge` 的实际实现行为
2. 添加泛型重载签名
3. 移除 `registry.ts` 中的所有 `as unknown as T` 断言

### 步骤 4：逐个修复杂项断言

每处独立修复，按影响范围从小到大排序：
1. `fragment_assembly.ts`（最简单的类型守卫）
2. `tool_loop_runner.ts`（定义缺失的类型）
3. `slot_condition_evaluators.ts`（添加 Zod 验证）

### 步骤 5：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
```

---

## 四、验证标准

```bash
# AppInfrastructure 签名谎言清除
grep -n "as unknown as AppContext" apps/server/src/packs/runtime/projections/pack_projection_metadata_resolver.ts
grep -n "as unknown as.*AppContext" apps/server/src/packs/snapshots/snapshot_restore.ts
# 预期：空

# Zod .loose() 断言清除
grep -n "as unknown as z.ZodType" apps/server/src/plugins/worker/contribution_proxy.ts
# 预期：空

# deepMerge 调用方无断言
grep -rn "deepMerge.*as unknown as" apps/server/src/
# 预期：空

# 类型检查通过
pnpm typecheck
```

---


# JSON.parse / 边车 IPC / 存储边界断言收敛

## 范围

- `apps/server/src/ai/providers/*.ts` — `JSON.parse(text) as unknown` 和 `response.json() as unknown`（约 10 处）
- `apps/server/src/ai/task_decoder.ts` — `JSON.parse(text) as unknown`
- `apps/server/src/context/overlay/store.ts` — `JSON.parse(value) as unknown`
- `apps/server/src/config/loader.ts` — YAML 解析
- `apps/server/src/memory/blocks/store.ts` — `JSON.parse(value) as unknown`
- `apps/server/src/memory/blocks/evaluation_context.ts` — JSON 解析
- `apps/server/src/memory/long_term_store.ts` — JSON 解析
- `apps/server/src/packs/storage/internal/PostgresPackStorageAdapter.ts` — 3 处 JSON 解析
- `apps/server/src/packs/snapshots/snapshot_locator.ts` — JSON 解析
- `apps/server/src/packs/snapshots/snapshot_restore.ts` — JSON 解析
- `apps/server/src/packs/storage/pack_collection_repo.ts` — JSON 解析
- `apps/server/src/packs/runtime/projections/pack_narrative_projection_service.ts` — JSON 解析
- `apps/server/src/plugins/discovery.ts` — `YAML.parse(...) as unknown`
- `apps/server/src/plugins/store.ts` — `JSON.parse(value) as unknown`
- `apps/server/src/plugins/system_pack_init.ts` — `YAML.parse(...) as unknown`
- `apps/server/src/app/services/scheduler/cursor.ts` — JSON 解析
- `apps/server/src/app/services/social/social.ts` — JSON 解析 + `as unknown[]`
- `apps/server/src/app/services/audit/audit.ts` — `as unknown[]`
- `apps/server/src/app/services/inference_workflow/*.ts` — JSON 解析（3 处）
- `apps/server/src/app/services/workflow/workflow_trigger_scheduler.ts` — JSON 解析

不保留向后兼容。所有使用点同步修改。

---

## 一、问题诊断

### 1.1 `JSON.parse` 返回 `any`：TypeScript 标准库的设计缺陷

```typescript
// TypeScript 标准库签名
interface JSON {
  parse(text: string, reviver?: ...): any;
  //                                   ^^^ 这里是一切问题的根源
}
```

`JSON.parse` 声明返回 `any`，意味着：
- `const x = JSON.parse(s)` 之后，`x` 可以是任何类型
- 对 `x` 的任何操作都不会触发编译错误
- 如果实际 JSON 结构与预期不符，错误只能在运行时发现

全仓库的 `JSON.parse(value) as unknown` 模式是社区公认的最佳防御实践：
1. 将 `any` 立即转为 `unknown`
2. 通过类型守卫（`isRecord()`、`Array.isArray()`、Zod schema）窄化
3. 窄化后的代码在编译期是类型安全的

**这不是"绕过编译器"——这是修复 TypeScript 标准库的设计缺陷。** 约 30 处 `as unknown` 属于此模式，它们是防御性代码，不是问题。

### 1.2 但每处重复同样的样板代码

虽然每处 `JSON.parse(x) as unknown` 是安全的，但它们构成了 ~30 处散布整个仓库的重复样板。每处都需要 `eslint-disable @typescript-eslint/no-unsafe-type-assertion` 注释。

### 1.3 `as unknown[]` 的模式

```typescript
// audit/audit.ts:91
query['kinds'] as unknown[]

// PostgresPackStorageAdapter.ts:239
value as unknown[]

// plugins/discovery.ts:96
value as unknown[]
```

这些是数组类型擦除：将可能是 `any` 或具体类型的值断言为 `unknown[]`，以便进行 `Array.isArray()` 检查。与 JSON.parse 模式同类——防御性类型擦除。

### 1.4 边车 IPC 缺少序列化契约

```typescript
// memory/blocks/rust_sidecar_client.ts:126
input as unknown as Record<string, unknown>

// scheduler_decision_sidecar_client.ts:106
input as unknown as Record<string, unknown>
```

边车进程间通信需要序列化数据。当前的 `as unknown as Record<string, unknown>` 既是序列化（擦除类型）又是类型绕过。序列化本身不可避免，但可以：
1. 定义传输契约 schema（Zod）
2. 在发送前验证（`schema.parse(input)`）
3. 在接收后验证（`schema.parse(response)`）

---

## 二、目标架构

### 2.1 `safeJsonParse`：收敛 JSON.parse 断言

创建单一工具函数，将 `JSON.parse` 的 `any` 返回类型问题限制在一处：

```typescript
// apps/server/src/utils/safe_json.ts (新文件)

/**
 * 类型安全的 JSON.parse 替代。
 * 将 JSON.parse 的 any 返回值立即转为 unknown，
 * 强制调用方进行运行时类型验证。
 */
export function safeJsonParse(input: string): unknown {
  return JSON.parse(input) as unknown;
}

/**
 * 带 Zod 验证的 JSON.parse。
 * 一行完成 parse + validate，消除所有中间样板。
 */
export function safeJsonParseWith<T>(input: string, schema: { parse: (v: unknown) => T }): T {
  return schema.parse(JSON.parse(input) as unknown);
}
```

所有调用方从：

```typescript
// 变更前
const parsed = JSON.parse(value) as unknown;
if (!isRecord(parsed)) throw new Error('expected object');
const id = String(parsed['id']);
```

变为：

```typescript
// 变更后（方案 A：仅收敛断言）
import { safeJsonParse } from '../../utils/safe_json.js';
const parsed = safeJsonParse(value);
if (!isRecord(parsed)) throw new Error('expected object');

// 变更后（方案 B：使用 Zod schema，推荐）
import { safeJsonParseWith } from '../../utils/safe_json.js';
const schema = z.object({ id: z.string() });
const { id } = safeJsonParseWith(value, schema);
```

方案 B 进一步消除了手写类型守卫样板。

### 2.2 `safeYamlParse`：YAML 解析的同样处理

YAML 解析库可能也存在返回类型不明确的问题：

```typescript
// apps/server/src/utils/safe_yaml.ts (新文件或扩展现有 utils)

import YAML from 'yaml';

export function safeYamlParse(input: string): unknown {
  return YAML.parse(input) as unknown;
}
```

### 2.3 边车 IPC：类型化序列化层

为每个边车方法定义明确的契约：

```typescript
// apps/server/src/app/runtime/sidecar/sidecar_transport.ts (新文件)

/**
 * 边车传输层的类型化包装。
 * 每个边车方法应定义一个此类型的契约。
 */
export interface SidecarMethod<Input, Output> {
  readonly method: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Output>;
}

/**
 * 发送类型化的边车请求。
 * 自动验证输入和输出，消除所有手动断言。
 */
export async function invokeSidecarMethod<Input, Output>(
  client: SidecarClient,  // 底层 stdio 客户端
  method: SidecarMethod<Input, Output>,
  input: Input
): Promise<Output> {
  const serialized = method.inputSchema.parse(input);  // 验证输入
  const raw = await client.send(method.method, serialized);
  return method.outputSchema.parse(raw);                // 验证输出
}
```

边车客户端从：

```typescript
// 变更前
const rawResult = await sidecar.send('decide', input as unknown as Record<string, unknown>);
return rawResult as unknown as DecisionResult;
```

变为：

```typescript
// 变更后
const decideMethod: SidecarMethod<DecisionInput, DecisionOutput> = {
  method: 'decide',
  inputSchema: decisionInputSchema,
  outputSchema: decisionOutputSchema
};

const result = await invokeSidecarMethod(sidecar, decideMethod, input);
// result 类型为 DecisionOutput，无需断言
```

### 2.4 `as unknown[]`：使用类型守卫替代

```typescript
// 变更前
const kinds = query['kinds'] as unknown[];
if (Array.isArray(kinds) && kinds.every(k => typeof k === 'string')) { ... }

// 变更后（通用工具函数）
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

if (isStringArray(query['kinds'])) { ... }
```

或者如果 `query` 的来源有已知类型，直接在类型定义中修复。

### 2.5 `safe_fs.ts` 的 `as any`

```typescript
// utils/safe_fs.ts:34
fs.readdirSync(path, options as any)
```

这是 Node.js `fs` API 的类型兼容性问题。如果 `options` 是 Node.js 版本间有差异的类型，可以通过 `@types/node` 版本更新或显式类型声明修复：

```typescript
// 方案：定义精确的 options 类型
const readdirOptions: { withFileTypes: true } = { withFileTypes: true };
fs.readdirSync(path, readdirOptions);
```

---

## 三、实施分级

### 优先级 1：JSON.parse 收敛（低风险，高收益）

创建 `safeJsonParse` / `safeJsonParseWith`，逐步替换所有 `JSON.parse(x) as unknown`。

不影响运行时行为——仅是包装层。可以渐进式替换（每次替换一个调用方，运行测试确认无回归）。

### 优先级 2：边车 IPC 契约化（中风险）

为每个边车方法添加 Zod schema，建立类型化的 `invokeSidecarMethod` 包装器。

影响运行时——如果 schema 定义与实际边车响应不匹配，会导致运行时验证失败。需要在添加 schema 前审查边车 Rust 代码的响应结构。

### 优先级 3：`as unknown[]` 清理（低风险）

逐个替换为类型守卫函数。纯类型层面变更。

### 优先级 4：`safe_fs.ts` 的 `as any`（低风险，低优先级）

单文件单行，影响面最小。可在任意阶段处理。

---

## 四、特别说明：`JSON.parse as unknown` 保留方案

如果全面替换 `JSON.parse(x) as unknown` 为 `safeJsonParse(x)` 的工作量过大（~30 处），可接受一个"不做"决策：

**保留现有 `JSON.parse(x) as unknown`，但统一注释和 lint 规则**：

```typescript
// 在 eslint 配置中为特定文件/模式禁用 no-unsafe-type-assertion
// 或在每处添加标准注释：
const parsed = JSON.parse(value) as unknown; // boundary: JSON.parse returns any
```

这不是理想的类型安全状态，但每处 `JSON.parse as unknown` 后面都跟着运行时类型守卫，实际风险极低。与 DI 容器、WorldEngineSessionContext、CalendarConfig 等问题不同——那些是类型架构缺陷；`JSON.parse as unknown` 是 TypeScript 标准库缺陷的标准化防御。

**如果选择此方案，重心应放在确保每处 `JSON.parse as unknown` 后都紧跟适当的运行时验证（类型守卫或 Zod schema），而非消除 `as unknown` 本身。**

---

## 五、实施步骤

### 步骤 1：创建 `safe_json.ts`

在 `apps/server/src/utils/` 下创建 `safe_json.ts`，导出 `safeJsonParse` 和 `safeJsonParseWith`。

### 步骤 2：逐步替换 JSON.parse 调用方

按目录优先级替换：

1. `ai/providers/`（最关键的边界——外部 API 响应）
2. `packs/storage/`（存储层 JSON）
3. `plugins/`（插件系统）
4. 其余

每次替换后运行相关测试确认无回归。

### 步骤 3：添加边车 IPC 契约

1. 审查每个 Rust 边车的实际输入/输出格式
2. 定义对应的 Zod schema
3. 创建 `invokeSidecarMethod` 包装器
4. 修改边车客户端使用新包装器

### 步骤 4：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
```

---

## 六、验证标准

```bash
# 直接 JSON.parse(x) as unknown 的数量减少
grep -rn "JSON.parse.*as unknown" --include="*.ts" apps/server/src/ | wc -l
# 预期：显著减少（如使用了 safeJsonParse）或保持不变（如选择保留方案且有文档记录）

# 边车客户端中无 as unknown as Record
grep -rn "as unknown as Record<string, unknown>" apps/server/src/app/runtime/sidecar/
grep -rn "as unknown as Record<string, unknown>" apps/server/src/memory/blocks/rust_sidecar_client.ts
# 预期：空

# 类型检查通过
pnpm typecheck
```
