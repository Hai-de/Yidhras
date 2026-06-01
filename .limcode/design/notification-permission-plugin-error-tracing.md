# 通知系统与权限、插件错误追踪集成方案

## 动机

当前通知、权限、插件三个子系统各自独立运转，存在四条明确差距：

| # | 差距 | 直接后果 |
|---|------|---------|
| 1 | 权限拒绝（prompt slot、能力检查）不产生通知 | 管理员不知道 AI 提示词被静默过滤了多少内容 |
| 2 | `NotificationManager.details` 几乎不被填充，logger 的丰富上下文不进通知 | 前端通知面板只有一句话消息，无法定位问题 |
| 3 | 插件所有错误路径都不推送 `context.notifications` | 前端完全看不到插件异常；`last_error` 字段纯字符串、无结构 |
| 4 | 插件错误信息缺少源位置（文件/行号），Worker 内 stack 不可映射回源文件 | 即使捕获到错误也不知道该修改哪个文件的哪一行 |

---

## 现状回顾

### 通知流（当前）

```
插件错误        → logger.error()         → 终端/日志文件（用户不常看）
                → installation.last_error → DB（前端无 UI）

API HTTP 错误   → error_handler 中间件    → logger + context.notifications.push()
                                           → GET /api/system/notifications
                                           → 前端轮询 → TopRuntimeBar + Notifications dock

Prompt 权限拒绝 → fragment.permission_denied = true
                → step trace denied_fragment_count（只在 workflow 诊断里）
                → 不推送通知

能力检查拒绝    → throw ApiError(403)      → 经 HTTP 链条进入通知（碰巧）
                → host_call_handler 中抛   → 序列化回 worker，主线程无感知
```

### 缺失的流向

```
权限拒绝 ──✕──→ context.notifications
插件错误 ──✕──→ context.notifications
能力拒绝 ──✕──→ context.notifications（非 HTTP 路径）
logger 结构化上下文 ──✕──→ 通知 details
插件源文件位置 ──✕──→ 错误信息
```

---

## 方案

### 1. 通知码体系与 details 类型系统

#### 1.1 统一通知码枚举

废弃 `ErrorCode` 中插件相关的不活跃 code（`PLUGIN_LOAD_FAIL` / `PLUGIN_EXECUTION_FAIL` / `PLUGIN_WORKER_FAIL` / `PLUGIN_TERMINATE_FAIL`——经核实均未被通知路径使用），新建统一的 `NotificationCode` 枚举覆盖全部系统消息场景。现有 `ErrorCode` 保留用于 HTTP API 响应，但不在通知系统中复用，避免两套枚举语义发散。

`apps/server/src/utils/notifications.ts`：

```typescript
export const NotificationCode = {
  // 权限类
  PERMISSION_SLOT_DENIED:           'PERMISSION_SLOT_DENIED',
  PERMISSION_CAPABILITY_DENIED:     'PERMISSION_CAPABILITY_DENIED',
  PERMISSION_PACK_ACCESS_DENIED:    'PERMISSION_PACK_ACCESS_DENIED',

  // 插件类
  PLUGIN_ACTIVATION_FAILED:        'PLUGIN_ACTIVATION_FAILED',
  PLUGIN_WORKER_CRASHED:           'PLUGIN_WORKER_CRASHED',
  PLUGIN_WORKER_TIMEOUT:           'PLUGIN_WORKER_TIMEOUT',
  PLUGIN_HOST_API_INCOMPATIBLE:    'PLUGIN_HOST_API_INCOMPATIBLE',
  PLUGIN_CAPABILITY_MISMATCH:      'PLUGIN_CAPABILITY_MISMATCH',
  PLUGIN_MANIFEST_MISALIGNED:      'PLUGIN_MANIFEST_MISALIGNED',

  // 系统类（从现有 ad-hoc 调用点规范化）
  SYS_PRECHECK_FAIL:               'SYS_PRECHECK_FAIL',
  SYS_INIT_FAIL:                   'SYS_INIT_FAIL',
  SYS_INIT_OK:                     'SYS_INIT_OK',
  WORLD_PACK_EMPTY:                'WORLD_PACK_EMPTY',
  DEV_RUNTIME_RESET:               'DEV_RUNTIME_RESET',
} as const;

export type NotificationCodeValue = (typeof NotificationCode)[keyof typeof NotificationCode];
```

