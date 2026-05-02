# 兼容性历史债务清理 设计

> 状态: 全部完成（阶段 E 跳过，阶段 G 保留 stable/experimental 包区分）
> 前提: 项目未上线，无用户，无生产数据
> 目标: 移除所有为兼容性保留的代码路径、类型、文件和字段，降低维护成本

## 1. 债务清单总览

| # | 债务项 | 影响范围 | 风险 | 状态 |
|---|--------|----------|------|------|
| 1 | 空文件 `plugin_cli.ts` | 0 引用 | 零 | 已完成 |
| 2 | 单行重导出 `orchestrator.ts` | 0 引用 | 零 | 已完成 |
| 3 | `config/schema.ts` 兼容重导出 | 1 引用, 修复 1 处 | 低 | 已完成 |
| 4 | `toLegacyVariableValue` + 旧 `VariablePool` 类型 | 6 个文件 | 低 | 已完成 |
| 5 | alias_fallback 提示变量解析 | 8 个文件 | 中 | 已完成 |
| 6 | `context.sim` 兼容门面 36 处引用 | 18 个文件 + 10 测试 | 中 | 已完成 |
| 7 | `getPrisma()` 泄露抽象 49 处调用 | 17 个文件 | 中 | 跳过 — Prisma 生态的薄仓库设计模式，非兼容性债务 |
| 8 | `compatibility` 元数据字段（移除 world pack + prompt workflow，保留插件清单） | contracts + server + web + templates | 低 | 已完成 |
| 9 | 实验性特性标志 + 路由守卫（移除 3 个 `EXPERIMENTAL_*` 标志和 API 守卫，保留 stable/experimental 包区分） | config + routes + simulation + index + tests | 中 | 已完成 |
| 10 | `context_builder.ts` 实验模式空合约存根 | 1 处 | 低 | 已完成 |

## 2. 分阶段清理计划

### 阶段 A: 零风险删除（空文件 + 死代码）

#### A1. 删除空文件 `plugin_cli.ts`

- **文件**: `apps/server/src/cli/plugin_cli.ts`
- **操作**: 删除文件
- **验证**: `pnpm typecheck` 通过，`pnpm lint` 通过

#### A2. 内联单行重导出 `orchestrator.ts`

- **文件**: `apps/server/src/context/workflow/orchestrator.ts`
- **当前内容**: `export { runPromptWorkflowV2 } from './runtime.js';`
- **操作**:
  1. `grep -r "from.*orchestrator" apps/server/src/` 找到所有导入者
  2. 将导入者的导入源改为 `./runtime.js`（或等价路径）
  3. 删除 `orchestrator.ts`
- **验证**: `pnpm typecheck` + `pnpm lint` 通过

---

### 阶段 B: `config/schema.ts` 重导出消除

#### B1. 迁移导入并删除兼容重导出

- **文件**: `apps/server/src/config/schema.ts`
- **当前内容**: 从 `./domains/index.js` 纯重导出所有 config 类型和 schema
- **操作**:
  1. `grep -r "from.*config/schema" apps/server/src/` 找到所有导入者
  2. 将导入源改为 `config/domains/index.js`（需根据各导入者位置调整相对路径）
  3. 删除 `schema.ts`
- **验证**: `pnpm typecheck` + `pnpm lint` + `pnpm test` 通过

---

### 阶段 C: narrative 变量系统简化

#### C1. 移除 `toLegacyVariableValue` 和旧 `VariableValue`/`VariablePool` 类型

- **文件**: `apps/server/src/narrative/types.ts`
- **删除**:
  - 第 1-7 行: `VariableValue` 类型定义
  - 第 9 行: `VariablePool` 类型定义
  - 第 100-103 行: `NarrativeConfig` 接口（如果 `variables: VariablePool` 是其唯一用途；需先确认 `NarrativeConfig` 的所有引用）

- **文件**: `apps/server/src/narrative/variable_context.ts`
- **删除**:
  - 第 96 行: `result[key] = toLegacyVariableValue(value);` — 改为 `result[key] = value;`（此时 `result` 的类型需从 `VariablePool` 变为 `PromptVariableRecord`）
  - 第 104-115 行: 整个 `toLegacyVariableValue` 函数
  - 第 87-102 行: `flattenPromptVariableContextToVisibleVariables` 函数的返回类型从 `VariablePool` 改为 `PromptVariableRecord`

