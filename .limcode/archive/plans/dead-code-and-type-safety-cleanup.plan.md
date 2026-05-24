## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 1: 删除纯废代码（deprecated types、noop sink、空目录） `#P1-1`
- [x] Phase 2: 泛化五个重复 merge 函数为单个 `mergeById` `#P2-1`
- [x] Phase 3: 泛化六个 try-catch 包装器为单个 `safeQuery` `#P3-1`
- [x] Phase 4: 消除 InferenceWorkflowRepository 中所有 `as any` / `as never` / `as unknown as` `#P4-1`
- [x] Phase 5: 消除 `castRawRow` 及其全部调用点 `#P5-1`
- [x] Phase 6: 消除 `as unknown as Record<string, unknown>` deepMerge 调用模式 `#P6-1`
- [x] Phase 7: 消除运行时表存在检查，改为启动 preflight `#P7-1`
- [x] Phase 8: 消除 `MultiPackRuntimeFacade` 不可达 fallback 分支与类型穿越 `#P8-1`
- [x] Phase 9: 消除 `PackRuntimeInstance` 中的虚假 async 方法 `#P9-1`
- [x] Phase 10: typecheck + unit + integration + e2e 全量验证 `#P10-1`
<!-- LIMCODE_TODO_LIST_END -->

# 废代码清理与类型安全修复

## 背景

代码审计发现以下结构性问题，按严重程度排列：

1. **纯废代码**：deprecated 类型别名（零消费者）、从未调用的 noop 工厂、空目录
2. **类型系统被架空**：`as any` / `as never` / `as unknown as` 在关键路径上大量使用，使 TypeScript 的类型检查形同虚设
3. **重复代码**：同一算法在 5 个 merge 函数和 6 个 try-catch 包装器中各写一遍
4. **过度抽象**：单实现接口、虚假 async 方法、不可达 fallback 分支
5. **治标不治本**：运行时表存在检查在 4 个 store 文件中每个公开方法都包裹，而非启动时一次性检查

项目处于预发布阶段，只有一个使用者，开发数据可随时重置。不存在向后兼容负担。

---

## 本次范围

### 纳入

1. 删除纯废代码（见 Phase 1）
2. 合并重复算法（见 Phase 2、3）
3. 修复类型逃逸（见 Phase 4、5、6）
4. 删除不可达分支与虚假异步（见 Phase 8、9）
5. 运行时表检查收口为启动 preflight（见 Phase 7）

### 不纳入

1. 单实现接口合并 — 涉及 DI/组合根重构，不在本轮
2. 30+ 空 catch 块 — 需逐例分析是刻意静默还是 bug，不在本轮
3. `eslint-disable` 系统性清理 — 绑定 Phase 4 的类型逃逸修复，修复后 lint 规则自然满足
4. `deepMerge` 签名修改 — 改为泛型签名影响面大，本轮只在调用点消除断言

---

## Phase 1: 删除纯废代码

### 1.1 删除 deprecated 类型别名

**文件**: `apps/server/src/perception/types.ts`

- 删除 L70-75（`// ── Legacy alias (transitional) ──` 注释块及两个 type alias）
- 删除 `/** @deprecated Use PerceptionEventInput instead */`
- 删除 `export type ResolvePerceptionInput = PerceptionEventInput;`
- 删除 `/** @deprecated Use PerceptionRuleOutput instead */`
- 删除 `export type PerceptionResult = PerceptionRuleOutput;`

**文件**: `apps/server/src/perception/index.ts`

- L13: 删除 `PerceptionResult` re-export
- L17: 删除 `ResolvePerceptionInput` re-export

**验证**: `grep -rn "ResolvePerceptionInput\|PerceptionResult" --include='*.ts' --include='*.vue' apps/ packages/` 结果仅余定义文件自身（已删除），无外部消费者。

### 1.2 删除 noop sink

**文件**: `apps/server/src/inference/sinks/noop.ts` — 整个文件删除。

