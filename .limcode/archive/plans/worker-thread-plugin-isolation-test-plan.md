<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"plan","path":".limcode/archive/plans/worker-thread-plugin-isolation-plan.md","contentHash":"sha256:updated"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 提取 FakePluginWorkerClient 为共享 test helper，消除 plugin_worker_manager.spec.ts 和后续测试中的重复 mock `#worker-test-phase-1-fake-client-helper`
- [x] 补齐 worker_entry_resolver 单元测试（验证输出 URL 格式，验证 require 可解析） `#worker-test-phase-2-resolver-unit`
- [x] 补齐 host_call_handler 未知 method 拒绝单元测试 `#worker-test-phase-3-host-call-unknown`
- [x] 集成测试：activation 成功全流程（通过 mock Worker 走 refreshPackPluginRuntime） `#worker-test-phase-4-activation-integration`
- [x] 集成测试：activation 超时隔离（Worker 同步死循环 → terminate → 主进程存活 → last_error 写入） `#worker-test-phase-5-activation-timeout`
- [x] 集成测试：Worker crash 隔离（process.exit(1) → 主进程存活 → registry 移除 → crash metric） `#worker-test-phase-6-crash-isolation`
- [x] 集成测试：refresh 原子性（旧 runtime 正常运行，新 activation 失败，旧 runtime 保留） `#worker-test-phase-7-refresh-atomic`
- [x] 回归验证：运行全部插件相关单测 + 集成测试 + typecheck `#worker-test-phase-8-regression`
<!-- LIMCODE_TODO_LIST_END -->

# Worker 线程插件隔离 — 测试补齐计划

> 来源：`.limcode/archive/plans/worker-thread-plugin-isolation-plan.md` Phase 8
> 现状：Phase 1-7 全部实现，Phase 8 未完成。现有 17 个 Worker 相关单元测试全部通过。

---

## 0. 当前测试覆盖评估

### 0.1 已覆盖（17 个通过的单测）

| 文件 | 覆盖范围 |
|------|---------|
| `plugin_worker_protocol_and_proxy.spec.ts` (6 tests) | IPC message parse/reject、error 序列化、descriptor schema 默认值与 capability key 校验、Worker-side host API handler/descriptor 去重、requestInference 转发、BigInt 序列化、proxy 输出校验 |
| `plugin_worker_manager.spec.ts` (4 tests) | activation 成功（descriptor 匹配 manifest + capability）、capability 拒绝、manifest 未声明 descriptor 拒绝、replacePackWorkers 清理旧 client |
| `plugin_worker_host_call_and_route.spec.ts` (5 tests) | host_call inference 拒绝、inference 转发、queryWorldState pack scope 拒绝、route host 调用/404/504 |
| 其他插件单测 | `plugin_service.spec.ts`、`template_engine_plugin.spec.ts`、`world_engine_plugin_contributor_chain.spec.ts`、`builtin_plugins_runtime.spec.ts`（但 bypass Worker） |
| 集成测试 | `plugin_runtime_refresh.spec.ts`、`plugin_dependency_flow.spec.ts`、`plugin_runtime_web.spec.ts`、`slot_condition_plugin.spec.ts`（均使用真实 DB + mock context，不走 Worker 路径） |

### 0.2 未覆盖

| 缺口 | 严重程度 | 阻塞原因分析 |
|------|---------|-------------|
| 真实 Worker 线程 spawn + activate + invoke | 中 | `worker_entry_resolver.ts` 返回 `.js` 路径，tsx/dev 下 `__dirname` 指向 `src/`，无编译产物 `worker_entry.js`，`new Worker()` 会失败。需修复 resolver 或仅在 dist 模式下测试 |
| Worker crash 隔离 (`process.exit(1)`) | 高 | 必须用真实 Worker 验证 |
| Activation 超时隔离 | 中 | 需真实 Worker 同步死循环，但可用 mock 模拟超时路径 |
| refresh 原子性（旧 runtime 保留） | 中 | 可通过 mock Worker 测试 |
| host_call_handler 未知 method | 低 | 简单补齐 |
| worker_entry_resolver 输出验证 | 低 | 简单补齐 |
| 跨层全流程（DB → enable → refresh → Worker → invoke） | 中 | 需真实或 mock Worker |

### 0.3 关键阻塞：worker_entry_resolver 在 tsx/dev 下不可用