注意：原设计中的 `PERMISSION_SLOT_READ_DENIED` 和 `PERMISSION_SLOT_VISIBILITY_DENIED` 合并为 `PERMISSION_SLOT_DENIED`——它们在同一次过滤中汇总推送（见 §2.1），拆成两个 code 没有独立路由价值，反而膨胀 code 表。

#### 1.2 details 类型系统与 Zod 校验

**原则：`code` 决定 `details` 的形状**。所有调用 `notifications.push()` 时，`code` 与 `details` 必须符合可辨识联合关系。在 `push()` 入口用 Zod schema 做运行时校验，保证调用方传错字段名（如 `pluginId` vs `plugin_id`）会立即报错。

```typescript
// apps/server/src/utils/notification_details.ts

import { z } from 'zod'

const NotificationDetailsBaseSchema = z.object({
  module: z.string(),
  timestamp: z.number(),
})

// --- 权限类 ---

export const PermissionSlotDeniedDetailsSchema = NotificationDetailsBaseSchema.extend({
  subject_id: z.string(),
  kind: z.literal('slot_denied'),
  denied_read_count: z.number().int().nonnegative(),
  denied_visibility_count: z.number().int().nonnegative(),
  affected_slot_ids: z.array(z.string()),
  actor_identity_id: z.string(),
  actor_agent_id: z.string(),
})

export const PermissionCapabilityDeniedDetailsSchema = NotificationDetailsBaseSchema.extend({
  subject_id: z.string(),
  kind: z.literal('capability_denied'),
  plugin_id: z.string(),
  installation_id: z.string(),
  capability_key: z.string(),
  method: z.string(),
})

export const PermissionPackAccessDeniedDetailsSchema = NotificationDetailsBaseSchema.extend({
  subject_id: z.string(),
  kind: z.literal('pack_access_denied'),
  pack_id: z.string(),
  reason: z.string(),
})

// --- 插件类 ---

const SourceLocationSchema = z.object({
  file: z.string(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
}).optional()

export const PluginErrorDetailsSchema = NotificationDetailsBaseSchema.extend({
  pack_id: z.string(),
  plugin_id: z.string(),
  installation_id: z.string(),
  phase: z.enum(['activation', 'invocation', 'deactivation', 'host_call', 'crash', 'host_api_check']),
  source_location: SourceLocationSchema,
  contribution_type: z.string().optional(),
  contribution_invoke: z.string().optional(),
  raw_message: z.string().optional(),
})

// --- 系统类（details 无额外结构化字段，base 足够） ---

export const SystemDetailsSchema = NotificationDetailsBaseSchema

// --- code → details 映射 ---

export const NotificationCodeDetailsMap: Record<NotificationCodeValue, z.ZodTypeAny> = {
  // 权限类
  PERMISSION_SLOT_DENIED:           PermissionSlotDeniedDetailsSchema,
  PERMISSION_CAPABILITY_DENIED:     PermissionCapabilityDeniedDetailsSchema,
  PERMISSION_PACK_ACCESS_DENIED:    PermissionPackAccessDeniedDetailsSchema,
  // 插件类
  PLUGIN_ACTIVATION_FAILED:        PluginErrorDetailsSchema,
  PLUGIN_WORKER_CRASHED:            PluginErrorDetailsSchema,
  PLUGIN_WORKER_TIMEOUT:            PluginErrorDetailsSchema,
  PLUGIN_HOST_API_INCOMPATIBLE:    PluginErrorDetailsSchema,
  PLUGIN_CAPABILITY_MISMATCH:      PluginErrorDetailsSchema,
  PLUGIN_MANIFEST_MISALIGNED:      PluginErrorDetailsSchema,
  // 系统类
  SYS_PRECHECK_FAIL:              SystemDetailsSchema,
  SYS_INIT_FAIL:                  SystemDetailsSchema,
  SYS_INIT_OK:                    SystemDetailsSchema,
  WORLD_PACK_EMPTY:               SystemDetailsSchema,
  DEV_RUNTIME_RESET:              SystemDetailsSchema,
}
```

