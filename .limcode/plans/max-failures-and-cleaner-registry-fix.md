<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"plan","path":".limcode/archive/plans/worker-thread-plugin-isolation-plan.md","contentHash":"sha256:archived"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] PluginWorkerClient 增加连续失败计数器，invoke 失败递增、成功重置，达到 `max_consecutive_failures` 后触发 onCrash `#fix-max-consecutive-failures-client`
- [x] PluginWorkerManager 在 onCrash 回调中清理 registry 并记录 metric `#fix-max-consecutive-failures-manager`
- [x] DataCleanerRegistry 增加 `listByPack(packId)` 和 `clearPack(packId)`，对齐 slot registry 模式 `#fix-data-cleaner-registry-api`
- [x] PackSimulationLoop 改为按 pack 范围调用 data cleaner，消除跨 pack 污染 `#fix-data-cleaner-loop-scope`
- [x] 补齐相关单元测试并运行完整回归 `#fix-regression`
<!-- LIMCODE_TODO_LIST_END -->

# 两个遗留问题修复计划

> 来源：`.limcode/archive/plans/worker-thread-plugin-isolation-plan.md` §7.5
> 涉及：`max_consecutive_failures` 未强制、`dataCleanerRegistry` 未完全迁入 per-pack registry

---

## 0. 现状诊断

### 0.1 `max_consecutive_failures` — 配置定义了但从未被读取

- **配置** (`config/domains/plugins.ts`): `isolation.max_consecutive_failures` 默认 3，Zod 校验完整
- **PluginWorkerClient.invoke()** (`PluginWorkerClient.ts:105-140`): 成功/失败时记录 metric (`recordPluginWorkerInvocationCompleted`)，但**不计数连续失败**
- **PluginWorkerManager** (`PluginWorkerManager.ts`): 无任何失败计数器，`onCrash` 回调仅被动响应 Worker crash
- **PackSimulationLoop**: 有独立硬编码 `SCHEDULER_CRASH_THRESHOLD = 3`，但那是 sim loop tick 的崩溃阈值，与插件 Worker 无关
- **结论**: `getRuntimeConfig().plugins.isolation.max_consecutive_failures` 可正常读取，无任何消费代码

### 0.2 `dataCleanerRegistry` — 全局单例，无 per-pack 隔离

- **存储**: 单一平面 `Map<string, DataCleaner>`，仅按 `key` 索引
- **`list()`**: 返回**所有 pack 的所有 cleaner**，无 pack 过滤
- **`PackSimulationLoop`** (`PackSimulationLoop.ts:407`): 调用 `dataCleanerRegistry.list()` → 遍历全部 cleaner → 对当前 pack 执行。**pack A 的 cleaner 会在 pack B 的 tick 中运行！**
- **对比**: `slotConditionRegistry` 和 `slotContentTransformRegistry` 都是 `Map<packId, Map<key, evaluator>>`，有 `list(packId)` 和 `clearPack(packId)`
- **`runtime.ts`** 中 `unregisterRuntimeExtensionProxies` 用 `unregisterByOwner()` 逐个匹配清理，而 slot registries 直接用 `clearPack()` 一步清空

---

## 1. max_consecutive_failures 修复

### 1.1 PluginWorkerClient 连续失败计数

**文件**: `apps/server/src/plugins/worker/PluginWorkerClient.ts`

在 `invoke()` 方法中增加：

```ts
private consecutiveFailures = 0;
private readonly maxConsecutiveFailures: number;

constructor(input) {
  // ...
  const isolation = getRuntimeConfig().plugins.isolation;
  this.maxConsecutiveFailures = isolation.max_consecutive_failures;
}

public invoke(...): Promise<unknown> {
  return this.request('invoke', timeoutMs, message)
    .then(result => {
      this.consecutiveFailures = 0;  // 成功时重置
      recordPluginWorkerInvocationCompleted(...);
      return result;
    })
    .catch(error => {
      this.consecutiveFailures += 1;
      recordPluginWorkerInvocationCompleted(...);  // status: 'failed'
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.handleCrash(new PluginWorkerCrashError(
          `Plugin worker exceeded max consecutive failures (${this.maxConsecutiveFailures})`
        ));
      }
      throw error;
    });
}
```