```ts
// apps/server/src/plugins/worker/worker_entry_resolver.ts
export const resolvePluginWorkerEntryUrl = (): URL => {
  return pathToFileURL(path.join(__dirname, 'worker_entry.js'));
};
```

`new Worker(url)` 需要可执行的 JS 文件。tsx 模式下 `__dirname` 是 `src/plugins/worker/`，其中只有 `.ts` 文件。dist 模式下 `__dirname` 是 `dist/plugins/worker/`，有编译好的 `worker_entry.js`。

**决策**：不作为本次测试计划内的修复项。采用以下策略推进：

- **mock Worker 集成测试**：用 `FakePluginWorkerClient` 走 `refreshPackPluginRuntime` 全流程，覆盖 registry 替换、fallback、extension proxy 注册/清理
- **真实 Worker 测试**：仅新增 1 个 dist 模式下的 crash 隔离测试作为 smoke，标记为 `vitest.skip` 条件跳过（检测当前运行模式）
- **resolver 修复**：如果在测试过程中确认需要 tsx/dev 下运行 Worker，则新增 `worker_entry_resolver.ts` 的 tsx 路径检测逻辑，但作为独立的小改动

---

## 1. 实施阶段

### Phase 1 — 提取 FakePluginWorkerClient 为共享 helper

**文件**：`apps/server/tests/helpers/fake_plugin_worker_client.ts`

当前 `plugin_worker_manager.spec.ts` 内部定义了 `FakePluginWorkerClient`，后续集成测试需要复用。

提取内容：

```ts
// 可配置的 FakePluginWorkerClient
// - 静态属性控制 activate 返回值/抛错
// - deactivate/terminate 记录到共享数组
// - isAlive 可配置
```

同步更新 `plugin_worker_manager.spec.ts` 改为从 helper 导入。

验收：`plugin_worker_manager.spec.ts` 4 个测试仍然通过。

---

### Phase 2 — worker_entry_resolver 单元测试

**文件**：新增 `apps/server/tests/unit/plugin_worker_entry_resolver.spec.ts`

测试用例：

1. `resolvePluginWorkerEntryUrl()` 返回 URL 实例
2. 返回的 URL 以 `file://` 开头
3. 返回的 URL 路径以 `worker_entry.js` 结尾
4. 返回的 URL 路径包含 `plugins/worker` 段

验收：4 个测试通过。

---

### Phase 3 — host_call_handler 未知 method 拒绝

**文件**：追加到 `apps/server/tests/unit/plugin_worker_host_call_and_route.spec.ts` 或新增独立测试

测试用例：

1. 传入不在 `hostMethodNameSchema` 枚举中的 method（如 `'dangerousEscalation'`）→ schema parse 阶段就拒绝（已在 protocol 测试覆盖）
2. 新增：`emitLog` 返回 `null`

验收：1-2 个测试通过。注意 `handlePluginWorkerHostCall` 的 switch 没有 default 分支，未知 method 会静默返回 `undefined`。如果这是个问题则代码需加 default 抛错。

---

### Phase 4 — 集成测试：activation 成功全流程

**文件**：新增 `apps/server/tests/integration/plugin_worker_runtime_flow.spec.ts`

使用 `createIsolatedAppContextFixture` + `FakePluginWorkerClient`。

测试流程：

1. 创建 isolated DB + AppContext
2. 通过 `pluginStore` upsert artifact（含 manifest）+ installation
3. 调用 `confirmPackPluginImport` + `enablePackPlugin`
4. 调用 `refreshPackPluginRuntime(context, packId)`
5. 断言 `pluginRuntimeRegistry.listRuntimes(packId)` 包含对应的 runtime
6. 断言 runtime 的 contribution proxy 已注册
7. 断言 `dataCleanerRegistry` / `slotConditionRegistry` 正确注册
8. 调用 `refreshPackPluginRuntime` 触发 disable，断言 registry 清理

验证点：
- `pluginRuntimeRegistry` 正确更新
- extension registries (dataCleaner, slotCondition, slotContentTransform) 正确注册/清理
- `replacePackWorkers` 被调用

注意：`refreshPackPluginRuntime` 内部直接 `import` `pluginWorkerManager` 单例，所以 mock 必须在 import 之前生效。

验收：2 个测试（enable 全流程 + disable 清理）通过。

---

### Phase 5 — 集成测试：activation 超时隔离

