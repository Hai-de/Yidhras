# 通用能力 P0-P1 实施计划

> 基于: `.limcode/design/generic-capability-development-draft.md`
> 状态: 进行中

---

## P0 — 阻塞原型世界包验证

### 1. StepContributor 接入 sim loop

**文件:** `apps/server/src/app/runtime/world_engine_persistence.ts`

在 `executeWorldEnginePreparedStep` 中，`evaluateStateTransforms` 之后、`persistPreparedStep` 之前，调用 `getStepContributors()` 并合并 delta operations。

具体步骤:
1. 将 :377-380 的 `worldEntities`/`entityStates` 查询提取到 StepContributor 循环之前（共享数据，避免重复查询）
2. 构建 `WorldEngineSessionContext`（从已查询数据组装）
3. 遍历 `pluginRuntimeRegistry.getStepContributors(packId)`，调用每个 contributor 的 `contributePrepare()`
4. 将返回的 `delta_operations`、`emitted_events`、`observability` 合并到 `prepared.state_delta`
5. 每个 contributor 独立 try/catch，单个失败不阻塞其他

依赖: `pluginRuntimeRegistry` 已在 `runtime.ts` 导出，可直接 import。

### 2. activate() 错误处理修复

**文件:** `apps/server/src/plugins/runtime.ts`

修复 :455-457 空 catch 块:
1. 用 `runtimeLogger.error` 记录错误
2. 写入 `PluginInstallation.last_error`（需验证 repo 方法是否存在）

### 3. intent_grounders + pack_projections 删除

**文件:** `packages/contracts/src/plugins.ts`

从 `pluginServerContributionsSchema` 中移除这两个字段。

---

## P1 — 原型世界包需要的通用能力

### 4. Sim loop 步骤钩子 + 错误隔离

**文件:** `apps/server/src/app/runtime/PackSimulationLoop.ts`

1. 定义 `PackLoopHooks` 接口（beforeStep1-6 / afterStep1-6 / onLoopStateChange）
2. 在 `PackSimulationLoopOptions` 中增加 `hooks?` 字段
3. 重构 `runIteration()`: 每个步骤包裹独立 try/catch，步骤前后调用钩子
4. 钩子独立 try/catch，单个失败不阻塞

### 5. Manifest 完全结构化 + 判别联合

**文件:** `packages/contracts/src/plugins.ts`

1. 定义各贡献类型的独立 schema（context_sources, step_contributors, rule_contributors, query_contributors, prompt_workflow_steps, api_routes, data_cleaners）
2. 重写 `pluginServerContributionsSchema`
3. `kind` 字段枚举化（`z.enum([...])`），未知值直接拒绝

**文件:** `apps/server/src/plugins/runtime.ts`

4. 重写 `registerManifestContributions` — 基于结构化元数据而非 stub 生成

### 6. deactivate() 钩子

**文件:** `apps/server/src/plugins/runtime.ts`

1. 定义 `PluginActivateResult` 类型
2. `activatePluginEntrypoint` 捕获返回值并存储 deactivate 函数
3. `clearRuntimes()` 在清空前调用 deactivate

### 7. DataCleaner 消费者接入

**文件:** `apps/server/src/app/runtime/PackSimulationLoop.ts`

在 step 6 之后调用 `dataCleanerRegistry.getForPack()` 并执行。

### 8. 能力键注册表 + 枚举类型

**文件:** 新文件 `apps/server/src/plugins/capability_keys.ts`

1. 定义 `PLUGIN_CAPABILITY_KEY` 常量对象
2. 定义 `CAPABILITY_KEY_MIN_LEVEL` 映射表
3. 更新 `hasCapability()` 增加 sandbox 级别检查

---

## 执行顺序

```
P0: 3 (简单删除) → 2 (简单修复) → 1 (核心接入)
P1: 8 (注册表) → 5 (manifest) → 4 (钩子) → 6 (deactivate) → 7 (data cleaner)
```

P0 全部完成后运行 `pnpm test:unit` + `pnpm typecheck` 验证。