要点：
- 只在 `invoke` 失败时递增，成功时归零
- `activate`/`deactivate` 不计入连续失败（这些是生命周期操作，有独立的超时处理）
- 达到阈值时调用现有 `handleCrash()`，由现有 crash 流程处理（`onCrash` 回调、pending 全部 reject、metrics 记录）

### 1.2 PluginWorkerManager onCrash 回调增强

**文件**: `apps/server/src/plugins/worker/PluginWorkerManager.ts`

当前 `activateInstallation()` 中的 `onCrash` 回调只记录日志和更新 metric：

```ts
onCrash: error => {
  logger.error('Plugin worker crashed after activation', { ... });
  this.updateActiveWorkerMetric(target.packId);
}
```

需要增加：
- 从 manager 内部移除该 installation 的 worker
- 清理该 installation 在 registry 中的 runtime（避免悬空引用）

但 registry 清理应该由 `runtime.ts` 的 `refreshPackPluginRuntime` 流程处理。crash 回调在这里做最小的事：移除 manager 内部的 worker 引用 + 记录日志/metric。实际 registry 替换留给下次 refresh。

---

## 2. dataCleanerRegistry per-pack 迁移

### 2.1 增加 `listByPack()` 和 `clearPack()`

**文件**: `apps/server/src/plugins/extensions/data_cleaner_registry.ts`

新增方法：

```ts
public listByPack(packId: string): DataCleaner[] {
  const result: DataCleaner[] = [];
  for (const [key, owner] of this.owners.entries()) {
    if (owner.packId === packId) {
      const cleaner = this.cleaners.get(key);
      if (cleaner) result.push(cleaner);
    }
  }
  return result;
}

public clearPack(packId: string): void {
  for (const [key, owner] of this.owners.entries()) {
    if (owner.packId === packId) {
      this.cleaners.delete(key);
      this.owners.delete(key);
    }
  }
}
```

保留现有 `list()` 以便向后兼容，但标记为 deprecated。

### 2.2 PackSimulationLoop 按 pack 消费

**文件**: `apps/server/src/app/runtime/PackSimulationLoop.ts`

将：
```ts
const cleaners = dataCleanerRegistry.list();
```
改为：
```ts
const cleaners = dataCleanerRegistry.listByPack(packId);
```

这样每个 pack 的 sim loop 只运行属于该 pack 的 data cleaner，消除跨 pack 污染。

### 2.3 runtime.ts 改用 clearPack

**文件**: `apps/server/src/plugins/runtime.ts`

将 `unregisterRuntimeExtensionProxies` 中的：
```ts
dataCleanerRegistry.unregisterByOwner({ packId, installationId });
```
改为：
```ts
dataCleanerRegistry.clearPack(normalizedPackId);
```

与 slot registries 的处理方式完全对齐。在 `refreshPackPluginRuntime` 中：

```ts
// 清理旧的
const previousRuntimes = pluginRuntimeRegistry.replaceRuntimes(normalizedPackId, runtimes);
dataCleanerRegistry.clearPack(normalizedPackId);
slotConditionRegistry.clearPack(normalizedPackId);
slotContentTransformRegistry.clearPack(normalizedPackId);

// 注册新的
for (const runtime of runtimes) {
  registerRuntimeExtensionProxies(runtime);
}
```

删除 `unregisterRuntimeExtensionProxies()` 函数（它只剩下 dataCleanerRegistry 的清理逻辑，且被 clearPack 替代）。

---

## 3. 测试

### 3.1 dataCleanerRegistry 测试

**文件**: `apps/server/tests/unit/data_cleaner_registry.spec.ts`

新增测试用例：
1. `listByPack(packId)` 只返回指定 pack 的 cleaner
2. `listByPack(packId)` 对无 cleaner 的 pack 返回空数组
3. `clearPack(packId)` 只删除指定 pack 的 cleaner，不影响其他 pack
4. `clearPack(packId)` 后 `listByPack` 返回空

### 3.2 PluginWorkerClient 连续失败测试

**文件**: `apps/server/tests/unit/plugin_worker_manager.spec.ts` 或新测试文件

新增测试用例：
1. `invoke` 失败递增计数器，成功时重置
2. 连续失败达到 `max_consecutive_failures` 时触发 `handleCrash`
3. `activate`/`deactivate` 失败不计入连续计数