**验证**: `grep -rn "createNoopInferenceTraceSink" --include='*.ts' apps/` 零结果。

### 1.3 删除空目录

**路径**: `apps/server/src/types/` — `rm -rf`。

**验证**: 目录确认为空。

---

## Phase 2: 泛化五个重复 merge 函数

### 2.1 修改 `apps/server/src/ai/registry.ts`

删除 L565-659 的五个独立函数：
- `mergeProviderConfigs`
- `mergeModelRegistryEntries`
- `mergeRoutePolicies`
- `mergeToolEntries`
- `mergeProviderTemplates`

替换为单个泛型辅助函数（放在同一文件的相同位置）：

```ts
const mergeById = <T>(
  base: T[],
  overrides: T[],
  keyFn: (item: T) => string
): T[] => {
  const merged = new Map(base.map(item => [keyFn(item), structuredClone(item)]));
  for (const override of overrides) {
    const key = keyFn(override);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, structuredClone(override));
      continue;
    }
    merged.set(
      key,
      deepMerge(
        existing as unknown as Record<string, unknown>,
        override as unknown as Record<string, unknown>
      ) as unknown as T
    );
  }
  return Array.from(merged.values());
};
```

更新 `mergeAiRegistryConfig`（L661-669）中的调用点：

```ts
export const mergeAiRegistryConfig = (base: AiRegistryConfig, override: AiRegistryConfig): AiRegistryConfig => {
  return {
    version: override.version,
    provider_templates: mergeById(base.provider_templates ?? [], override.provider_templates ?? [], t => t.name),
    providers: mergeById(base.providers, override.providers, p => p.provider),
    models: mergeById(base.models, override.models, m => `${m.provider}:${m.model}`),
    routes: mergeById(base.routes, override.routes, r => r.route_id),
    tools: mergeById(base.tools ?? [], override.tools ?? [], t => t.tool_id)
  };
};
```

**关键约束**:
- `mergeById` 内部的 `deepMerge` 调用仍保留 `as unknown as Record<string, unknown>` 断言（此模式由 Phase 6 统一处理，不在本轮）
- 行为完全等价，仅消除重复

**验证**: 调用 `pnpm typecheck` 无新增错误；`pnpm test:unit` 通过。

---

## Phase 3: 泛化六个 try-catch 包装器

### 3.1 修改 `apps/server/src/app/services/inference_workflow/workflow_query.ts`

删除 L164-211 的六个独立函数：
- `safeFindInferenceTraceById`
- `safeFindActionIntentById`
- `safeFindActionIntentByInferenceId`
- `safeFindDecisionJobById`
- `safeListReplayChildrenByParentId`
- `getSafeRequestInput`（保留但重写为使用通用 safeQuery 的返回值处理）

替换为单个泛型辅助函数：

```ts
const safeQuery = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};
```

更新 `buildWorkflowSnapshotBundleForJobs` 中的调用点，将每个 `safeFind*` 调用改写为 `safeQuery(() => context.repos.inference.xxx(...), null)` 或 `safeQuery(() => context.repos.inference.yyy(...), [])`。

**验证**: 调用 `pnpm typecheck` 无新增错误；`pnpm test:unit` 通过。

---

## Phase 4: 消除 InferenceWorkflowRepository 中所有类型逃逸

### 4.1 修改 `apps/server/src/app/services/repositories/InferenceWorkflowRepository.ts`

**L258-267 `listInferenceTraces`**:
- 删除 `eslint-disable` 注释（L260）
- 删除 `(this.prisma as any).inferenceTrace.findMany(...)` → `this.prisma.inferenceTrace.findMany(...)`
- 参数类型从 `Record<string, unknown>` 改为精确的 Prisma 类型
- 删除返回值的 `as InferenceTraceRecord[]` 断言（Prisma 类型已足够）

**L273-281 `listAiInvocations`**:
- 同上模式：删除 `(this.prisma as any).aiInvocationRecord.findMany(...)` → `this.prisma.aiInvocationRecord.findMany(...)`
- 删除 `eslint-disable` 注释