`NotificationManager.push()` 在校验码为已知 `NotificationCodeValue` 时，用对应的 Zod schema 校验 `details`；校验失败时 log warning 并降级为无 details 通知，不阻断业务。

#### 1.3 `SystemMessage.details` 类型收紧

`SystemMessage.details` 从 `Record<string, unknown> | undefined` 收紧为可辨识联合类型推断结果。前端按 `code` 选择对应 TypeScript 类型做渲染。

#### 1.4 队列容量与驱逐策略

当前 `MAX_MESSAGES = 50`，FIFO 截断，插件错误洪泛时会挤出关键系统通知。

**新策略**：

- 队列上限提高到 `MAX_MESSAGES = 200`。
- 驱逐时按 level 优先级保留：`error` > `warning` > `info`。当队列满时，从最低优先级（`info`）中最旧的开始驱逐。
- `pushOrReplace()`（见 §3.3）产生的替换不计入队列容量上限。

#### 1.5 前端通知面板扩展

`apps/web/features/shell/components/AppShell.vue` — Notifications dock 的每条消息卡片：

- 展开后，根据 `code` 从 `NotificationCodeDetailsMap` 对应的 TypeScript 类型渲染 details 中的结构化字段。
- 提供 `level` 和 `code` 的过滤下拉。
- 通过 `/api/system/notifications` 获取数据，`details` 字段随 `SystemMessage` 一起返回，无需新 API 端点。

---

### 2. 权限拒绝 → 通知集成

#### 2.1 Prompt slot 权限拒绝

**现状**：`applyPermissionFilter()`（`inference/prompt_permissions.ts`）把 `permission_denied: true` 写到 fragment 上。`PermissionFilterExecutor` 接收 `InferenceContext`，不含 `notifications`。

**桥接方案**：提取薄接口 `NotificationAware { readonly notifications: NotificationStore }`，让 `RuntimeContext` 和 `InferenceContext` 分别扩展它。不采用 `InferenceContext extends RuntimeContext`，原因见下方分析。

在 `InferenceContext` 构造处（`pipeline.ts`），从 `AppContext.notifications` 传入同一实例。executor 调用链中所有 executor 都已接收 `InferenceContext`，无需逐个改签名。

为什么不采用 `InferenceContext extends RuntimeContext`：

| 维度 | 影响 |
|------|------|
| 语义冲突 | InferenceContext 是每次推理运行的快照数据对象；RuntimeContext 含 `setRuntimeReady`/`setPaused`/`setRuntimeLoopDiagnostics` 等突变方法，是服务器生命周期服务定位器。混入意味着 workflow 步骤可以修改服务器运行状态，破坏层级边界 |
| 构造断裂 | `pipeline.ts` 用 plain object literal 构造 InferenceContext，继承 RuntimeContext 后需传入全部 14 个字段/方法，或改为 spread `AppContext`，导致推理上下文依赖全部服务器基础设施 |
| 测试膨胀 | 21+ 测试文件构造 `as unknown as InferenceContext` mock，继承后需补全部 RuntimeContext 方法的 stub |
| 依赖膨胀 | 43+ 源文件 import InferenceContext，继承后全部间接依赖 `PackScopeResolver`/`PackCatalogService`/`PackRuntimeHandle`/`SpatialRuntime` 等重型类型 |
| 耦合升级 | RuntimeContext 任何方法签名变更都会强制重编译所有 InferenceContext 消费者，而当前两者变更频率完全不同 |

提取 `NotificationAware` 薄接口只引入 `NotificationStore` 一个依赖（已在 InferenceContext 构造链路上可用），无上述副作用。