### 3.3 回归验证

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts \
  tests/unit/data_cleaner_registry.spec.ts \
  tests/unit/plugin_worker_manager.spec.ts \
  tests/unit/plugin_worker_protocol_and_proxy.spec.ts \
  tests/unit/plugin_worker_host_call_and_route.spec.ts \
  tests/unit/plugin_worker_entry_resolver.spec.ts

pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts \
  tests/integration/plugin_worker_runtime_flow.spec.ts \
  tests/integration/plugin_worker_crash_isolation.spec.ts \
  tests/integration/plugin_runtime_refresh.spec.ts

pnpm --filter yidhras-server exec tsc --noEmit
```

---

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/plugins/worker/PluginWorkerClient.ts` | 修改 | 增加连续失败计数 + 阈值触发 crash |
| `apps/server/src/plugins/worker/PluginWorkerManager.ts` | 修改 | onCrash 回调增强，移除内部 worker 引用 |
| `apps/server/src/plugins/extensions/data_cleaner_registry.ts` | 修改 | 新增 `listByPack()` + `clearPack()` |
| `apps/server/src/app/runtime/PackSimulationLoop.ts` | 修改 | `list()` → `listByPack(packId)` |
| `apps/server/src/plugins/runtime.ts` | 修改 | 用 `clearPack()` 替代 `unregisterByOwner()`，删除 `unregisterRuntimeExtensionProxies` |
| `apps/server/tests/unit/data_cleaner_registry.spec.ts` | 修改 | 新增 per-pack 测试 |
| `apps/server/tests/unit/plugin_worker_manager.spec.ts` | 修改 | 新增连续失败测试 |

---

## 5. 实施顺序

1. `max_consecutive_failures` — PluginWorkerClient 计数 + PluginWorkerManager 回调增强
2. `dataCleanerRegistry` — 新增 `listByPack`/`clearPack`
3. `PackSimulationLoop` + `runtime.ts` 调用方修改
4. 测试补齐 + 回归

---

## 6. 实施结果摘要 (2026-05-25)

全部 5 个 TODO 已完成。

### 6.1 变更详情

**PluginWorkerClient.ts** — 连续失败追踪：
- 新增 `maxConsecutiveFailures` 属性（从 `getRuntimeConfig().plugins.isolation.max_consecutive_failures` 读取，默认 3）
- 新增 `consecutiveFailures` 计数器
- `invoke()` 成功时重置为 0，失败时 +1
- 达到阈值时调用 `handleCrash()`，触发完整 crash 流程（pending 全 reject、onCrash 回调、metric 记录）

**PluginWorkerManager.ts** — onCrash 增强：
- `onCrash` 回调增加 `this.workers.delete(workerKey(...))`，crash 后立即从内部 Map 移除引用

**DataCleanerRegistry** — per-pack API：
- 新增 `listByPack(packId)` — 只返回指定 pack 的 cleaner
- 新增 `clearPack(packId)` — 只删除指定 pack 的 cleaner，不影响其他 pack

**PackSimulationLoop.ts** — 跨 pack 污染修复：
- `dataCleanerRegistry.list()` → `dataCleanerRegistry.listByPack(input.packId)`

**runtime.ts** — 统一清理模式：
- 删除 `unregisterRuntimeExtensionProxies()` 函数
- `dataCleanerRegistry.unregisterByOwner(...)` 逐个匹配 → `dataCleanerRegistry.clearPack(normalizedPackId)` 一步清空
- 与 `slotConditionRegistry.clearPack()`、`slotContentTransformRegistry.clearPack()` 完全对齐

### 6.2 新增测试

**data_cleaner_registry.spec.ts** (+3 tests)：
- `listByPack` 按 pack 过滤
- `listByPack` 对无 cleaner 的 pack 返回空数组
- `clearPack` 只删除指定 pack，不影响其他 pack

**plugin_worker_crash_isolation.spec.ts** (+3 tests)：
- 成功 invoke 重置连续失败计数器
- 连续失败达到 maxConsecutiveFailures 后触发 crash
- activate/deactivate 失败不计入 invoke 连续失败计数

### 6.3 回归结果

```
Unit:        9 files passed, 45 tests passed
Integration: 6 files passed, 29 tests passed
Typecheck:   clean
```