- **操作步骤**:
  1. `grep -r "VariableValue\|VariablePool\|toLegacyVariableValue\|flattenPromptVariableContextToVisibleVariables" apps/server/src/` 确认所有引用
  2. `grep -r "NarrativeConfig" apps/server/src/` 确认用途
  3. 将 `flattenPromptVariableContextToVisibleVariables` 返回类型改为 `PromptVariableRecord`
  4. 移除 `toLegacyVariableValue` 包装调用
  5. 移除旧类型定义
  6. 更新所有调用方
- **验证**: `pnpm typecheck` + `pnpm test` 通过

#### C2. 收紧变量解析：默认启用 `strict_namespace`

- **文件**: `apps/server/src/narrative/variable_context.ts`
- **变更**:
  - 第 29 行: `strict_namespace: false` → `strict_namespace: true`
  - 移除 `alias_fallback` 解析分支（第 272-291 行的 for 循环体）
  - 简化 `resolvePromptVariableResolutionMode`（第 349-357 行），移除 `'alias_fallback'` 返回值
- **文件**: `apps/server/src/narrative/types.ts`
- **变更**:
  - 第 34 行: `PromptVariableResolutionMode` 类型从 `'namespaced' | 'alias_fallback' | 'local'` 改为 `'namespaced' | 'local'`
  - 移除 `DEFAULT_PROMPT_VARIABLE_ALIAS_PRECEDENCE`（第 31 行）和 `PromptVariableAliasNamespace`（第 33 行）—— 仅在无其他消费方时
  - 移除 `PromptVariableLayer.alias_values` 字段（第 40 行）
  - 移除 `PromptVariableContext.alias_precedence` 字段（第 49 行）
  - 移除 `PromptVariableResolutionTrace.fallback_applied` 字段（第 68 行）
  - 移除 `PromptMacroDiagnostics.alias_fallback_count` 字段（第 90 行）
- **文件**: `apps/server/src/narrative/resolver.ts`
  - 移除第 127-128 行的 alias_fallback 计数逻辑
  - 移除第 357 行的 `fallback_applied: true`
- **注意**: 此变更要求所有 prompt 模板使用完全限定的命名空间变量路径（如 `{{actor.display_name}}` 而非裸名 `actor_name`）。需先审计现有 world pack 模板。
- **验证**: `pnpm typecheck` + `pnpm test` + 手动检查现有模板

#### C3. （可选）移除 `PromptVariableContextSummary` 中的别名字段

- 若 C2 移除了 `alias_precedence`，同步从 `createPromptVariableContextSummary`（`variable_context.ts:78-85`）移除 `alias_precedence` 字段
- 从 `PromptVariableContextSummary` 类型中移除 `alias_precedence: string[]`

---

### 阶段 D: `context.sim` 门面拆除

这是最大的一项，涉及 16 个文件 34 处引用。核心策略：为 `sim` 上使用的每个方法提供聚焦端口，逐方法迁移。

#### D1. 审计 `sim` 上的方法调用分布

当前通过 `context.sim` 调用的方法：

| 方法 | 调用次数 | 所属文件 |
|------|----------|----------|
| `getPackRuntimeHandle()` | 5 | `system.ts`, `pack_openings.ts`, `pack_snapshots.ts`, `world_engine_snapshot.ts`, `world_engine_ports.ts` |
| `isPaused()` | 5 | `system.ts`, `runtime_kernel_service.ts`, `simulation_loop.ts`, `world_engine_ports.ts` |
| `setPaused()` | 3 | `pack_snapshots.ts`, `runtime_kernel_service.ts`, `runtime_control.ts` |
| `isRuntimeReady()` | 5 | `system.ts`, `runtime_kernel_service.ts`, `experimental_multi_pack_runtime.ts`, `experimental_runtime_control_plane_service.ts`, `overview.ts`, `plugins/context.ts`, `world_engine_ports.ts` |
| `getActivePack()` | 1 | `create_app.ts` |
| `getPackRuntimeRegistry()` | 1 | `experimental_runtime_control_plane_service.ts` |
| `getGraphData()` | 1 | `relational.ts` |
| `isExperimentalMultiPackRuntimeEnabled()` | 2 | `experimental_runtime.ts`, `experimental_pack_projection.ts` |
| `applyClockProjection()` | 1 | `world_engine_persistence.ts` |