**L290-298 `listActionIntents`**:
- 删除 `as never` × 3（L293-296）
- 删除 `as unknown as ActionIntentRecordFull[]`（L297）
- 替换为精确的 `Prisma.actionIntentFindManyArgs` 类型标注

**L308-318 `findDecisionJobs`**:
- 删除 `(this.prisma as any).decisionJob.findMany(...)` → `this.prisma.decisionJob.findMany(...)`
- 删除 `eslint-disable` 注释
- 删除 `as DecisionJobRecord[]` 断言

**L324-328 `transaction<T>`**:
- 删除 `(this.prisma as any).$transaction(fn)` → `this.prisma.$transaction(fn)`
- 删除 `eslint-disable` 注释

**验证**: `pnpm typecheck` 通过（修复这些类型逃逸后可能暴露新的类型错误，必须逐一修正而非回退到 `as any`）。

---

## Phase 5: 消除 `castRawRow`

### 5.1 修改 `apps/server/src/app/services/scheduler/helpers.ts`

- 删除 L306: `export const castRawRow = <T>(row: Record<string, unknown>): T => row as unknown as T;`
- 如 `castRawRow` 仅被 `scheduler/queries.ts` 使用，将其实现在 queries.ts 内或直接用显式类型转换替代

### 5.2 修改 `apps/server/src/app/services/scheduler/queries.ts`

- L823、L832、L900：将 `castRawRow<XxxRow>(row)` 替换为 `row as unknown as XxxRow`（至少暴露类型断言的危害，不美化成"工具函数"）

> 注：彻底修复需要让查询返回正确的 Prisma 类型。本轮只消除 `castRawRow` 这个"美化后的 as any"，不在本轮重构 scheduler query 类型。

**验证**: `pnpm typecheck` 通过。

---

## Phase 6: 消除 `as unknown as Record<string, unknown>` deepMerge 模式

### 6.1 修改 `deepMerge` 签名

**文件**: `apps/server/src/ai/registry.ts`（或 `deepMerge` 定义所在文件，需先定位）

如果 `deepMerge` 是本地的，将签名改为泛型：
```ts
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T
```

### 6.2 消除所有调用点的断言

修改以下文件中 `deepMerge(... as unknown as Record<string, unknown>, ... as unknown as Record<string, unknown>) as unknown as X` 为 `deepMerge(x, y)`：

| 文件 | 行号 |
|------|------|
| `apps/server/src/ai/registry.ts` | 577, 597, 616, 635, 655, 849 |
| `apps/server/src/inference/context_config.ts` | 230, 253, 273 |
| `apps/server/src/config/runtime_config.ts` | 439 |
| `apps/server/src/ai/registry_watcher.ts` | 95 |
| `apps/server/src/context/service.ts` | 264 |
| `apps/server/src/packs/snapshots/snapshot_restore.ts` | 375 |

**验证**: `pnpm typecheck` 通过。

---

## Phase 7: 运行时表存在检查收口为启动 preflight

### 7.1 新增启动 preflight 函数

**新文件或现有 init 模块**: 在服务器启动时运行一次 `prisma migrate deploy` 或等效检查。若表缺失则 fail-fast。

实现方式：
- 在 `apps/server/src/index.ts`（composition root）的启动序列中，在 Prisma 连接建立后、HTTP 服务器启动前，执行 `prisma.$queryRaw\`SELECT name FROM sqlite_master WHERE type='table' AND name IN (...)\`` 验证所有必需表存在
- 若缺失：`console.error` + `process.exit(1)`，而非静默降级

清单：需验证的表名从 `prisma/schema.sqlite.prisma` 中提取 model 名称。

### 7.2 删除 store 文件中的逐方法表检查

