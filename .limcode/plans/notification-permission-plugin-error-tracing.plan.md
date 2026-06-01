<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/notification-permission-plugin-error-tracing.md","contentHash":"sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 1: NotificationCode 枚举 + details Zod schema + pushOrReplace + 队列驱逐策略 `#NE-1`
- [x] Phase 2: 插件错误源位置追踪 — protocol + worker_entry + error_source.ts + attachErrorMetadata `#NE-2`
- [x] Phase 3: 插件错误路径推送通知 — 7 个改动点 + 崩溃链路去重 `#NE-3`
- [x] Phase 4: Prompt slot 权限拒绝通知 — NotificationAware + InferenceContext + executor `#NE-4`
- [x] Phase 5: 插件能力拒绝非 HTTP 路径通知 — PluginWorkerClient.handleHostCall `#NE-5`
- [x] Phase 6: last_error 结构化写入 `#NE-6`
- [x] Phase 7: 前端 — 通知面板 details 展开 + 插件状态弹出面板 `#NE-7`
- [x] Phase 8: 全量验证 — lint + typecheck + unit + integration + e2e smoke `#NE-8`
<!-- LIMCODE_TODO_LIST_END -->

# 通知系统与权限、插件错误追踪集成 — 执行计划

## 源设计文档

- **路径**: `.limcode/design/notification-permission-plugin-error-tracing.md`

## 当前基线

| 指标 | 当前值 |
|------|--------|
| `NotificationManager.push()` details 填充率 | 0%（所有调用点只传 content string） |
| 插件错误 → `context.notifications` 推送点 | 0 个 |
| 权限拒绝 → `context.notifications` 推送点 | 0 个（仅 Pack access 通过 HTTP 错误链碰巧进入） |
| 插件错误源位置信息 | 无（Worker 内 stack 不映射回源文件，`last_error` 纯字符串） |
| `NotificationManager` 队列容量 | 50，FIFO 截断，无优先级驱逐 |
| `InferenceContext` 含 `notifications` 字段 | 否 |
| 通知码体系 | 无（ad-hoc string 散落各处） |

## 目标状态

| 指标 | 目标 |
|------|------|
| 通知码体系 | `NotificationCode` 枚举，16 个 code，覆盖权限/插件/系统三类 |
| details 类型安全 | 每个 code 对应 Zod schema，`push()` 入口 runtime 校验 |
| 插件错误通知覆盖 | 7 个改动点全部接入 `context.notifications`，崩溃链路单一推送点 |
| 权限拒绝通知覆盖 | Prompt slot 过滤 + 插件能力拒绝（非 HTTP）全部接入 |
| 插件错误源位置 | `SerializedPluginError.source_location` + `extractSourceLocation()` 工具 |
| 队列策略 | 200 上限 + level 优先驱逐 + `pushOrReplace` 替换语义 |
| `InferenceContext` | 扩展 `NotificationAware` 薄接口，`pipeline.ts` 传入 `notifications` |
| 前端 | Notifications dock 按 code 展开结构化 details；插件通知弹出详情面板 |

---

## Phase 1 — NotificationCode 枚举 + details Zod schema + pushOrReplace + 队列驱逐策略

**风险**: 低 — 纯新增，不改变现有调用点行为  
**涉及文件**: 2 新建 + 3 修改  
**前置**: 无  
**后置**: Phase 3, 4, 5, 6

### 新建文件

