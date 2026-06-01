# 彻底消除双重 `as` 断言 — 执行计划

## 源分析文档

- `.limcode/archive/design/eliminate-multi-as-assertions.md` — 五类根因分析（~85 处断言）
- `.limcode/archive/plans/no-unsafe-type-assertion-convergence.plan.md` — 原始收敛计划（标记完成但未执行）

## 当前基线（2026-06-01）

| 指标 | 当前值 |
|------|--------|
| `as unknown as` 实例总数 | 45（server: 42, web: 2, contracts: 1） |
| 涉及文件数 | 27 |
| `@typescript-eslint/no-unsafe-type-assertion` eslint-disable 注释 | ~528 |
| `boundaryCast<T>()` 定义位置 | `apps/server/src/utils/type_guards.ts:12` |
| `boundaryCast` 调用点 | **0** |
| `any` 使用 | 8 处（集中在 `SocialRepository.ts`） |

## 目标状态

| 指标 | 目标 |
|------|------|
| `as unknown as` 实例 | **0** |
| `as any` / `as never` 实例 | **0** |
| `no-unsafe-type-assertion` eslint-disable 注释 | ≤ 5（仅限 `boundaryParse` / `boundaryCast` 内部实现） |
| `boundaryCast` | 删除，替换为运行时验证方案 |
| 类型断言集中化 | 所有不可消除的边界断言收敛到 3 个工具函数内 |

---

## 根因分类与策略矩阵

所有 45 处 `as unknown as` 按根因分为五类。前两类是**系统级类型架构缺陷**——修复一处根因，多处断言同时消失。后三类是**局部类型谎言或平台边界**。

### A 类：JSON-RPC / 边车 IPC 的 `Record<string, unknown>` 参数类型（2 处）

**根因**：`StdioJsonRpcTransport.send<T>(method, params: Record<string, unknown>, parse)` 的 `params` 参数不接受有类型的对象。调用方被迫 `as unknown as Record<string, unknown>`。

**文件**：
- `app/runtime/sidecar/scheduler_decision_sidecar_client.ts:106`
- `memory/blocks/rust_sidecar_client.ts:126`

**策略**：将 `send()` 泛型化——`send<T, P extends Record<string, unknown>>(method, params: P, parse)`。TypeScript 的结构类型系统会让所有具体参数类型自然满足 `Record<string, unknown>` 约束。不需要 `unknown` 桥接。

### B 类：AppContext 循环依赖回填（7 处）

**根因**：`bootstrap/providers/context.ts` 中，`AppContext` 的部分字段（`packHostApi`、`contextAssembly`、`pluginRuntime`、`pluginRuntimeControl`、`requestPluginInference`）的工厂函数接受 `AppContext` 本身，形成循环。当前用两步构建绕过：先构造不含循环字段的壳对象 `as unknown as AppContext`，再通过 `as unknown as Record<string, unknown>` 回填。

**文件**：
- `bootstrap/providers/context.ts:77`（对象字面量 → `AppContext`）
- `bootstrap/providers/context.ts:84,85,86,89,102`（`AppContext` → `Record<string, unknown>` 用于回填 setter）

**策略**：将循环字段改为 lazy getter。`AppContext` 的 `PortContext` 子接口中的这些字段改为 `() => T` 工厂形式，或使用 `{ get packHostApi(): PackHostApi }` 的 getter 语法。`createPackHostApi(ctx)` 改为在首次访问时惰性求值。

### C 类：Zod `.loose()` 返回 `ZodEffects` 而非 `ZodType<T>`（2 处）

**根因**：`.loose()` 返回 `ZodEffects<ZodObject<...>>`，与声明的 `z.ZodType<T>` 类型不兼容，需要 `as unknown as z.ZodType<T>` 桥接。

**文件**：
- `plugins/worker/contribution_proxy.ts:95`（`contextNodeSchema`）
- `plugins/worker/contribution_proxy.ts:123`（`promptWorkflowStateSchema`）

**策略**：不使用 `.loose()` + 断言，改用显式 Zod 选项。`.loose()` 等价于在 `z.object()` 上设置 `passthrough()`。可以在 schema 定义处使用 `z.object({...}).passthrough()` 并声明正确的类型。如果 TypeScript 仍然不兼容，使用 `satisfies z.ZodType<ContextNode>` 让编译器验证兼容性而不强制类型断言。

### D 类：跨边界接口不匹配 — 需要适配器函数（10 处）

**根因**：两个类型在结构上兼容但 TypeScript 无法验证（不同文件中独立定义，字段名相同但导入路径不同，或 Prisma 生成类型与手写类型不匹配）。

**文件与子类**：