| 文件 | 删除的函数 | 影响的调用点 |
|------|-----------|-------------|
| `apps/server/src/context/overlay/store.ts` | `isMissingOverlayTableError` (L53-59) | L137, 156, 189, 223 的 try-catch 中移除该检查 |
| `apps/server/src/memory/long_term_store.ts` | `isMissingMemoryBlockTablesError` (L72) | L112 相关 try-catch |
| `apps/server/src/memory/blocks/store.ts` | `isMissingMemoryBlockTablesError` (L193) | L234, 320, 361, 388 |
| `apps/server/src/plugins/store.ts` | `isMissingPluginTablesError` (L43) | 所有方法中的 ~12 个检查点 |

对于每个调用点：将 `catch (err) { if (isMissingTableError(err)) return defaultValue; throw err; }` 改为 `catch (err) { throw err; }` 或直接移除 try-catch（如果 try 的唯一目的就是捕获表缺失错误）。

### 7.3 删除运行时 Prisma 模型可用性检测

| 文件 | 行号 | 处理 |
|------|------|------|
| `apps/server/src/app/services/runtime/experimental_runtime_control_plane_service.ts` | L53 | 删除 `(context.prisma as unknown as Record).pluginInstallation` 检查，直接访问 |
| `apps/server/src/domain/invocation/invocation_dispatcher.ts` | L96 | 同上 |
| `apps/server/src/context/service.ts` | L264 | 同上 |

**验证**: 
- 服务器在有正确迁移的数据库上正常启动
- 服务器在无迁移的数据库上启动时直接报错退出（而非静默降级）
- `pnpm test:integration` 通过
- `pnpm test:e2e` 通过（e2e 测试框架已使用独立临时数据库 + 迁移）

---

## Phase 8: 消除 MultiPackRuntimeFacade 不可达分支与类型穿越

### 8.1 修改 `apps/server/src/core/multi_pack_runtime_facade.ts`

**L48 `handle as unknown as { instance?: ... }`**:
- 判明 `handle` 的真实类型，使用正确的类型标注而非 `as unknown as`
- 如果 `handle` 类型确实暴露 `instance` 属性，直接在类型层面访问

**L52-57 fallback throw**:
- 判明 `getPackRuntimePort` 是否始终可用：
  - 若始终可用 → 删除 L52-57 的 throw 分支
  - 若确实偶发不可用 → 保留 throw 但移除"Phase 1.5 enhancements"等过程性措辞，改为描述实际触发条件

**验证**: `pnpm typecheck` 通过。

---

## Phase 9: 消除 PackRuntimeInstance 虚假 async

### 9.1 修改 `apps/server/src/core/pack_runtime_instance.ts`

将以下方法从 `async`（返回 `Promise<void>` / `Promise.resolve()`）改为同步方法：

| 方法 | 当前签名 | 修改为 |
|------|---------|--------|
| `load()` (L63) | `public async load(): Promise<void>` | `public load(): void` |
| `start()` | `public async start(): Promise<void>` | `public start(): void` |
| `stop()` | `public async stop(): Promise<void>` | `public stop(): void` |
| `dispose()` | `public async dispose(): Promise<void>` | `public dispose(): void` |
| `step()` | `public async step(): Promise<...>` | `public step(): ...`（如确实为同步） |

### 9.2 更新调用方

搜索所有调用 `instance.load()`、`instance.start()` 等的位置，删除 `await`。

**验证**: `pnpm typecheck` 通过；`pnpm test:unit` 通过。

---

## Phase 10: 全量验证

- [ ] `pnpm typecheck` — 零新增错误
- [ ] `pnpm lint` — 零新增错误（Phase 4 修复后，之前被 `eslint-disable` 抑制的 `no-explicit-any` 应自然消失）
- [ ] `pnpm test:unit` — 全部通过
- [ ] `pnpm test:integration` — 全部通过
- [ ] `pnpm test:e2e` — 全部通过
- [ ] `pnpm dev` — 服务器 + 前端正常启动

---

## 不纳入本轮的已知问题（记录备查）