| 文件 | 内容 |
|------|------|
| `apps/server/src/utils/notification_details.ts` | `NotificationCode` 枚举（16 个 code）；`NotificationCodeValue` 类型；`NotificationCodeDetailsMap`（code → Zod schema 映射）；`PluginErrorPhase` 枚举 + 类型；`PermissionSlotDeniedDetailsSchema` / `PermissionCapabilityDeniedDetailsSchema` / `PermissionPackAccessDeniedDetailsSchema` / `PluginErrorDetailsSchema` / `SystemDetailsSchema` |
| `apps/server/src/utils/notification_details.spec.ts` | 单元测试：Zod schema 校验通过/失败用例；`PluginErrorPhase` 枚举完整性；`NotificationCodeDetailsMap` 覆盖所有 `NotificationCodeValue` |

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/utils/notifications.ts` | `SystemMessage` 泛型化以支持按 code 推断 details 类型；新增 `pushOrReplace(level, content, code, details, replaceKey)` 方法；队列容量 `MAX_MESSAGES` 50→200；level 优先驱逐逻辑（满时从最低优先级的旧消息开始驱逐）；`push()` 入口按 `NotificationCodeDetailsMap` 校验 details，失败时 log warning 降级 |
| `apps/server/src/app/context/runtime_context.ts` | `NotificationStore` 接口新增 `pushOrReplace` 方法签名；`SystemMessage` 类型引用更新 |
| `apps/server/src/app/middleware/error_handler.ts` | 错误推送改用 `NotificationCode` 枚举值替代 ad-hoc string（`API_INTERNAL_ERROR` → 保留 `code` 参数对应 `ApiError.code`，通知 code 分离）；`details` 中附带 `module: 'error-handler'` |

### 验证门

- `pnpm typecheck` 通过
- `pnpm --filter yidhras-server exec vitest run tests/unit/utils/notification_details.spec.ts` 通过
- 现有 `notifications.spec.ts`（如有）通过

---

## Phase 2 — 插件错误源位置追踪

**风险**: 低 — 新增可选字段，向后兼容  
**涉及文件**: 1 新建 + 3 修改  
**前置**: 无（可与 Phase 1 并行）  
**后置**: Phase 3, 6

### 新建文件

| 文件 | 内容 |
|------|------|
| `apps/server/src/utils/error_source.ts` | `SourceLocation` 接口；`extractSourceLocation(error)` — 优先取挂载的 `source_location`，回退从 stack 解析；`parseSourceLocationFromStack(stack)` — 正则匹配 `at xxx (file:line:column)` 和 `file:line:column` 格式；`attachErrorMetadata(error, meta)` — 安全挂载 `source_location`、`cause` 到 Error 对象 |
| `apps/server/src/utils/error_source.spec.ts` | 单元测试：V8 stack 格式解析（`at Foo.bar (/path/to/file.ts:42:10)`）；不带函数名的格式（`at /path/to/file.ts:42:10`）；无行列号格式；Windows 路径；`extractSourceLocation` 优先取挂载属性；`attachErrorMetadata` 挂载有效性 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/plugins/worker/protocol.ts` | `SerializedPluginError` 新增 `source_location?: { file: string; line?: number; column?: number }` 和 `cause?: SerializedPluginError`；`serializePluginError()` 新增 `depth` 参数（默认 0），递归深度 ≥3 时截断 cause 为 `{ message, truncated: true }`；从 `error.stack` 第一帧提取 source_location |
| `apps/server/src/plugins/worker/worker_entry.ts` | 激活失败 / 调用失败 / 停用失败三处 `serializePluginError()` 调用传入 `depth: 0`（默认）；错误处理中利用已接收的 `artifactRoot` 做相对路径解析（如果 source_location.file 在 artifactRoot 下，输出相对路径） |
| `apps/server/src/plugins/worker/PluginWorkerClient.ts` | `resolvePending()` 反序列化 error 后用 `attachErrorMetadata()` 挂载 `source_location` 和 `cause` 到 Error 对象 |

### 验证门

- `pnpm typecheck` 通过
- `pnpm --filter yidhras-server exec vitest run tests/unit/utils/error_source.spec.ts` 通过
- 现有 worker 相关集成测试通过（`SerializedPluginError` 新字段为 optional，旧测试不破）

---

## Phase 3 — 插件错误路径推送通知

**风险**: 中 — 涉及插件系统核心路径，崩溃链路去重逻辑需精确  
**涉及文件**: 3 修改（核心）+ 通知码引用  
**前置**: Phase 1, Phase 2  
**后置**: Phase 5

### 改动点清单