#### D2. 逐方法迁移

**D2a. `isPaused` / `setPaused` / `isRuntimeReady`** — 这些已在 `packScope` 或可直接从 `AppContext` 上的聚焦端口获取。检查 `AppContextPorts` 是否已暴露等价方法。

**D2b. `getPackRuntimeHandle`** — 此方法需要一个 pack ID 参数。应通过 `packScope` 解析器获取。

**D2c. `getActivePack`** — 可通过 `ActivePackProvider` 接口（`context.activePack`）直接获取，该接口已作为 `AppInfrastructure` 的一部分存在。

**D2d. `getGraphData`** — 应已有专用的图形服务/仓库；`sim` 只是中间人。

**D2e. `isExperimentalMultiPackRuntimeEnabled`** — 这是一个配置查询；应直接从 `RuntimeConfig` 导入，而非通过 `sim`。

**D2f. `applyClockProjection`** — 仅在 `world_engine_persistence.ts:338` 一处使用。需检查是否可改为直接调用时钟投影服务。

**D2g. `getPackRuntimeRegistry`** — 仅在 `experimental_runtime_control_plane_service.ts` 一处使用。

#### D3. 执行

对每个方法组：
1. 确认 `AppContext` 或其组合端口上是否已存在等效替代
2. 若不存在，添加聚焦端口
3. 逐个文件迁移调用点
4. 每迁移完一个方法的所有调用点后，从 `SimulationManager` 接口移除该方法（若无其他消费者）
5. 全部迁移完成后，从 `AppContext` 移除 `sim` 字段

- **验证**: 每个方法组迁移后 `pnpm typecheck` + `pnpm test`，全量完成后完整测试套件

---

### 阶段 E: `getPrisma()` 封装

#### E1. 审计与分类

49 个调用点分为两类：
- **内部调用**（仓库类内部）: 保持原样 — 仓库封装 Prisma 访问是其职责
- **外部调用**（服务/中间件/工具直接调 `repo.getPrisma()`）: 需为每个具体查询添加专用仓库方法

#### E2. 识别外部调用点

```
grep -r "getPrisma()" apps/server/src/ --include="*.ts" | grep -v "Repository.ts"
```

对每个外部调用点：
1. 分析其执行的查询
2. 在对应仓库上添加命名方法
3. 将调用点改为使用新方法
4. 若该仓库不再有外部 `getPrisma()` 调用，从接口移除 `getPrisma()`

- **验证**: `pnpm typecheck` + `pnpm test` 通过

---

### 阶段 F: `compatibility` 元数据字段

#### F1. 决定去留

该字段携带 `{ yidhras: string, schema_version?: string, notes?: string }`，用于 world pack 清单兼容性声明和 AI 调用记录的元数据跟踪。

- **保留理由**: world pack `metadata.compatibility` 在插件发现中有实际验证用途（`plugins/discovery.ts:80-82` 验证 pack_id 匹配）
- **移除理由**: 当前所有 pack 均为内置/受控，无第三方 pack 消费者

#### F2. 若决定移除

涉及文件：
- `packages/contracts/src/system.ts:74` — `compatibility` zod schema
- `packages/contracts/src/ai_shared_metadata.ts:37` — `compatibility?: Record<string, unknown> | null`
- `packages/contracts/src/plugins.ts:101` — 插件清单 `compatibility` schema
- `apps/server/src/app/services/system.ts:51,210` — 类型定义和序列化
- `apps/server/src/inference/sinks/prisma.ts:61` — 持久化
- `apps/server/src/packs/schema/constitution_schema.ts:202,229` — 验证 schema
- `apps/server/src/context/types.ts:222` — 上下文类型
- `apps/server/src/context/service.ts:157` — 初始化为 undefined
- `apps/server/src/init/world_pack_project_scaffold.ts:238,258-259` — scaffold 模板
- `apps/web/composables/api/useSystemApi.ts:17,33` — 前端类型
- `apps/server/src/plugins/discovery.ts:80-82,114` — 插件兼容性验证

- **验证**: `pnpm typecheck` + `pnpm lint` + `pnpm test` 通过

---

### 阶段 G: 实验性路由处理

#### G1. 审计路由使用情况