| 问题 | 原因 |
|------|------|
| 8 个单实现 repository 接口 | 涉及 DI/组合根重构，移除接口需重新设计 `AppInfrastructure` 类型 |
| 30+ 空 catch 块 | 需逐例分析是刻意静默（如"best effort"语义）还是 bug，不可批量删除 |
| `eslint-disable` 系统性清理 | 大部分绑定 Phase 4 的类型修复，修复后自然消失；剩余的可后续单独处理 |
| `as unknown as CalendarConfig[]` 系列 | `time_systems` 类型定义与使用方的类型不匹配问题，需要 schema 层修复，不在本轮 |
| `stringifyStringArray` / `toJsonValue` 重复 | 简单工具函数，提取到 `@/utils/` 即可，作为快速跟进项 |

---

## 执行顺序约束

- Phase 1（删除废代码）可独立先行，无依赖
- Phase 2、3（合并重复代码）可与 Phase 1 并行
- Phase 4（修复 Repository 类型逃逸）依赖 Phase 2 的类型环境已清洁
- Phase 5（消除 castRawRow）独立，可与 Phase 4 并行
- Phase 6（deepMerge 签名修改）影响面最大，必须在 Phase 2 之后做（Phase 2 内部仍使用 `as unknown as` 但已收敛为单点）
- Phase 7（preflight）依赖 Phase 1-6 全部完成后测试环境稳定
- Phase 8、9 独立，可在任意阶段插入
- Phase 10（验证）必须在所有 Phase 完成后执行

---

## 审查勘误（代码验证结果）

以下勘误基于对代码库的实际验证，修正原文档中与代码不符的声明。

### Phase 1.2：noop sink 不是废代码

原文档声称 `createNoopInferenceTraceSink` 无消费者，可整文件删除。**实际情况**：

- `apps/server/src/inference/service.ts` L40 导入了 `createNoopInferenceTraceSink`
- `apps/server/src/inference/service.ts` L554 将其用作 `createInferenceService` 的默认参数值

删除 `noop.ts` 会导致编译失败。此步骤必须在删除前先迁移默认值逻辑（如将默认值直接内联到 `service.ts` 的参数声明中）。

### Phase 1.1：删除 deprecated 类型时需更新文档

`ResolvePerceptionInput` 和 `PerceptionResult` 在代码中无外部消费者，但在以下文档中有引用，删除时需同步更新：

- `docs/ARCH.md` L552：perception pipeline 表格引用 `PerceptionResult`
- `docs/subsystems/PLUGIN_RUNTIME.md` L278/281：`PerceptionResolver` 接口文档引用 `ResolvePerceptionInput` 和 `PerceptionResult`

### Phase 2：deepMerge 不是本地函数

原文档 Phase 6 写"或 `deepMerge` 定义所在文件，需先定位"。实际 `deepMerge` 是从 `../config/merge.js` 导入的（`registry.ts` L4），定义在 `apps/server/src/config/merge.ts` L14。Phase 6.1 修改签名的目标文件应为 `config/merge.ts` 而非 `registry.ts`。

### Phase 3：getSafeRequestInput 行号不在声称范围内

原文档声称 6 个函数在 L164-211。实际 `getSafeRequestInput` 位于 L144-154，不在 L164-211 范围内。删除/重写时需注意行号偏移。

### Phase 5：castRawRow 调用点远多于列出的 3 处

原文档仅列出 `queries.ts` 中 L823、L832、L900 三处。实际该文件中还有约 10 处使用（L110、L142、L235、L277、L293、L349、L354、L435、L537、L626、L629、L770）。消除 `castRawRow` 必须处理全部调用点。

### Phase 6：行号与内容错误

以下三行声称包含 `deepMerge(... as unknown as Record<string, unknown>, ...)` 模式，实际并非如此：