| # | 文件 | 函数/位置 | 通知码 | replaceKey |
|---|------|----------|--------|-----------|
| 1 | `PluginWorkerManager.ts` | `activateInstallation` catch（228 行附近） | `PLUGIN_ACTIVATION_FAILED` | `plugin:${installationId}:PLUGIN_ACTIVATION_FAILED` |
| 2 | `PluginWorkerClient.ts` | `handleCrash`（300 行附近） | `PLUGIN_WORKER_CRASHED` | `plugin:${installationId}:PLUGIN_WORKER_CRASHED` |
| 3 | `PluginWorkerClient.ts` | `request` timeout catch（202 行附近） | `PLUGIN_WORKER_TIMEOUT` | `plugin:${installationId}:PLUGIN_WORKER_TIMEOUT` |
| 4 | `runtime.ts` | `refreshPackPluginRuntime` Host API 不兼容（209 行附近） | `PLUGIN_HOST_API_INCOMPATIBLE` | `plugin:${installationId}:PLUGIN_HOST_API_INCOMPATIBLE` |
| 5 | `runtime.ts` | `refreshPackPluginRuntime` catch（289 行附近） | `PLUGIN_ACTIVATION_FAILED` | `plugin:${installationId}:PLUGIN_ACTIVATION_FAILED` |
| 6 | `PluginWorkerManager.ts` | `assertDescriptorCapabilities` 失败（catch 在 `activateInstallation` 内） | `PLUGIN_CAPABILITY_MISMATCH` | `plugin:${installationId}:PLUGIN_CAPABILITY_MISMATCH` |
| 7 | `PluginWorkerManager.ts` | `assertManifestDescriptorAlignment` 失败（catch 在 `activateInstallation` 内） | `PLUGIN_MANIFEST_MISALIGNED` | `plugin:${installationId}:PLUGIN_MANIFEST_MISALIGNED` |

### 关键逻辑

**崩溃链路去重**（设计 §3.1）：
- `PluginWorkerClient.handleCrash` 是崩溃通知的**单一推送点**
- `PluginWorkerManager.onCrash` 回调只做 map 清理 + logger.error，**不推送通知**
- `invoke` 连续失败超阈值 → `handleCrash` → 推送 `PLUGIN_WORKER_CRASHED`（一条）
- `request` timeout 单独推送 `PLUGIN_WORKER_TIMEOUT`；后续如触发 crash，由 `handleCrash` 另推 `PLUGIN_WORKER_CRASHED`（合理，两条不同性质事件）

**断言失败上下文补全**（设计 §3.2 #6 #7）：
- `assertDescriptorCapabilities` 和 `assertManifestDescriptorAlignment` 抛 plain `Error`，不带 pack/plugin/installation 信息
- 在 `activateInstallation` catch 分支中区分错误来源（通过 `error.message` 特征匹配或分两个 try-catch 块），从闭包变量 `target.packId` / `target.installation.plugin_id` / `target.installation.installation_id` 组装完整 `PluginErrorDetails`

### 通知推送范本

```typescript
context.notifications.pushOrReplace(
  'error',
  `插件 ${pluginId} 激活失败: ${message}`,
  NotificationCode.PLUGIN_ACTIVATION_FAILED,
  {
    module: 'plugin-worker-manager',
    pack_id: packId,
    plugin_id: pluginId,
    installation_id: installationId,
    phase: PluginErrorPhase.ACTIVATION,
    source_location: extractSourceLocation(error),
    raw_message: message,
    timestamp: Date.now(),
  },
  `plugin:${installationId}:PLUGIN_ACTIVATION_FAILED`,
);
```