**文件**：追加到 `plugin_worker_runtime_flow.spec.ts`

使用 `FakePluginWorkerClient` 模拟超时（`activate()` 永远不 resolve）：

由于 `FakePluginWorkerClient` 是同步 mock，真正模拟超时需要 `PluginWorkerClient` 内部的 `setTimeout` 触发。改为直接测试 `PluginWorkerManager.activateInstallation` 在 client.activate 抛 `PluginWorkerTimeoutError` 时的行为：

测试流程：

1. 配置 `FakePluginWorkerClient.nextActivateError = new PluginWorkerTimeoutError('timed out')`
2. 调用 `manager.activateInstallation(...)`
3. 断言 `terminateCalls` 包含对应 installation
4. 断言 activation session 写入 `result: 'failed'`
5. 断言 `last_error` 包含 `timed out`

验证点：超时后 Worker 被 terminate、activation session 记录失败、installation last_error 写入。

验收：1 个测试通过。

---

### Phase 6 — 集成测试：Worker crash 隔离

**文件**：新增 `apps/server/tests/integration/plugin_worker_crash_isolation.spec.ts`

由于真实 Worker 在 tsx/dev 下不可用，采用策略：

**方案 A（首选）**：在 dist 构建后运行，用真实 Worker + 自毁插件

```ts
// 一个在 activate() 中调用 process.exit(1) 的插件
// 验证主进程不退出、crash metric 记录、registry 清理
```

使用 `describe.skipIf(!canSpawnRealWorker())` 条件跳过。

**方案 B（兜底）**：mock 层面测试 crash 回调链路

```ts
// 直接构造 PluginWorkerClient 实例并触发其 error/exit handler
// 验证 onCrash 回调执行、metric 记录、rejectAll pending
```

测试流程（方案 B）：

1. Mock `Worker` constructor 使其 emit `error` / `exit` 事件
2. 创建 `PluginWorkerClient` 实例
3. 触发 Worker `error` 事件
4. 断言 `onCrash` 回调被调用
5. 断言 `isAlive()` 返回 `false`
6. 断言 pending requests 全部 rejected
7. 断言 `recordPluginWorkerCrash` metric 被记录

验证点：crash 不传播到主线程、pending 清理、metric 记录。

验收：1 个测试（方案 B）通过。方案 A 标记为条件测试。

---

### Phase 7 — 集成测试：refresh 原子性

**文件**：追加到 `plugin_worker_runtime_flow.spec.ts`

测试流程：

1. 先成功 activation 一个插件，确认 runtime 在 registry 中
2. 修改 `FakePluginWorkerClient.nextActivateError` 模拟后续 activation 失败
3. 触发 `refreshPackPluginRuntime`
4. 断言旧 runtime 仍然在 registry 中（因为 refresh 中 activation 失败时保留了 `previousRuntime`）
5. 断言旧 Worker 未被 deactivate/terminate

验证点：`runtime.ts` 中 `catch` 块的 `previousRuntime` 保留逻辑正确。

验收：1 个测试通过。

---

### Phase 8 — 回归验证

命令：

```bash
pnpm typecheck
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts \
  tests/unit/plugin_worker_protocol_and_proxy.spec.ts \
  tests/unit/plugin_worker_manager.spec.ts \
  tests/unit/plugin_worker_host_call_and_route.spec.ts \
  tests/unit/plugin_worker_entry_resolver.spec.ts \
  tests/unit/plugin_service.spec.ts \
  tests/unit/builtin_plugins_runtime.spec.ts \
  tests/unit/template_engine_plugin.spec.ts \
  tests/unit/world_engine_plugin_contributor_chain.spec.ts

pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts \
  tests/integration/plugin_worker_runtime_flow.spec.ts \
  tests/integration/plugin_worker_crash_isolation.spec.ts \
  tests/integration/plugin_runtime_refresh.spec.ts \
  tests/integration/plugin_dependency_flow.spec.ts \
  tests/integration/plugin_runtime_web.spec.ts \
  tests/integration/slot_condition_plugin.spec.ts
```

---