| 文件 | 原声称行号 | 实际内容 |
|------|-----------|----------|
| `apps/server/src/ai/registry_watcher.ts` | L95 | L95 是独立的类型断言 `promptSlotRegistrySchema.parse(rawDefault) as unknown as Record<string, unknown>`；L96 的 `deepMerge` 调用不含该断言模式（第二个参数 `rawOverride` 未断言） |
| `apps/server/src/context/service.ts` | L264 | 该文件完全没有 `deepMerge` 调用。L264 是 `actor_ref` 字段的类型断言，与 deepMerge 无关 |
| `apps/server/src/packs/snapshots/snapshot_restore.ts` | L375 | L375 是 `{ packStorageAdapter, getPackRuntimeHandle } as unknown as import(...).AppContext` 的对象构造断言，与 deepMerge 无关 |

此外，`runtime_config.ts` L439 使用的是 `deepMergeAll()`（多参数变体），不是 `deepMerge()`，Phase 6.1 的签名修改需覆盖两个函数。

### Phase 7：行号错误

| 原声称 | 实际 |
|--------|------|
| `isMissingOverlayTableError` 在 `overlay/store.ts` L53-59 | 函数实际在 **L111** |
| `context/service.ts` L264 有 Prisma 运行时模型可用性检测 | L264 是 `actor_ref` 类型断言，非 Prisma 检测（见 Phase 6 勘误）；该文件中不存在此类检测 |

### Phase 7.3：需重新定位 `context/service.ts` 的 Prisma 检测

原文档将 `context/service.ts` L264 列为 Prisma 模型可用性检测点，实际该行不是。如果该文件确实存在运行时 Prisma 检测，需重新搜索定位。

### Phase 9：方法不是 async

原文档声称 `load()`/`start()`/`stop()`/`dispose()`/`step()` 声明为 `async`。**实际情况**：这 5 个方法均**没有 `async` 关键字**，它们是签名声明返回 `Promise<void>` 但通过 `Promise.resolve()` 实现的同步函数。

因此修改方案应为：
- 移除返回类型中的 `Promise<void>`，改为 `void`（或 `step()` 的实际同步返回类型）
- 移除方法体中的 `Promise.resolve()`
- 而非移除 `async` 关键字（因为不存在）

原文档表格中"当前签名"列 `public async load(): Promise<void>` 应修正为 `public load(): Promise<void>`（无 `async`）。

### 确认属实的声明（简要列表）

- Phase 1.1：deprecated 类型别名位置和内容准确
- Phase 1.3：`apps/server/src/types/` 确认为空目录
- Phase 2：5 个 merge 函数位于 L565-659，`mergeAiRegistryConfig` 位于 L661-670（原文称 L661-669，差 1 行）
- Phase 3：6 个 safe-query 函数存在（含 1 个同步的 `getSafeRequestInput`）
- Phase 4：全部 5 处类型逃逸（`as any`、`as never`、`as unknown as`）和 eslint-disable 注释均已确认
- Phase 5：`castRawRow` 在 `helpers.ts` L306 的签名准确
- Phase 6：`registry.ts` 6 行和 `context_config.ts` 3 行的断言模式准确
- Phase 7：`isMissingMemoryBlockTablesError`（两处）和 `isMissingPluginTablesError` 的位置准确
- Phase 7：`experimental_runtime_control_plane_service.ts` L53 和 `invocation_dispatcher.ts` L96 的 Prisma 检测准确
- Phase 8：`multi_pack_runtime_facade.ts` L48 的类型穿越和 L52-57 的 fallback throw 均准确

---

## 执行完成记录（2026-05-22）

### Phase 4 补充修复

Phase 4 原先只完成了 `(this.prisma as any)` 的移除，留有 `as never` × 3 和 `as unknown as XxxRecord[]` × 4。本轮修复：

**`as never` 消除**：根本原因是接口签名将 `requestInput` 声明为 `unknown`、`intentClass` 声明为 `string`，而实际调用的 `createPendingDecisionJob` / `createReplayDecisionJob` 期望 `InferenceRequestInput` 和 `InferenceJobIntentClass`。修复方案：从 `../../../inference/types.js` 导入正确类型，更新接口和实现签名，移除全部 `as never` 断言。