每个改动点统一使用 `pushOrReplace`（同一安装的同一类错误始终只有最新一条），`details` 经 Zod schema 校验（Phase 1 提供的 `PluginErrorDetailsSchema`）。

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/plugins/worker/PluginWorkerClient.ts` | `handleCrash` 推送 `PLUGIN_WORKER_CRASHED`；`request` timeout catch 推送 `PLUGIN_WORKER_TIMEOUT` |
| `apps/server/src/plugins/worker/PluginWorkerManager.ts` | `activateInstallation` catch 推送 `PLUGIN_ACTIVATION_FAILED` / `PLUGIN_CAPABILITY_MISMATCH` / `PLUGIN_MANIFEST_MISALIGNED`（区分错误来源）；`onCrash` 回调移除通知推送（只保留 map 删除 + logger） |
| `apps/server/src/plugins/runtime.ts` | Host API 不兼容推送 `PLUGIN_HOST_API_INCOMPATIBLE`；激活异常 catch 推送 `PLUGIN_ACTIVATION_FAILED` |

### 验证门

- `pnpm typecheck` 通过
- 现有插件集成测试通过

---

## Phase 4 — Prompt slot 权限拒绝通知

**风险**: 中 — 涉及 `InferenceContext` 接口扩展，影响 15+ 文件  
**涉及文件**: 3 修改  
**前置**: Phase 1  
**后置**: Phase 7

### 步骤

1. **`NotificationAware` 薄接口**：在 `apps/server/src/app/context/runtime_context.ts` 中新增：
   ```typescript
   export interface NotificationAware {
     readonly notifications: NotificationStore;
   }
   ```
   `RuntimeContext` 改为 `extends NotificationAware`（它已有 `notifications` 字段，无需额外改动 `RuntimeContext` 实现）。

2. **`InferenceContext` 扩展**：`apps/server/src/inference/types.ts` 中 `InferenceContext` 新增 `extends NotificationAware`。注意 `InferenceContext extends PromptResolvableContext` 当前不包含 `notifications`，加 `extends NotificationAware` 后接口新增 `notifications` 字段。

3. **`pipeline.ts` 构造注入**：`ContextAssemblyPipeline.execute()` 返回的 `InferenceContext` 对象中新增 `notifications: context.notifications`（第 131 行 return 语句）。`context` 参数类型 `Ctx` 已包含 `RuntimeContext`，`context.notifications` 直接可用。

4. **`permission_filter.ts` 推送通知**：`createPermissionFilterExecutor().execute()` 完成后：
   - 汇总 `state.tree` 中所有 fragment 的 `permission_denied` 和 `denial` 统计
   - `featureEnabled && deniedFragmentCount > 0` 时调用 `context.notifications.pushOrReplace('warning', ...)`
   - `replaceKey` 使用 `permission_filter:${context.inference_id}`，确保同一次推理的最新过滤统计替换旧条目
   - `featureEnabled && deniedFragmentCount === 0` 时：如果之前有同 key 的通知，清除（或推送 info 级别的"本次无拒绝"）

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/context/runtime_context.ts` | 新增 `NotificationAware` 接口导出；`RuntimeContext extends NotificationAware` |
| `apps/server/src/inference/types.ts` | `InferenceContext extends PromptResolvableContext, NotificationAware` |
| `apps/server/src/inference/context/pipeline.ts` | return 对象新增 `notifications: context.notifications` |
| `apps/server/src/context/workflow/executors/permission_filter.ts` | 过滤完成后汇总统计，调用 `context.notifications.pushOrReplace` |

### 依赖影响评估

`InferenceContext` 新增 `notifications` 字段后：
- 43+ 源文件 import `InferenceContext`（类型），接口扩展不影响值使用
- 21+ 测试文件构造 `as unknown as InferenceContext` mock — `notifications` 为可选消费，现有测试不访问该字段，不破
- 测试如需覆盖通知推送，在 mock 中加 `notifications: { pushOrReplace: vi.fn(), ... }` 即可

### 验证门

- `pnpm typecheck` 通过（全部 InferenceContext 消费者）
- 现有 workflow executor 集成测试通过

---

## Phase 5 — 插件能力拒绝非 HTTP 路径通知

**风险**: 低 — 单点改动，逻辑隔离  
**涉及文件**: 2 修改  
**前置**: Phase 1, Phase 3  
**后置**: Phase 7

### 步骤

1. **`host_call_handler.ts`**：能力拒绝 `ApiError` 的 details 补充 `pack_id` 和 `method` 字段（已有 `plugin_id`、`installation_id`、`capability`）。