## 2. 新增/修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/tests/helpers/fake_plugin_worker_client.ts` | 新建 | 可配置的 FakePluginWorkerClient |
| `apps/server/tests/unit/plugin_worker_entry_resolver.spec.ts` | 新建 | resolver 输出格式验证 |
| `apps/server/tests/unit/plugin_worker_host_call_and_route.spec.ts` | 修改 | 追加 emitLog / unknown method 测试 |
| `apps/server/tests/unit/plugin_worker_manager.spec.ts` | 修改 | 改用共享 helper 的 FakePluginWorkerClient |
| `apps/server/tests/integration/plugin_worker_runtime_flow.spec.ts` | 新建 | enable→refresh→registry 全流程 + 超时 + 原子性 |
| `apps/server/tests/integration/plugin_worker_crash_isolation.spec.ts` | 新建 | Worker crash 隔离验证 |

---

## 3. 不在此次计划的项

- **host_call_handler 缺少 default 分支抛错** — 静态 `hostMethodNameSchema.enum` 已在协议层拦截，运行时不会到达 switch 漏下去的路径。如需防御性编程改动属代码质量改进，非测试补齐
- **真实 Worker dist 模式集成测试** — 需要先修复 `worker_entry_resolver.ts` 的 tsx/dev 路径问题，作为独立任务
- **invocation 超时累计 `max_consecutive_failures` 自动 terminate** — 代码中此逻辑未实现，测试无从覆盖，应先实现代码再补测试
- **E2E 测试** — 当前 E2E 已覆盖 plugin dependency flow、runtime web、startup gap，Worker 隔离的 E2E 需要完整 server 启动，作为后续任务

---

## 4. 实施顺序

1. Phase 1：提取 FakePluginWorkerClient helper
2. Phase 2 + 3：补齐 resolver 和 host_call 单测
3. Phase 4：全流程集成测试
4. Phase 5 + 7：超时 + 原子性集成测试
5. Phase 6：crash 隔离测试
6. Phase 8：回归验证

---

## 5. 实施结果摘要 (2026-05-25)

全部 8 个 Phase 已完成。

### 5.1 测试覆盖增长

| 指标 | 实施前 | 实施后 |
|------|--------|--------|
| Worker 相关单元测试 | 17 (3 files) | 23 (4 files) |
| Worker 相关集成测试 | 0 | 6 (2 files) |
| 插件相关单元测试总计 | — | 34 (8 files) |
| 插件相关集成测试总计 | — | 26 (6 files) |

### 5.2 新增/修改文件

| 文件 | 操作 | 测试数 |
|------|------|--------|
| `tests/helpers/fake_plugin_worker_client.ts` | 新建 | — (test helper) |
| `tests/unit/plugin_worker_entry_resolver.spec.ts` | 新建 | 4 tests |
| `tests/unit/plugin_worker_host_call_and_route.spec.ts` | 修改 | +2 tests (emitLog, unknown method) |
| `tests/unit/plugin_worker_manager.spec.ts` | 修改 | 改用共享 helper, 4 tests 无变化 |
| `tests/integration/plugin_worker_runtime_flow.spec.ts` | 新建 | 3 tests (full flow, atomicity, timeout) |
| `tests/integration/plugin_worker_crash_isolation.spec.ts` | 新建 | 3 tests (error crash, exit(1), exit(0)) |

### 5.3 测试覆盖的新场景

- `pluginWorkerManager.activateInstallation()` 全流程（DB → Worker activation → registry 填充 → disable 清理）
- refresh 原子性：activation 失败时保留旧 runtime 在 registry 中
- activation 超时：Worker 抛 `PluginWorkerTimeoutError` → terminate → `last_error` 写入
- Worker `error` 事件 crash：pending 全部 reject、`onCrash` 回调、`isAlive() === false`、crash 后新请求立即拒绝
- Worker `exit(1)` 非零退出：等效 crash 处理
- Worker `exit(0)` 零退出：标记不 alive 但不触发 crash handler
- `hostMethodNameSchema` 拒绝未注册 method
- `emitLog` host call 返回 `null`

### 5.4 未覆盖（在计划中明确排除）

- 真实 Worker 线程 spawn 测试（需先修复 `worker_entry_resolver.ts` 在 tsx/dev 下的路径问题）
- `max_consecutive_failures` 自动 terminate（代码未实现此逻辑）
- `handlePluginWorkerHostCall` 的 switch default 抛错（协议层已拦截，不会到达）

### 5.5 回归结果

```
Unit:      8 files passed, 34 tests passed
Integration: 6 files passed, 26 tests passed
Typecheck:  clean (no errors)
```