路由文件：
- `apps/server/src/app/routes/experimental_runtime.ts` — 11 个端点
- `apps/server/src/app/routes/experimental_pack_projection.ts` — 5 个端点
- `apps/server/src/app/routes/plugin_runtime_web.ts` — 2 个实验性端点

特性标志（`apps/server/src/config/runtime_config.ts:159-161`）:
- `EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED`
- `EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED`
- `EXPERIMENTAL_MULTI_PACK_RUNTIME_UI_ENABLED`

#### G2. 决定

两个选项：
- **选项 A**: 若多包运行时已是事实上的稳定实现 → 移除 `/experimental/` 前缀，移除特性标志，提升为稳定 API
- **选项 B**: 若多包运行时仍为实验性 → 保留标志，但清理死代码路径（如选项 A 中的 `worldEnginePackModeSchema = z.enum(['active', 'experimental'])` 两模式）

**建议选项 A**：无用户，无理由隐藏功能特性。

#### G3. 若选择选项 A

1. 将路由从 `/api/experimental/` 移至 `/api/` 对应路径
2. 移除 3 个特性标志和相关检查
3. 移除 `worldEnginePackModeSchema` 中的 `'experimental'` 枚举值，统一为 `'active'`
4. 移除 `packScope` 中的 `'stable' | 'experimental'` 区分
5. 重命名文件去掉 `experimental_` 前缀
6. 更新前端 API 调用路径
- **验证**: `pnpm typecheck` + `pnpm test` + 手动 API 测试

---

### 阶段 H: 实验模式空合约存根

- **文件**: `apps/server/src/inference/context_builder.ts:592-594`
- **当前代码**:
  ```typescript
  // NOTE: packRuntimeLookup.getPackRuntimeSummary uses slimmer return shape;
  // pack-scoped invocation_rules for experimental mode are not yet exposed
  // through a focused port. Returning empty contract for now.
  ```
- **操作**: 若阶段 G 移除了实验模式区分，此存根自然消失。否则需完成实现或显式抛出错误。
- **验证**: 上下文构建器调用路径的 `pnpm test`

---

## 3. 推荐执行顺序

```
A1 → A2 → B1 → C1 → C2 → D2a → D2b → D2c → D2d → D2e → D2f → D2g → D3 → E1 → E2 → F2 → G1 → G3 → H
```

每个阶段独立可验证（`pnpm typecheck && pnpm lint && pnpm test`），前一阶段通过后再进入下一阶段。

阶段 A、B 为零风险，可立即开始。阶段 C 需先审计现有模板。阶段 D 为最大工作量，分方法组逐步推进。阶段 G 需架构决策后再执行。

## 4. 不做的事项

以下模式是**运行时行为/业务逻辑**，不是兼容性债务，明确排除：

- AI 模型的 `fallback_models` / `allow_fallback` — 这是 AI 网关的正常熔断/路由机制
- `snr_fallback` / `delay_ticks_fallback` — 推理上下文配置的正常默认值
- 主题验证中的 `fallbackTheme` / `fallbackApplied` — 这是 CSS 变量验证的正常回退行为
- `assignment_source: 'fallback'` — 调度器所有权分配的合法枚举值
- `source: 'clock_fallback'` — 时钟源解析的正常回退
- `narrativized fallback` — LOGIC.md 中定义的合法叙事化失败模式
- `superseded` — 调度器再平衡中的业务领域状态
- Nuxt `compatibilityDate` — 框架配置，非项目兼容性债务

## 5. 后续待单独评估的事项

### 5.1 Rust sidecar 协议的 `pack_mode` 字段

`packages/contracts/src/world_engine.ts` 中 `worldEnginePackModeSchema = z.enum(['active', 'experimental'])` 定义了 world engine sidecar 的 pack 加载模式。

当前实际调用情况：
- 主包启动时以 `mode: 'active'` 调用 `worldEngine.loadPack()`（`index.ts:370`）
- 附加包通过 `packRuntimeRegistryService.load()` 加载时**完全不调用 world engine sidecar**，仅使用本地 `ChronosEngine` + `RuntimeSpeedPolicy`
- `'experimental'` 模式从未被实际传入 sidecar

待确认：
- Rust sidecar 中 `active` vs `experimental` 的实际行为差异
- 未来附加包是否需要接入 sidecar
- `loaded` / `running` 等初始状态字符串是否应统一

此项不阻塞当前清理，随后单独评估。