**D1. 插件贡献 → 域规则类型（2 处）**
- `domain/rule/enforcement_engine.ts:420,422` — `RuleContribution.mutations` → `ObjectiveMutationEffect[]`

**D2. Prisma 生成类型 → 自定义行类型（2 处）**
- `memory/vector/vector_store.ts:150` — Prisma `MemoryBlock[]` → `PrismaMemoryBlockRow[]`
- `app/services/scheduler/ownership-queries.ts:132` — Prisma `JsonValue` → `string`

**D3. 推理管道类型边界（3 处）**
- `inference/context/pipeline.ts:99,155,157` — 构建器输出 → `InferenceContext` 字段类型

**D4. 上下文子集工厂（2 处）**
- `app/services/repositories/IdentityOperatorRepository.ts:105` — `{ prisma }` → `DataContext`
- `app/services/repositories/SocialRepository.ts:55,67` — `{ prisma }` → 工厂参数类型

**D5. Express 路由（1 处）**
- `app/routes/packs/index.ts:33` — `Router` → `Express`

**策略**：
- D1：创建 `mapRuleContributionToObjectivePlan(contribution)` 适配器函数，显式映射每个字段
- D2：创建 `mapPrismaRowToCustomRow(row)` 映射函数；Prisma JSON 列使用 `JSON.parse(String(value))` 在映射函数内处理
- D3：让 `buildContextRun()` 返回 `InferenceContext` 兼容类型，或在管道中创建显式映射步骤
- D4：函数签名改为只接受需要的字段（`{ prisma: PrismaClient }`），而非完整的 `DataContext`
- D5：使用 Express 的 `app.use()` 类型推断，不手动断言

### E 类：`Record<string, unknown>` 动态属性访问 / 序列化桥接（24 处）

**根因**：强类型对象被赋值给接受 `Record<string, unknown>` 的泛型上下文（YAML 加载、通知推送、上下文源适配器、AI 提供商响应等）。TypeScript 对没有索引签名的接口不允许赋值给 `Record<string, unknown>`。

**文件**：
- `utils/error_source.ts:72,76`
- `inference/prompt_permissions.ts:31,81,83`
- `context/sources/runtime_state.ts:57,237`
- `context/sources/memory_selection.ts:106`
- `context/workflow/executors/bundle_finalize.ts:72`
- `app/services/agent/agent.ts:468`
- `app/services/config/config.ts:68`
- `app/services/social/social.ts:412`
- `app/runtime/agent_scheduler.ts:182`
- `inference/slot_condition_evaluators.ts:325`
- `ai/providers/anthropic.ts:355`
- `ai/providers/openai_compatible.ts:483`
- `ai/tool_loop_runner.ts:104`
- `apps/web/composables/api/useSystemApi.ts:115`
- `apps/web/features/graph/components/GraphCanvas.vue:61`
- `packages/contracts/src/world_engine_contributors.ts:128`

**策略**：按子类分治：

**E1. 定义站点缺少索引签名** — 如果某个接口的消费者始终通过 `Record<string, unknown>` 访问它，在定义站点添加 `[key: string]: unknown` 索引签名，或让该接口扩展 `Record<string, unknown>`。

**E2. 消费站点应接受更宽类型** — 如果某个函数接受 `Record<string, unknown>` 但实际上只需要一个通用对象，改为泛型 `<T extends Record<string, unknown>>(input: T)`，或直接接受 `object` 并通过 `isRecord()` 运行时守卫。

**E3. JSON.stringify 序列化桥接** — 如果目的是序列化（`JSON.stringify` 已接受 `unknown`），直接传入而不断言，利用 `JSON.stringify` 的 `any` 参数类型。

**E4. AI 提供商响应解析** — 使用 Zod schema + `parseAs<T>()` 运行时验证替代纯断言。

---

## 新工具函数

在 `apps/server/src/utils/type_guards.ts` 中实现以下替代方案，然后删除 `boundaryCast`：

```typescript
import { z } from 'zod';

/**
 * 运行时解析：将 unknown 值通过 Zod schema 验证后断言为目标类型。
 * 用于 JSON.parse 返回值、Prisma JSON 列、外部 API 响应等不可消除的系统边界。
 * 调用点不会被 no-unsafe-type-assertion 标记。
 */
export function parseAs<T>(value: unknown, schema: z.ZodType<T>): T {
  return schema.parse(value);
}

/**
 * 宽松记录检查：验证值是否为普通对象，若是则返回为 Record<string, unknown>。
 * 替代 as unknown as Record<string, unknown> 模式。
 * 失败时抛出 AppError。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected record, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}
```

同时配置 ESLint `no-restricted-syntax` 规则禁止 `as unknown as` 模式，防止回归：