**通知推送**：在 `PermissionFilterExecutor.execute()` 完成过滤后，汇总所有 `fragment.permission_denied` 和 `fragment.denial` 统计，调用 `context.notifications.pushOrReplace('warning', ...)` 推送一条摘要通知，替换同一 workflow 步骤的旧条目。

**feature flag 行为**：`prompt_slot_permissions` feature flag 关闭时，executor 不执行过滤，也不推送通知——这是预期行为。开启时推送。

**推送时机**：每次 workflow 执行 permission_filter 步骤后。

**通知内容示例**：
```
level: 'warning'
code: 'PERMISSION_SLOT_DENIED'
content: 'Prompt 权限过滤：5 个 fragment 被拒绝读取，3 个被拒绝可见性'
details: {
  module: 'permission-filter',
  timestamp: 1748764800000,
  subject_id: 'identity-xxx',
  kind: 'slot_denied',
  denied_read_count: 5,
  denied_visibility_count: 3,
  affected_slot_ids: ['world_state', 'agent_memory', ...],
  actor_identity_id: 'identity-xxx',
  actor_agent_id: 'agent-yyy'
}
```

**修改文件**：
- `apps/server/src/app/context.ts` 或 `inference_context.ts` — `InferenceContext` 新增 `notifications: NotificationStore`
- `apps/server/src/context/workflow/executors/permission_filter.ts` — 过滤完成后汇总统计，调用 `pushOrReplace`

#### 2.2 插件能力检查拒绝（非 HTTP 路径）

**现状**：`host_call_handler.ts` 中能力检查失败时抛出 `ApiError(403, 'PLUGIN_CAPABILITY_DENIED', ...)`，错误在 `handleHostCall`（`PluginWorkerClient.ts`）被 catch，序列化后发回 worker，主线程不记录。

**方案**：职责分为两层：

1. `host_call_handler.ts`：在抛出的 `ApiError.details` 中补充 `pack_id` 和 `method` 字段（已有 `plugin_id`、`installation_id`、`capability`）。
2. `PluginWorkerClient.handleHostCall` 的 catch 分支：识别 `ApiError` 的 `code === 'PLUGIN_CAPABILITY_DENIED'`，向 `context.notifications` 推送一条 `PERMISSION_CAPABILITY_DENIED` warning。序列化回 worker 的逻辑不变。

**修改文件**：
- `apps/server/src/plugins/worker/PluginWorkerClient.ts` — `handleHostCall` 的 catch 分支新增通知推送
- `apps/server/src/plugins/worker/host_call_handler.ts` — `ApiError.details` 补充 `pack_id`、`method`

#### 2.3 Pack 访问拒绝

**现状**：`pack_access.ts` 已通过 `ApiError → error_handler → notifications` 路径间接推送。`NotificationCode.PERMISSION_PACK_ACCESS_DENIED` 仅规范 code，不改变推送路径。

---

### 3. 插件错误 → 通知集成

#### 3.1 崩溃链路去重：单一通知点原则

原设计把 `onCrash`、`handleCrash`、`invoke` 连续失败阈值列为三个独立通知点。实际调用链是：

```
invoke 连续失败超阈值 → PluginWorkerClient.handleCrash()
  → this.onCrash?.(error)
    → PluginWorkerManager.onCrash（删除 map 条目 + log）
```

同一崩溃事件走这条链只会触发一次。但原设计还把 `request` timeout 列为独立通知点，而 timeout 后如果连续失败超阈值，会紧接着触发 crash——产生 `PLUGIN_WORKER_TIMEOUT` + `PLUGIN_WORKER_CRASHED` 两条通知，且 throttle key 不同（一个含 `TIMEOUT`，一个含 `CRASHED`），不会去重。

**新方案**：通知推送统一由 `PluginWorkerClient` 内部决定。`PluginWorkerManager.onCrash` 回调不推送通知（只做 map 清理），避免双重推送。