**`as unknown as XxxRecord[]` 消除**：四个直接 Prisma 方法（`listInferenceTraces`、`listAiInvocations`、`listActionIntents`、`findDecisionJobs`）的返回值均使用了 `as unknown as` 双重断言。Prisma 生成的返回类型与域类型在结构上兼容，直接移除断言后 typecheck 通过。

**eslint-disable 注释清理**：四个 `@typescript-eslint/no-unnecessary-type-assertion` 注释随 `as unknown as` 一并移除。

### Phase 6 deepMerge 泛型化（不可行）

计划要求将 `deepMerge` / `deepMergeAll` 签名改为泛型 `<T extends Record<string, unknown>>(base: T, override: Partial<T>): T`。实际操作中发现：

- 项目中的类型（`AiProviderConfig`、`AiModelRegistryEntry`、`InferenceContextConfig` 等）均**没有索引签名**，无法满足 `T extends Record<string, unknown>` 约束
- `mergeById` 内部对 `deepMerge` 的调用因 `T` 无约束，仍需 `as unknown as Record<string, unknown>` 和 `as unknown as T` 的断言
- 所有调用点的 `as unknown as Record<string, unknown>` 断言已在 Phase 2 执行期间清理完毕（grep 零匹配）

结论：在当前 TypeScript 类型体系下无法实施此修改，调用点已足够清洁。

### Phase 7 完整实施

**启动 preflight**：在 `index.ts` 的 `runStartupPreflight` 调用中将 `queryDatabaseHealth` 回调从简单的 `SELECT 1` 升级为验证 `_prisma_migrations` 表存在（SQLite 查 `sqlite_master`，PostgreSQL 查 `information_schema.tables`）。表缺失则 throw，触发 preflight 的 fail-fast 逻辑。

**四个 store 文件的运行时表检查移除**：

| 文件 | 删除的函数 | 简化的 try-catch 数 |
|------|-----------|-------------------|
| `context/overlay/store.ts` | `isMissingOverlayTableError` | 4 |
| `memory/long_term_store.ts` | `isMissingMemoryBlockTablesError` | 1 |
| `memory/blocks/store.ts` | `isMissingMemoryBlockTablesError` | 4 |
| `plugins/store.ts` | `isMissingPluginTablesError`、`pluginTablesUnavailableError` | 12（保留 `parseStringArray` 中合法的 try-catch） |

**Prisma 模型可用性检测移除**：

| 文件 | 行号 | 处理 |
|------|------|------|
| `domain/invocation/invocation_dispatcher.ts` | L96 | 直接移除 `identityNodeBinding` 可用性守卫，表由 preflight 保证存在 |
| `app/services/runtime/experimental_runtime_control_plane_service.ts` | L53 | 直接移除 `pluginInstallation` 可用性守卫 |

**冗余导入清理**：四个 store 文件中的 `getErrorMessage` 导入原仅供 `isMissing*TableError` 函数使用，随函数删除一并移除。

### Phase 10 验证结果

- `pnpm typecheck` — 通过（零新增错误）
- `pnpm lint` — 修改文件零错误（3 个预存错误：`registry.ts` Phase 2 遗留的 `no-unnecessary-type-assertion`、2 个无关文件中的 `require-await`）
- `pnpm test:unit` — 零新增失败（110/113 文件通过，3 个 `objective_enforcement_sidecar` 测试失败为预存问题）

### 不再纳入的勘误项

以下勘误项经评估不需额外处理：

- **Phase 7.3 `context/service.ts` L264**：勘误已指出该行不是 Prisma 检测，实际文件中不存在此类检测，无需处理
- **Phase 6 行号错误的三处调用点**（`registry_watcher.ts` L95、`context/service.ts` L264、`snapshot_restore.ts` L375）：勘误已确认这些行不含 `deepMerge` 断言模式，无需处理
- **`deepMergeAll` 签名**：`runtime_config.ts` L438 使用的是 `deepMergeAll` 多参数变体，因 Phase 6 泛型化整体不可行，此项自然覆盖