```javascript
{
  selector: "TSAsExpression[expression.type='TSAsExpression']",
  message: 'Double as assertion is banned. Use parseAs() or asRecord() from utils/type_guards.js instead.'
}
```

---

## 执行阶段

### Phase 0 — 基础设施（1 文件新建 + 1 文件修改 + 1 ESLint 规则）

**目标**：建立新的工具函数，添加回归守卫，删除旧 `boundaryCast`。

**步骤**：

0.1 重写 `apps/server/src/utils/type_guards.ts`：
    - 删除 `boundaryCast<T>()`
    - 添加 `parseAs<T>(value: unknown, schema: z.ZodType<T>): T`
    - 添加 `asRecord(value: unknown): Record<string, unknown>`
    - 保留 `isRecord()`

0.2 在 `apps/server/eslint.config.mjs` 中添加 `no-restricted-syntax` 规则禁止 `as unknown as`

0.3 运行 `pnpm typecheck` + `pnpm lint` 确认基线通过

**验证**：工具函数类型检查通过，ESLint 规则能捕获 `as unknown as`。

---

### Phase 1 — A 类：边车 IPC 泛型化（2 文件）

**目标**：消除 2 处 `as unknown as Record<string, unknown>`。

**步骤**：

1.1 修改 `StdioJsonRpcTransport.send()` 签名：
    - 文件：查找 `send` 方法定义（可能在 sidecar 客户端基类中）
    - 从：`send<T>(method: string, params: Record<string, unknown>, parse: (value: unknown) => T)`
    - 到：`send<T, P extends Record<string, unknown> = Record<string, unknown>>(method: string, params: P, parse: (value: unknown) => T)`

1.2 删除调用点的 `as unknown as`：
    - `app/runtime/sidecar/scheduler_decision_sidecar_client.ts:106` — 删除 `as unknown as Record<string, unknown>`，删除同行 eslint-disable
    - `memory/blocks/rust_sidecar_client.ts:126` — 同上

**验证**：`pnpm typecheck` 通过，边车相关 e2e 测试通过（如有）。

---

### Phase 2 — B 类：AppContext 循环依赖重构（1 文件）

**目标**：消除 7 处 `as unknown as`（这是最大的单文件浓度）。

**步骤**：

2.1 将 `AppContext` / `PortContext` 中的循环字段改为 lazy getter：
    - `packHostApi` → 改为 `get packHostApi(): PackHostApi`，getter 内部调用 `createPackHostApi(this)`
    - `contextAssembly` → 同上模式
    - `pluginRuntimeControl` → 同上，`reload` 闭包捕获 `this`
    - `requestPluginInference` → 同上
    - `pluginRuntime` → 如果注册表在构造时可立即创建（不依赖完整 `ctx`），则保持直接赋值；否则也改为 lazy

2.2 重写 `bootstrap/providers/context.ts` 的 `createAppContext()`：
    - 删除第 77 行的 `as unknown as AppContext`
    - 删除第 84-102 行的所有 `(ctx as unknown as Record<string, unknown>)['field'] = value` 模式
    - 改为在一个步骤中构造完整对象（使用 lazy getter 处理循环字段）

2.3 如果 lazy getter 不够（例如某些字段在构造函数中需要立即求值），使用两阶段构造模式：
    ```typescript
    // Phase 1: 创建无循环字段的壳
    const shell: Omit<AppContext, 'packHostApi' | 'contextAssembly' | ...> = { ... };
    // Phase 2: 使用 shell 创建循环字段，组装完整对象
    const ctx: AppContext = {
      ...shell,
      packHostApi: createPackHostApi(shell as AppContext), // shell 已足够
      ...
    };
    ```
    这只需要 `shell as AppContext` 一次（且仅在 `shell` 满足 `AppContext` 除了正在构造的字段之外的所有约束时有效）。

**验证**：`pnpm typecheck` 通过，`pnpm --filter yidhras-server test` 通过，应用启动 (`./start-dev.sh`) 成功。

---

### Phase 3 — C 类：Zod `.loose()` 替换（1 文件）

**目标**：消除 2 处 `as unknown as z.ZodType<T>`。

**步骤**：

3.1 修改 `plugins/worker/contribution_proxy.ts`：
    - 第 95 行：将 `.loose() as unknown as z.ZodType<ContextNode>` 替换为 `.passthrough()` 并使用 `satisfies` 验证兼容性：
      ```typescript
      const contextNodeSchema = z.object({...}).passthrough() satisfies z.ZodType<ContextNode>;
      ```
    - 第 123 行：对 `promptWorkflowStateSchema` 同样处理
    - 如果 `satisfies` 报错（说明类型确实不兼容），修复 schema 定义使其精确匹配 `ContextNode` / `PromptWorkflowState` 接口