| 崩溃场景 | 通知码 | 推送位置 | 逻辑 |
|---------|--------|---------|------|
| Worker 激活失败 | `PLUGIN_ACTIVATION_FAILED` | `PluginWorkerManager.activateInstallation` catch | 激活失败不进 onCrash 链路，独立推送 |
| Worker 运行时崩溃（unhandled） | `PLUGIN_WORKER_CRASHED` | `PluginWorkerClient.handleCrash` | 单一推送点 |
| invoke 连续失败超阈值 | `PLUGIN_WORKER_CRASHED` | `PluginWorkerClient.invoke` catch → `handleCrash` | 经由 handleCrash 推送，不多推 |
| request timeout | `PLUGIN_WORKER_TIMEOUT` | `PluginWorkerClient.request` catch | 单独推送；如果后续触发 crash，crash 由 handleCrash 另推 |

timeout + crash 产生两条不同 code 通知是合理的——它们是不同性质的事件（超时、崩溃），且 crash 通知作为更严重的事件补充超时通知。

#### 3.2 改动点清单

| # | 文件 | 函数/位置 | 错误场景 | 通知码 | 备注 |
|---|------|----------|---------|--------|------|
| 1 | `PluginWorkerManager.ts` | `activateInstallation` catch | Worker 激活失败 | `PLUGIN_ACTIVATION_FAILED` | |
| 2 | `PluginWorkerClient.ts` | `handleCrash` | Worker 通用崩溃 | `PLUGIN_WORKER_CRASHED` | 单一推送点 |
| 3 | `PluginWorkerClient.ts` | `request` timeout catch | 调用超时 | `PLUGIN_WORKER_TIMEOUT` | |
| 4 | `runtime.ts` | `refreshPackPluginRuntime` | Host API 不兼容 | `PLUGIN_HOST_API_INCOMPATIBLE` | |
| 5 | `runtime.ts` | `refreshPackPluginRuntime` catch | 激活异常 | `PLUGIN_ACTIVATION_FAILED` | |
| 6 | `PluginWorkerManager.ts` | `assertDescriptorCapabilities` | 能力声明不匹配 | `PLUGIN_CAPABILITY_MISMATCH` | |
| 7 | `PluginWorkerManager.ts` | `assertManifestDescriptorAlignment` | Manifest 与 descriptor 不对齐 | `PLUGIN_MANIFEST_MISALIGNED` | |

**需要特殊处理的改动点**：

**#6 #7 — `assertDescriptorCapabilities` / `assertManifestDescriptorAlignment` 上下文补全**：这两个函数当前抛 plain `Error`，不带 `pack_id`/`plugin_id`/`installation_id`。改动方案：在 catch 点（`activateInstallation` 内），从闭包变量组装完整 `PluginErrorDetails`，不从 Error 对象推断。这两个断言函数的签名和 throw 行为不变，通知上下文由调用方注入。

```typescript
// PluginWorkerManager.activateInstallation catch 分支示例
catch (error: unknown) {
  // ... terminate worker, persist last_error ...
  context.notifications.pushOrReplace(
    'error',
    `插件 ${pluginId} 能力声明不匹配`,
    NotificationCode.PLUGIN_CAPABILITY_MISMATCH,
    {
      module: 'plugin-worker-manager',
      pack_id: packId,
      plugin_id: pluginId,
      installation_id: installationId,
      phase: 'activation',
      raw_message: String(error),
      timestamp: Date.now(),
    },
    `plugin:${installationId}:PLUGIN_CAPABILITY_MISMATCH`,
  )
}
```

#### 3.3 去重策略：`pushOrReplace` 替代 `pushThrottled`

原设计的 `pushThrottled` 在时间窗口内丢弃重复通知。这对权限场景有问题：20 秒后第二次 permission_filter 的拒绝统计比第一次更重要，不应丢弃。

**新策略**：`pushOrReplace(level, content, code, details, replaceKey)` — 如果队列中已存在相同 `replaceKey` 的消息，替换其 `content`、`details`、`timestamp`；否则新建。`replaceKey` 由调用方传入（如 `plugin:${installationId}:PLUGIN_WORKER_CRASHED`）。