2. **`PluginWorkerClient.handleHostCall` catch 分支**：识别 `ApiError.code === 'PLUGIN_CAPABILITY_DENIED'`，向 `context.notifications.pushOrReplace` 推送 `PERMISSION_CAPABILITY_DENIED` warning。序列化回 worker 的逻辑（`serializePluginError` → `postMessage`）不变。

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/plugins/worker/host_call_handler.ts` | `ApiError.details` 补充 `pack_id`、`method` |
| `apps/server/src/plugins/worker/PluginWorkerClient.ts` | `handleHostCall` catch 新增能力拒绝通知推送 |

### 验证门

- `pnpm typecheck` 通过

---

## Phase 6 — last_error 结构化写入

**风险**: 低 — 应用层 JSON 序列化/反序列化，schema 不变  
**涉及文件**: 1 新建 + 2 修改  
**前置**: Phase 2（依赖 `PluginErrorPhase` 枚举）  
**后置**: Phase 7

### 新建文件

| 文件 | 内容 |
|------|------|
| `apps/server/src/plugins/worker/last_error.ts` | `PluginInstallationLastError` 接口（message, code, timestamp, phase, source_location?, cause?）；`serializeLastError(error)` — 序列化为 JSON string；`deserializeLastError(raw)` — 尝试 JSON.parse，失败时降级为 `{ message: raw, code: 'UNKNOWN', timestamp: new Date(0).toISOString(), phase: 'activation' }` |

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/plugins/runtime.ts` | `persistInstallationError` 调用点改为 `serializeLastError()` 写入；`upsertInstallation` 的 `last_error: undefined`（清空）调用点不变 |
| `apps/server/src/plugins/worker/PluginWorkerManager.ts` | `persistInstallationError` 调用点改为结构化写入 |

### 竞态处理

`refreshPackPluginRuntime` 激活成功后写 `last_error: undefined`，`onCrash` 可能在之后触发写结构化 JSON。Prisma `update` 原子操作，后写覆盖先写，crash 写入语义正确保留最新错误。

### 验证门

- `pnpm typecheck` 通过
- 单元测试：`serializeLastError` / `deserializeLastError` 往返；降级解析；`undefined` 输入

---

## Phase 7 — 前端

**风险**: 中 — UI 改动，需视觉验证  
**涉及文件**: 2 修改  
**前置**: Phase 1–6 后端部分全部完成  
**后置**: Phase 8

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/web/stores/notifications.ts` | `NotificationItem` 类型扩展：`details` 从 `Record<string, unknown>?` 改为按 `code` 推断；新增 getter `pluginErrorItems`（过滤插件类通知码） |
| `apps/web/features/shell/components/AppShell.vue` | Notifications dock 每条消息卡片：展开后根据 `code` 渲染 details 结构化字段（模块、pack_id、plugin_id、source_location 文件路径可选中复制、raw_message）；新增 level 和 code 过滤下拉；插件相关通知卡片（code 以 `PLUGIN_` 开头）提供"查看详情"按钮，点击弹出详情面板（展示结构化 last_error、worker 存活状态）。详情面板通过现有 API 端点获取数据：插件状态从 `GET /api/packs/:packId/plugins` 获取，`last_error` 字段尝试 `JSON.parse` 降级。 |

### 验证门

- `pnpm --filter yidhras-web typecheck` 通过
- `pnpm --filter yidhras-web test` 通过
- 手动验证：启动 `pnpm dev`，触发插件错误后观察 Notifications dock 是否出现结构化通知卡片

---

## Phase 8 — 全量验证

**风险**: 低 — 回归验证  
**涉及文件**: 0（纯验证）  
**前置**: Phase 1–7 全部完成

### 步骤

1. `pnpm lint` — ESLint 全量通过
2. `pnpm typecheck` — server + web 双端 typecheck 通过
3. `pnpm test:unit` — 全部单元测试通过
4. `pnpm --filter yidhras-server test:integration` — 全部集成测试通过
5. `pnpm smoke:server` — e2e smoke test 通过
6. 手动冒烟：`pnpm dev` → 登录 → 确认 TopRuntimeBar 通知计数正常 → 打开 Notifications dock 确认消息可展开

---

## 并行度

```
Phase 1 ──┬── Phase 3 ──┬── Phase 5 ──┬── Phase 7 ── Phase 8
          │              │              │
Phase 2 ──┘              └── Phase 4 ──┘── Phase 6 ──┘
```

- Phase 1 和 Phase 2 可并行（无依赖关系）
- Phase 3 依赖 Phase 1 + 2
- Phase 4 依赖 Phase 1
- Phase 5 依赖 Phase 1 + 3
- Phase 6 依赖 Phase 2
- Phase 4, 5, 6 互相无依赖，可并行
- Phase 7 依赖 1–6 全部完成
- Phase 8 依赖全部