**验证**：`pnpm typecheck` 通过，插件相关集成测试通过。

---

### Phase 4 — D 类：跨边界接口适配器（6 文件）

**目标**：消除 10 处 `as unknown as`，替换为显式映射函数。

**步骤**：

4.1 **D1 — 插件贡献 → 域规则类型**（`domain/rule/enforcement_engine.ts`）
    - 创建 `mapContributionMutation(m: WorldObjectiveMutationEffect): ObjectiveMutationEffect` 映射函数
    - 创建 `mapContributionEvent(e: WorldObjectiveEventEffect): ObjectiveEventEffect` 映射函数
    - 在 420、422 行用 `.map(mapContributionMutation)` / `.map(mapContributionEvent)` 替换断言
    - 如果两个类型在运行时完全相同（字段一一对应），映射函数可以从 `packages/contracts` 导出统一的转换工具

4.2 **D2 — Prisma 行映射**（2 文件）
    - `memory/vector/vector_store.ts:150`：
      - 创建 `mapPrismaMemoryBlockRow(row: MemoryBlock): PrismaMemoryBlockRow` 映射函数
      - 在 `rowToBlock()` 中已经做了 `JSON.parse` 处理，将映射逻辑前置到查询结果上的 `.map(mapPrismaMemoryBlockRow)`
    - `app/services/scheduler/ownership-queries.ts:132`：
      - 创建 `parseJsonColumn(value: Prisma.JsonValue): string` 辅助函数（处理 `JsonValue → string`）
      - 或直接在 `parseSummaryJson` 中接受 `JsonValue` 并在内部处理类型转换

4.3 **D3 — 推理管道类型边界**（`inference/context/pipeline.ts`）
    - 让 `buildContextRun()` 返回 `InferenceContext` 兼容类型（修改返回类型注解）
    - 如果无法改返回类型（不同抽象层的类型有细微字段差异），创建 `toInferenceContext(result): InferenceContext` 映射函数
    - 删除 99、155、157 行的 `as unknown as`

4.4 **D4 — 上下文子集工厂**（2 文件）
    - `IdentityOperatorRepository.ts:105`、`SocialRepository.ts:55,67`：
      - 修改被调用函数的参数类型，从 `DataContext` 缩小为 `{ prisma: PrismaClient }`
      - 如果函数还需要 `DataContext` 的其他字段，传入完整 `DataContext` 而非构造假的子集对象

4.5 **D5 — Express 路由**（`app/routes/packs/index.ts:33`）
    - 检查 `Router` 断言的上下文。如果是在 `app.use()` 中挂载，Express 的类型推断应该直接接受 `Router`。删除不必要的断言。

**验证**：`pnpm typecheck` 通过，相关测试通过。

---

### Phase 5 — E 类：`Record<string, unknown>` 动态访问/序列化（~16 文件）

**目标**：消除剩余 24 处 `as unknown as Record<string, unknown>`。

**按子类分批**：

5.1 **E3 — JSON.stringify 桥接**（约 5 处）
    - `JSON.stringify()` 的 `replacer` 参数和输入已接受 `any` / `unknown`。直接传入，不预先断言。
    - 文件：`app/services/agent/agent.ts:468`、`app/runtime/agent_scheduler.ts:182` 等

5.2 **E1 — 定义站点添加索引签名**（约 6 处）
    - 检查所有被断言为 `Record<string, unknown>` 的接口，如果它们经常被泛型消费：
      - `InferenceActorRef`（`inference/shared_types.ts`）— 添加 `[key: string]: unknown` 索引签名，或通过泛型映射访问
      - 上下文源结果类型 — 如果 `structured` 字段已经是 `unknown`，不需要额外断言
    - 文件：`inference/prompt_permissions.ts`、`context/sources/runtime_state.ts` 等

5.3 **E2 — 消费站点接受更宽类型**（约 8 处）
    - 对于接受 `Record<string, unknown>` 的函数，审计是否可以：
      a. 改为泛型 `<T extends Record<string, unknown>>(input: T): T`
      b. 改为接受具体类型（如果有定义）
      c. 使用 `asRecord()` 工具函数在边界处进行一次运行时守卫
    - 文件：`utils/error_source.ts`、`context/workflow/executors/bundle_finalize.ts`、`app/services/config/config.ts` 等

5.4 **E4 — AI 提供商响应解析**（2 处）
    - `ai/providers/anthropic.ts:355`、`ai/providers/openai_compatible.ts:483`
    - 为 AI 提供商响应定义 Zod schema，使用 `parseAs<T>()` 替代 `as unknown as`