原有 `push()` 不受影响，继续用于一次性事件（如 `SYS_INIT_OK`）。

```typescript
public pushOrReplace(
  level: NotificationLevel,
  content: string,
  code: NotificationCodeValue,
  details: Record<string, unknown>,
  replaceKey: string,
): SystemMessage
```

插件错误通知使用 `replaceKey = 'plugin:' + installationId + ':' + code`，确保同一安装的同一类错误始终只有最新一条。

权限通知使用 `replaceKey` 以 workflow step 为粒度（每次 permission_filter 执行有唯一 step ID），保证前端总是能看到最新的拒绝统计。

#### 3.4 `PluginInstallationLastError.phase` 与 `PluginErrorDetails.phase` 统一

原设计中两个 phase 枚举不一致（`PluginErrorDetails` 缺 `host_api_check`）。统一为一处定义：

```typescript
// apps/server/src/utils/notification_details.ts
export const PluginErrorPhase = {
  ACTIVATION: 'activation',
  INVOCATION: 'invocation',
  DEACTIVATION: 'deactivation',
  HOST_CALL: 'host_call',
  CRASH: 'crash',
  HOST_API_CHECK: 'host_api_check',
} as const

export type PluginErrorPhaseValue = (typeof PluginErrorPhase)[keyof typeof PluginErrorPhase]
```

`PluginInstallationLastError.phase` 和 `PluginErrorDetails.phase` 均引用此类型。

---

### 4. 插件错误源位置追踪

#### 4.1 问题分析

Worker 线程内抛出的错误，其 `stack` 指向的是 `worker_thread` 内部经过 `tsx`/`ts-node` 编译后的路径，不是原始 `.ts` 源文件。而且错误在 `serializePluginError()` 序列化、跨线程传输、`extractErrorMessage/Name/Stack()` 反序列化过程中丢失了原始 Error 对象的属性。

#### 4.2 Worker 端增强：Error 序列化附加源信息

`apps/server/src/plugins/worker/protocol.ts` — `serializePluginError()` 扩展：

```typescript
interface SerializedPluginError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  // 新增
  source_location?: {
    file: string;
    line?: number;
    column?: number;
  };
  cause?: SerializedPluginError;  // 递归序列化 cause 链，最多 3 层
}
```

**递归深度限制**：`serializePluginError` 增加 `depth` 参数（默认 `0`），当 `depth >= 3` 时停止递归 `cause`，改为在 `cause` 字段写入 `{ message: String(error.cause), truncated: true }`。防止循环引用或不限深度的 cause 链导致栈溢出或超大数据包。

解析逻辑：从 `error.stack` 的第一帧（`at xxx (file:line:column)`）用正则提取文件路径和行列号。Worker 端执行（`worker_entry.ts`），因为此时 stack 最完整。

#### 4.3 Worker 入口 manifest 路径注入

`worker_entry.ts` 在 `activate()` 时接收 `artifactRoot`（已是 `PluginWorkerActivationInput` 的字段），作为源文件路径解析的基准目录。`source_location.file` 如果能映射到 `artifactRoot` 下的相对路径，则输出相对路径，方便定位。

#### 4.4 主线程端：PluginWorkerClient 保留源位置

`PluginWorkerClient.resolvePending()` 反序列化 error 时，除了 `name`、`message`、`stack`，额外将 `source_location` 和 `cause` 挂到 `Error` 对象上。

使用 `attachErrorMetadata(error, { source_location, cause })` 工具函数代替直接 `(error as any).source_location = ...`，集中管理非标准属性的挂载，便于类型守卫和调试。

#### 4.5 `extractSourceLocation()` 工具函数

`apps/server/src/utils/error_source.ts` — 新增：