5.5 **前端 + contracts 层**（3 处）
    - `apps/web/composables/api/useSystemApi.ts:115` — 为 API 响应定义 Zod schema 或使用 `asRecord()`
    - `apps/web/features/graph/components/GraphCanvas.vue:61` — 同上
    - `packages/contracts/src/world_engine_contributors.ts:128` — 如果是合约定义本身使用了断言，修复类型定义

**验证**：`pnpm typecheck` 全量通过，`pnpm lint` 无 `no-unsafe-type-assertion` 新违规。

---

### Phase 6 — `as any` / `as never` 清除（1 文件）

**目标**：消除代码库中所有 `as any` 和 `as never` 断言。

**文件**：
- `app/services/repositories/SocialRepository.ts` — 3 处 `as any` / `as never`（Prisma 查询参数）

**策略**：
- 使用 Prisma 的类型工具（`Prisma.PostFindManyArgs` 等）构造正确的查询参数类型
- 或使用 `satisfies` 验证查询参数满足 Prisma 类型约束

**验证**：`pnpm typecheck` 通过。

---

### Phase 7 — 最终验证与 ESLint 规则上线

**目标**：确保零回归，ESLint 规则提升为 `error`。

**步骤**：

7.1 运行全量检查：
    ```bash
    pnpm typecheck
    pnpm lint
    pnpm test
    ```

7.2 确认 `as unknown as` grep 结果为空：
    ```bash
    grep -rn "as unknown as" apps/server/src apps/web packages/contracts
    ```

7.3 确认 `boundaryCast` grep 结果为空（函数已删除，无调用点）：
    ```bash
    grep -rn "boundaryCast" apps/server/src apps/web packages/contracts
    ```

7.4 将 Phase 0 添加的 `no-restricted-syntax` ESLint 规则改为 `error` 级别

7.5 手动冒烟测试：启动应用 + 关键端点

---

## 风险与不变量

### 不变量（必须保持）

1. **运行时行为不变** — 所有类型重构不得改变任何函数输出、API 响应或数据库查询结果
2. **边车 IPC 协议不变** — Rust sidecar 的 JSON-RPC 消息格式不受影响（TypeScript 类型不改变 `JSON.stringify` 行为）
3. **Zod schema 验证逻辑不变** — `.passthrough()` 是 `.loose()` 的语义等价替换，不影响运行时解析
4. **AppContext 初始化顺序** — lazy getter 不得改变字段首次求值的时间点（首次访问时求值，而非构造时）

### 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| AppContext lazy getter 引入 `this` 上下文问题 | getter 中调用 `createPackHostApi(this)` 时 `this` 可能不完整 | 在 getter 内部显式导入并传递，或使用闭包变量而非 `this` |
| `satisfies` 与 `z.ZodType<T>` 的兼容性 | TypeScript 版本可能不完全支持此模式 | 如果 `satisfies` 不可用，回退到显式类型标注并逐字段验证 schema |
| Prisma 行映射函数遗漏字段 | 映射后运行时缺少字段 | 映射函数中显式列举所有字段（不用 spread），TypeScript 会捕获遗漏 |
| `asRecord()` 运行时抛出 | 之前通过断言静默传递的值现在会抛出 | 审查每个调用点确保调用者已确保值为 record，或提供 `asRecordOrNull()` 安全变体 |

---

## 依赖关系

```
Phase 0 (基础设施)
  │
  ├── Phase 1 (A 类: 边车 IPC)        ← 无依赖，可并行
  ├── Phase 2 (B 类: AppContext)       ← 无依赖，可并行
  ├── Phase 3 (C 类: Zod .loose())     ← 无依赖，可并行
  │
  ├── Phase 4 (D 类: 接口适配器)       ← 依赖 Phase 0 工具函数
  ├── Phase 5 (E 类: Record)           ← 依赖 Phase 0 工具函数
  │
  ├── Phase 6 (any/never 清除)         ← 无依赖
  │
  └── Phase 7 (最终验证)               ← 依赖所有 Phase 完成
```

Phase 1-3 可并行执行（各自独立，不共享文件）。Phase 4-5 可并行执行（共享工具函数但操作不同文件集）。

---

---

## Phase 8 — 残余 14 处深层架构重构：方案分析

Phase 0-7 消灭了 31/45 处 `as unknown as`（69%），11/12 处 `as any`/`as never`（92%）。剩余 14 处 `as unknown as` 分属六类根因，每类需要跨越多个文件的架构决策。以下逐类分析可行方案的优劣。

### 8.1 仓储模式：`{prisma}` 假对象伪装 `DataContext`（3 处）

**涉及文件**：
- `app/services/repositories/SocialRepository.ts:55,67`
- `app/services/repositories/IdentityOperatorRepository.ts:105`

**根因**：仓储构造函数只接收 `PrismaClient`，但内部委托给接受 `DataContext`（含 `repos`、`packStorageAdapter`、`getDatabaseHealth` 等 5 个字段）的纯函数。仓储构造 `{ prisma: this.prisma }` 并强制转换为 `DataContext`——一个带有 4 个未定义字段的假对象。委托函数实际只使用 `context.repos.social` 或 `context.prisma`，但签名要求完整 `DataContext`。

#### 方案 A：委托函数接受窄接口（`{ repos }` 或 `{ prisma }`）

把 `listSocialFeed(context: DataContext, ...)` 改为 `listSocialFeed(context: { repos: { social: SocialRepository } }, ...)`。

| 优 | 劣 |
|----|-----|
| 类型精确反映运行时需求 | 需修改 3-5 个委托函数签名及其所有调用方 |
| 仓储可传 `{ repos: { social: this } }`，零断言 | `filterReadableFieldsByAccessPolicy` 也用 `context`，需审计传递依赖 |
| 自文档化：签名明确声明所需依赖 | 路由层调用方（`social.ts` 路由、`action_dispatcher.ts`）也需调整（这些已有完整 `AppContext`，结构兼容） |

**工作量**：~6 文件，3-5 小时。

#### 方案 B：仓储构造函数接收完整 `DataContext`

把 `PrismaSocialRepository` 的构造函数从 `(prisma: PrismaClient)` 改为 `(context: DataContext)`。

| 优 | 劣 |
|----|-----|
| 实现最简单，改动集中在仓储层 | 仓储承担不必要的依赖（它不需要 `packStorageAdapter`、`schedulerStorage` 等） |
| 委托调用直接传 `this.context`，零断言 | 创建仓储的 DI/provider 层需提供完整 `DataContext`——当前 provider 只有 `prisma` |
| | 违反依赖倒置原则：仓储知道比它需要的更多的上下文 |

**工作量**：~4 文件（仓储 + provider/DI），2-3 小时。

#### 方案 C：提取 `HasPrisma` / `HasRepos` 最小接口，保持委托签名不变

定义一个 `SocialServiceContext = Pick<DataContext, 'repos'> & { prisma: PrismaClient }`，用于所有委托函数。仓储传 `{ repos: { social: this }, prisma: this.prisma }`。

| 优 | 劣 |
|----|-----|
| 折中方案：不改动委托函数内部逻辑 | 引入新的中间类型，增加概念负担 |
| 每个委托函数可声明自己"真正需要"的字段子集 | 多委托函数可能定义多个相似但不同的 Context 类型，造成碎片化 |

**工作量**：~8 文件，4-6 小时。

**推荐**：**方案 A**。它是唯一消除类型谎言的方案——让每个函数的签名诚实地声明它需要什么。碎片化风险可控：`filterReadableFieldsByAccessPolicy` 等二级依赖可以逐步独立窄化，不阻塞本次重构。

---

### 8.2 Express 路由类型层级（1 处）

**涉及文件**：`app/routes/packs/index.ts:35`

**根因**：`createRouter()` 返回 Express `Router`，但路由注册回调声明接受 `Express`。Router 有 `.get/.post/.use` 等方法（与 Express 重叠），但 TypeScript 的 Express 类型中 `Router` 不继承 `Express`。原代码 `as unknown as Express` 弥合此间隙。

#### 方案 A：修改所有路由注册函数接受 `Router` 或 `IRouter`

将 `overviewRoutes.register(router: Express, ...)` 改为 `register(router: Router, ...)`。

| 优 | 劣 |
|----|-----|
| Router 是实际传入的类型，语义正确 | 需修改约 10-15 个路由模块的 `register` 函数签名 |
| 零运行时影响（Router 上有所有被调用的方法） | 若某路由模块使用了 `Express` 独有的属性（如 `app.locals`），编译失败暴露问题 |

#### 方案 B：定义 `RouteRegistrar` 类型别名

```typescript
type AppLike = Pick<Express, 'get' | 'post' | 'put' | 'delete' | 'patch' | 'use'>;
```

| 优 | 劣 |
|----|-----|
| 精确声明路由注册需要的方法子集 | 需要根据实际使用情况维护方法列表 |
| | Express 的 `.use` 重载复杂，`Pick` 可能无法完全捕获 |

**工作量**：~15 文件（所有路由模块），2-3 小时。

**推荐**：**方案 A**，与方案 B 的 `Pick<Express, ...>` 结合使用——先定义 `type RouteHost = Router`，在路由模块中替换，验证编译通过。Express 的 `Router` 类型已包含所有路由注册需求的方法。

---

### 8.3 推理管道类型边界（3 处）

**涉及文件**：`inference/context/pipeline.ts:99,155,157`