```typescript
interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export function extractSourceLocation(error: unknown): SourceLocation | undefined {
  // 优先取序列化时挂上的 source_location
  if (typeof error === 'object' && error !== null) {
    const loc = (error as Record<string, unknown>)['source_location'];
    if (loc && typeof loc === 'object') {
      const sl = loc as Record<string, unknown>;
      if (typeof sl['file'] === 'string') {
        return {
          file: sl['file'] as string,
          line: typeof sl['line'] === 'number' ? sl['line'] : undefined,
          column: typeof sl['column'] === 'number' ? sl['column'] : undefined,
        };
      }
    }
  }
  // 回退：从 stack 解析
  if (error instanceof Error && error.stack) {
    return parseSourceLocationFromStack(error.stack);
  }
  return undefined;
}
```

---

### 5. `last_error` 结构化

#### 5.1 数据库字段

`PluginInstallation.last_error` 当前是 `String?`。不修改 Prisma schema，SQLite 下仍是 `String?`。应用层写入时 JSON 序列化，读取时尝试 JSON 解析（降级为纯字符串显示）。

#### 5.2 写入格式与竞态处理

```typescript
interface PluginInstallationLastError {
  message: string;
  code: NotificationCodeValue;
  timestamp: string;  // ISO-8601
  phase: PluginErrorPhaseValue;
  source_location?: {
    file: string;
    line?: number;
    column?: number;
  };
  cause?: {
    message: string;
    source_location?: { file: string; line?: number; column?: number };
  };
}
```

**竞态处理**：`refreshPackPluginRuntime` 激活成功后写 `last_error: undefined`（清空），但 `onCrash` 可能在激活成功后、registry 注册完成前触发并写结构化 JSON。由于 `onCrash` 代表更严重的事实，设计为 **crash 写入总是覆盖先前的 `undefined`**。Prisma `update` 是原子操作，后来的写覆盖先到的写，语义正确。

#### 5.3 前端插件状态展示

**API 端点**：复用现有 `GET /api/system/notifications` 返回 `SystemMessage[]`（含 details 字段）。插件安装状态通过 `GET /api/packs/:packId/plugins` 返回（已有端点或需新增），`last_error` 字段返回原始 string，前端尝试 JSON.parse 降级。

**通知 dock**：插件相关通知卡片展开后显示 `pack_id → plugin_id → source_location`，`source_location` 为文件路径时提供可选中复制的文本。点击插件通知时弹出详情面板，展示结构化的 `last_error`、worker 存活状态。不新建独立的插件管理页面。

---

### 6. 改动文件总览

| 文件 | 改动 |
|------|------|
| `apps/server/src/utils/notifications.ts` | 新增 `NotificationCode` 枚举；新增 `pushOrReplace()`；队列容量 200 + level 优先驱逐 |
| `apps/server/src/utils/notification_details.ts` | **新建** — Zod schema、details 类型、phase 枚举、code→schema 映射 |
| `apps/server/src/utils/error_source.ts` | **新建** — `extractSourceLocation()` + `parseSourceLocationFromStack()` + `attachErrorMetadata()` |
| `apps/server/src/app/middleware/error_handler.ts` | `details` 中附带 `module` 和 `source_location`（对 Error 对象提取）；使用 `NotificationCode` 规范现有 code |
| `apps/server/src/plugins/worker/protocol.ts` | `SerializedPluginError` 新增 `source_location` 和 `cause`；`serializePluginError()` 从 stack 提取位置，递归深度 ≤3 |
| `apps/server/src/plugins/worker/worker_entry.ts` | 激活/调用/停用错误处理中传入 `artifactRoot` 以解析相对路径 |
| `apps/server/src/plugins/worker/PluginWorkerClient.ts` | `resolvePending` 保留 `source_location` + `cause`；`handleCrash` 推送通知（单一推送点）；`handleHostCall` catch 推送能力拒绝通知；timeout 推送通知 |
| `apps/server/src/plugins/worker/PluginWorkerManager.ts` | `activateInstallation` catch 推送通知；`onCrash` 回调不再推送通知（只做 map 清理）；descriptor 断言失败推送通知（从闭包变量组装 details） |
| `apps/server/src/plugins/runtime.ts` | Host API 不兼容和激活失败推送通知；`last_error` 写结构化 JSON |
| `apps/server/src/plugins/worker/host_call_handler.ts` | 能力拒绝 `ApiError` details 补充 `pack_id`、`method` |
| `apps/server/src/context/workflow/executors/permission_filter.ts` | 过滤完成后汇总拒绝统计，调用 `pushOrReplace` |
| `apps/server/src/app/context/runtime_context.ts` | `NotificationStore` 接口新增 `pushOrReplace` 方法签名 |
| `apps/server/src/app/context/runtime_context.ts` | 新增 `NotificationAware` 薄接口（`{ readonly notifications: NotificationStore }`）；`RuntimeContext` 改为扩展 `NotificationAware` |
| `apps/server/src/inference/types.ts` | `InferenceContext` 改为扩展 `NotificationAware`；`pipeline.ts` 构造时从 `AppContext.notifications` 传入 |
| `apps/web/stores/notifications.ts` | 扩展 `NotificationItem` 类型，解析 `details` 字段 |
| `apps/web/features/shell/components/AppShell.vue` | Notifications dock 展开 details，按 level/code 过滤 |