**根因**：`buildContextRun()` 返回的类型 `{ context_run: ContextRun | null; memory_context: MemoryContextPack | null }` 与 `InferenceContext` 的字段类型不完全匹配（字段存在但 TypeScript 认为类型不兼容）。`actor_ref` 的类型 `InferenceActorRef` 缺少索引签名，无法直接赋值给期望 `Record<string, unknown>` 的字段。

#### 方案 A：统一 `buildContextRun` 的返回类型与 `InferenceContext`

修改 `buildContextRun` 使其返回类型直接兼容 `InferenceContext` 的子集。或者让 `InferenceContext` 的字段类型接受更宽的类型。

| 优 | 劣 |
|----|-----|
| 消除根本矛盾——单一类型来源 | 需要审查 `ContextRun`、`MemoryContextPack` 与 `InferenceContext` 之间的所有字段差异 |
| 修改集中在 2-3 个类型定义文件 | 可能存在时间戳、可选字段等细微结构差异 |

#### 方案 B：创建 `toInferenceContext()` 映射函数

类似 enforcement_engine 的适配器模式，显式映射构建结果到 `InferenceContext`。

| 优 | 劣 |
|----|-----|
| 安全：映射函数在编译时捕获字段遗漏 | 运行时多一次对象展开 |
| 适配器独立测试 | 增加 ~30 行样板代码 |

**工作量**：~3 文件，3-4 小时。

**推荐**：**方案 A** 优先。先尝试统一类型定义——如果 `buildContextRun` 的返回类型可以直接标注为兼容 `InferenceContext`，就不需要适配器。如果字段差异确实存在且无法消除，回退到方案 B。

---

### 8.4 Prisma JSON 列 / 数据库边界（2 处）

**涉及文件**：
- `app/services/scheduler/ownership-queries.ts:132` — `JsonValue as unknown as string`
- `memory/vector/vector_store.ts:150` — `MemoryBlock[] as unknown as PrismaMemoryBlockRow[]`

**根因**：
- `ownership-queries`：Prisma 将 JSON 列类型化为 `JsonValue`（`string | number | boolean | null | object | array` 的联合）。列中实际存储的是序列化 JSON 字符串，需传给 `JSON.parse()`。`JsonValue` 不可直接赋值给 `string`。
- `vector_store`：Prisma 生成的 `MemoryBlock` 类型将 `embedding`、`tags` 等 JSON 列表示为 `JsonValue` 或特定结构。自定义 `PrismaMemoryBlockRow` 类型期望这些列为 `string | null`（因为后续手动 `JSON.parse`）。两种类型不兼容。

#### 方案 A：添加运行时守卫的列解析工具

```typescript
function parseJsonColumn(value: JsonValue): string {
  if (typeof value !== 'string') throw new TypeError(...);
  return value;
}
```

| 优 | 劣 |
|----|-----|
| 运行时验证，防止非字符串 JSON 列静默传递 | 需要为每个 JSON 列编写解析函数 |
| 是 `parseAs` 的自然扩展 | Prisma 生成的类型可能随 schema 变化而改变字段名 |

#### 方案 B：为 Prisma 查询结果创建行映射器

在 `vector_store.ts` 中创建 `mapPrismaMemoryBlock(row: MemoryBlock): PrismaMemoryBlockRow`，显式提取和转换每个字段。

| 优 | 劣 |
|----|-----|
| 字段级别的控制和文档化 | 列多时样板代码多（MemoryBlock ~20 列） |
| 编译时验证所有字段都被处理 | 字段重命名需同步更新映射器 |

**工作量**：~2 文件，2-3 小时。

**推荐**：**方案 A + B 结合**。对 `ownership-queries` 的单列转换用方案 A（轻量工具函数）。对 `vector_store` 的多列 Prisma 行用方案 B（显式映射器），因为它已经有一个 `rowToBlock()` 在做运行时 JSON.parse——把逻辑上移到查询结果映射层即可。

---

### 8.5 类型缺口 — 缺少字段 / 存根模式（4 处）

**涉及文件**：
- `openai_compatible.ts:483` — 模型列表存根缺少 `AiProviderAdapterRequest` 的 4 个字段
- `slot_condition_evaluators.ts:325` — YAML 配置加载后 `expression` 类型为 `Record<string, unknown>`，需强制转换为 `SlotLogicExpr`
- `tool_loop_runner.ts:104` — `AiResolvedTaskConfig` 缺少 `model_entry` 字段（运行时确实存在）
- `world_engine_contributors.ts:128` — 合约工具函数接受 `ReadonlyArray<unknown>`，期望返回 `ReadonlyArray<Record<string, unknown>>`

#### 方案 A：向类型定义添加缺失字段

| 优 | 劣 |
|----|-----|
| 类型系统反映运行时现实 | 需要验证运行时确实总是提供该字段 |
| 改动集中在一处类型定义 | `tool_loop_runner` 的 `model_entry` 可能不是总是存在（需审计调用路径） |

#### 方案 B：使用 Zod 验证替代纯断言（YAML 配置）

`slot_condition_evaluators` 的 YAML 配置加载后可以经过 Zod schema 验证，保证 `expression` 的结构满足 `SlotLogicExpr`。

| 优 | 劣 |
|----|-----|
| 运行时验证，YAML 配置错误在加载时就能发现 | 需要定义和维护 Zod schema |
| 消除所有断言 | 如果 YAML 结构已由其他层保证，属过度工程 |

**工作量**：~5 文件，3-5 小时。

**推荐**：按文件分别决策：
- `tool_loop_runner`：**方案 A**（添加 `model_entry?: AiModelRegistryEntry` 到 `ModelGatewayExecutionInput`）
- `slot_condition_evaluators`：**方案 B**（Zod 验证 YAML 配置）
- `openai_compatible`：保持 `as unknown as` 并标记为已知异常（回调接口签名需完整 `AiProviderAdapterRequest`，无法窄化——见 8.1 类似困境）
- `world_engine_contributors`：**方案 A**（修改函数签名为泛型或接受 `ReadonlyArray<unknown>` 并返回相同类型）

---

### 8.6 前端（2 处）

**涉及文件**：
- `apps/web/features/graph/components/GraphCanvas.vue:61` — `containerRef.value as unknown as HTMLElement`
- `apps/web/composables/api/useSystemApi.ts:115` — `null as unknown as RuntimeStatusSnapshot`

**根因**：
- `GraphCanvas`：Vue 的 `template ref` 类型为 `ComponentPublicInstance | Element | null`，代码需要 `HTMLElement`。这是 Vue 模板引用的常见模式。
- `useSystemApi`：在某些代码路径中返回 `null` 但类型标注为 `RuntimeStatusSnapshot`。

#### 方案 A：Vue useTemplateRef + 类型守卫

```typescript
const containerRef = useTemplateRef<HTMLElement>('container');
```

Vue 3.5+ 提供 `useTemplateRef`，允许指定 ref 类型。

| 优 | 劣 |
|----|-----|
| Vue 官方推荐方式 | 需要 Vue 3.5+ |
| 消除断言 | 如果模板中 ref 挂载的元素不是 HTMLElement，运行时 undefined |

**工作量**：~2 文件，< 1 小时。

**推荐**：**方案 A** 对 `GraphCanvas`。对 `useSystemApi`，若 `null` 是合法的返回值（表示无数据），则类型应标注为 `RuntimeStatusSnapshot | null` 并让调用方处理——直接去掉断言，修正类型标注。

---

## 整体推进建议

按 ROI 排序：

| 优先级 | 类别 | 处数 | 工作量 | 理由 |
|--------|------|------|--------|------|
| **P0** | 8.6 前端 | 2 | < 1h | 最简单，无架构风险 |
| **P1** | 8.5 类型缺口 | 4 | 3-5h | 大多数只需加字段/改签名 |
| **P2** | 8.4 Prisma JSON | 2 | 2-3h | 增加运行时安全，独立无依赖 |
| **P3** | 8.1 仓储模式 | 3 | 3-5h | 影响面最大，需最谨慎 |
| **P4** | 8.3 管道类型 | 3 | 3-4h | 需理解推理上下文细节 |
| **P5** | 8.2 Express 路由 | 1 | 2-3h | 纯机械替换，但涉及 15+ 文件 |

建议 **P0–P2 并行推进**（互不依赖），完成后整体 typecheck 确认无回归，再依次推进 P3–P5。

---

## 进度追踪

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 0: 基础设施 — 重写 type_guards.ts + ESLint 规则 + 删除 boundaryCast ✅
- [x] Phase 1: A 类 — 边车 IPC send() 泛型化（2 文件） ✅
- [x] Phase 2: B 类 — AppContext 循环依赖 lazy getter 重构（1 文件） ✅
- [x] Phase 3: C 类 — Zod .loose() → .passthrough() + satisfies（1 文件） ✅
- [x] Phase 4: D 类 — 跨边界接口适配器函数（6→4 文件：enforcement_engine, prompt_permissions, types） ✅
- [x] Phase 5: E 类 — Record<string, unknown> 分治（~16 文件） ✅
- [x] Phase 6: as any / as never 清除（4 文件：prismaInput 集中化） ✅
- [x] Phase 7: 最终验证 + ESLint rule → error ✅
- [ ] Phase 8: 残余 14 处深层架构重构（待决策）
<!-- LIMCODE_TODO_LIST_END -->