---

### 7. 不做的

- **实时 push（WebSocket/SSE）**：当前轮询足够，5 秒延迟对运维场景可接受。
- **通知持久化**：`NotificationManager` 保持内存队列，不写 DB。通知是运行时诊断信号，不是审计记录。
- **错误自动恢复**：本文只解决"看得见、看得懂"的问题，不改变插件的崩溃/重启策略。
- **前端独立插件管理页面**：只在通知 dock 中点击插件通知时弹出详情面板，不新建独立的插件管理页面。
- **`InferenceContext extends RuntimeContext`**：采用 `NotificationAware` 薄接口替代，避免语义冲突、构造断裂、测试膨胀和依赖膨胀。
- **ErrorCode 枚举清理**：`ErrorCode` 中未使用的插件相关 code 不在本方案范围，另立 PR 清理。

---

### 8. 测试策略

| 层级 | 覆盖内容 |
|------|---------|
| 单元测试 | `NotificationCode` 枚举完整性；`pushOrReplace` 替换逻辑；`extractSourceLocation` 正则解析；`serializePluginError` cause 深度截断；`parseNotificationDetails` Zod 校验 |
| 集成测试 | Workflow 执行 permission_filter 后 `NotificationManager` 中出现 `PERMISSION_SLOT_DENIED`；`handleHostCall` catch 能力拒绝后出现 `PERMISSION_CAPABILITY_DENIED`；plugin 崩溃后出现 `PLUGIN_WORKER_CRASHED` 且只出现一条；`last_error` JSON 结构解析降级 |
| 单元测试 | `NotificationManager` 驱逐策略：200 条上限，满时按 level 优先级驱逐 |

---

### 9. 实施顺序

| 阶段 | 内容 | 依赖 |
|------|------|------|
| 1 | §1 NotificationCode 枚举 + details 类型系统 + Zod schema + `pushOrReplace` + 队列驱逐策略 | — |
| 2 | §4.2–4.5 插件错误源位置追踪（protocol + worker_entry + PluginWorkerClient + error_source.ts） | — |
| 3 | §3 插件错误路径推送通知（7 个改动点） | 1, 2 |
| 4 | §2.1 Prompt slot 权限拒绝通知（`NotificationAware` 薄接口 + `InferenceContext` 扩展 + executor 改动） | 1 |
| 5 | §2.2 插件能力拒绝非 HTTP 路径通知 | 1, 3 |
| 6 | §5.1–5.2 last_error 结构化写入 | 2 |
| 7 | 前端：通知面板 details 展开 + 插件状态面板 | 1–6 的后端部分完成 |

阶段 1–2 可以并行；阶段 3–6 依赖 1 和 2；阶段 7 依赖所有后端改动完成。每阶段完成后运行 `pnpm lint && pnpm typecheck && pnpm test:unit`。