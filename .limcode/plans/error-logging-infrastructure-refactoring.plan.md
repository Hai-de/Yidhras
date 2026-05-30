## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 1: 重写 Logger — Error 原生支持 + 按模块级别 + stack/cause 序列化 `#EL-1`
- [x] Phase 2: 进程级安全网 — unhandledRejection + uncaughtException handler `#EL-2`
- [x] Phase 3: 统一错误类型体系 — AppError 基类 + 领域子类 + 错误码枚举 `#EL-3`
- [x] Phase 4: 创建 `captureError` 工具函数 — 所有空 catch 的最低门槛 `#EL-4`
- [x] Phase 5: 消除 AI 网关 & Provider 静默吞 (HIGH) — gateway.ts, anthropic.ts, openai.ts, openai_compatible.ts `#EL-5`
- [x] Phase 6: 消除推理 & 行为树静默吞 (HIGH) — inference/service.ts, behavior_tree/leaves.ts `#EL-6`
- [x] Phase 7: 消除插件系统静默吞 (HIGH/MEDIUM) — PluginWorkerManager.ts, runtime.ts `#EL-7`
- [ ] Phase 8: 消除调度器 & 存储层静默吞 (MEDIUM) — scheduler/*, PostgresPackStorageAdapter, pack_catalog_service `#EL-8`
- [ ] Phase 9: 消除运行时 & 上下文静默吞 (MEDIUM) — perception_pipeline, pack_scope_middleware, content_transform, state_snapshot_builder `#EL-9`
- [x] Phase 10: JSON.parse 规范化 — `tryParseJson` 工具 + 可选 warn `#EL-10`
- [x] Phase 11: re-throw 保留 cause 链 — runtime_clock_projection, http/runtime, ai_invocations, social, cursor, parsers `#EL-11`
- [x] Phase 12: Web 端错误处理 — proxy-api.ts, [packId].vue, evaluator.ts console.error `#EL-12`
- [x] Phase 13: 消除重复日志路径 — NotificationManager 与 Logger 协调 `#EL-13`
- [x] Phase 14: Prisma 错误映射层 — 集中化 Prisma error → AppError 转换 `#EL-14`
- [ ] Phase 15: ESLint 回归防护 — no-console + 禁止空 catch + only-throw-error → 独立计划 `#EL-15`
- [x] Phase 16: Rate limit 错误信封一致性修复 `#EL-16`
- [ ] Phase 17: safe_fs 错误类型化 → 独立计划 `#EL-17`
- [x] Phase 18: Graceful shutdown 加固 — await close + 顺序容错 `#EL-18`
- [x] Phase 19: config/watcher 可见性 — 禁用时记录日志 `#EL-19`
- [x] Phase 20: typecheck + unit + integration + e2e 全量验证 `#EL-20`
<!-- LIMCODE_TODO_LIST_END -->

# 错误日志基础设施破坏性重构

## 背景

当前项目的错误处理和日志系统存在四个层面的结构性问题：

### 问题 1: Logger 不支持 Error 对象

`apps/server/src/utils/logger.ts` 的 `Logger` 接口定义为：

```typescript
error(message: string, data?: Record<string, unknown>): void;
```

传入 `new Error()` 时 `JSON.stringify` 返回 `{}`，导致 stack trace、cause 链完全丢失。没有 `logger.error(message, error)` 的重载。

### 问题 2: 进程级安全网缺失

`index.ts` 只注册了 `SIGINT`/`SIGTERM`。没有 `process.on('unhandledRejection')` 或 `process.on('uncaughtException')`。任何未捕获的异步错误导致进程静默崩溃，只有 Node 默认的 stderr dump。

### 问题 3: 40+ 处静默吞错误

空 catch 块（`catch { }`）、`.catch(() => {})`、错误信息丢失的 re-throw 遍布整个代码库。审计发现：

| 严重程度 | 数量 | 典型影响 |
|---------|------|---------|
| HIGH | 6 | AI 路由失败完全静默、压缩失败静默丢失、插件 promise 拒绝完全丢弃 |
| MEDIUM | 19 | 调度器查询失败返回空、行为树失败映射为 'failure'、DB 查询失败静默返回空数组 |
| LOW | ~100 | JSON.parse 回退、localStorage 不可用、文件读取回退 |

### 问题 4: 没有领域错误类型

只有 `ApiError`（HTTP 传输层）。没有 `AIError`、`InferenceError`、`PackError`、`PluginError`、`SidecarError`。所有内部错误用 `new Error(string)` 承载，没有结构化错误码、没有 cause 链。

---

## 设计原则

1. **永不静默吞错误。** 最低限度：`captureError(error, context)` — 记录结构化日志，携带发生位置和上下文。
2. **Error 是一等公民。** Logger 原生接受 `Error` 对象，自动提取 `message`/`stack`/`cause`。
3. **按模块控制日志级别。** `LOGGING_LEVEL=info,ai=debug,inference=warn` 格式，替换全局单一级别。
4. **可恢复 vs 不可恢复分离。** 用 `Result<T, E>` 模式处理可恢复错误（替代 `return null`）；不可恢复错误用 throw 传播。
5. **CLI 和 Server 共享 Logger。** CLI 脚本不再直接使用 `console.log/error`。

---

## Phase 1: 重写 Logger

**文件**: `apps/server/src/utils/logger.ts`（完全重写）

### 新 Logger 接口

```typescript
export interface LogContext {
  /** 关联的 Error 对象（自动提取 message/stack/cause） */
  error?: Error;
  /** 结构化附加上下文 */
  data?: Record<string, unknown>;
  /** 错误码 */
  code?: string;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
```

### 关键行为

- **Error 序列化**: 当 `context.error` 存在时，自动提取 `error.message`、`error.stack`、`error.cause`（递归展开 cause 链），以及 `error.name`。这些字段自动合并到日志输出的 JSON 中。
- **stack trace 捕获**: 对于非 Error 对象的调用，`logger.error(msg)` 自动调用 `Error.captureStackTrace` 生成调用栈（仅在非 production 环境）。
- **按模块日志级别**: 解析 `LOGGING_LEVEL` 支持 `模块前缀=级别` 语法：
  ```
  LOGGING_LEVEL=info,ai=debug,inference=warn,plugins=error
  ```
  匹配规则：最长前缀匹配。`ai/gateway` 匹配 `ai=debug`，`ai/providers/anthropic` 也匹配 `ai=debug`。
- **采样/节流**: `logger.error` 和 `logger.warn` 支持可配置的节流 —— 同一模块同一消息在 N 秒内最多输出 M 次。默认不节流，通过 `LOGGING_THROTTLE=error:5s/3,warn:10s/5` 环境变量配置。

### 破坏性变更

- `logger.error(msg, data)` → `logger.error(msg, { data })` — 所有调用点需要适配。
- `logger.warn(msg, data)` → `logger.warn(msg, { data })` — 同上。
- `logger.info(msg, data)` → `logger.info(msg, { data })` — 同上。
- `logger.debug(msg, data)` → `logger.debug(msg, { data })` — 同上。

**适配量**: 约 200-300 个调用点。大部分是机械替换，可用 ESLint 规则辅助。

### 新增导出

```typescript
// 全局错误捕获 —— 所有原本空 catch 的位置至少调这个
export function captureError(error: unknown, context: { module: string; message: string; data?: Record<string, unknown> }): void;

// JSON.parse 安全包装
export function tryParseJson<T>(value: string, module: string, context?: string): T | null;
```

---

## Phase 2: 进程级安全网

**文件**: 新建 `apps/server/src/utils/process_guard.ts`

```typescript
export function installProcessGuards(logger: Logger): void {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error, code: 'PROCESS_UNCAUGHT_EXCEPTION' });
    process.exitCode = 1;
    // 给 logger 刷新时间后退出
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection', { error, code: 'PROCESS_UNHANDLED_REJECTION' });
    // 不退出进程 —— unhandledRejection 不一定致命
    // 但记录完整 stack 用于排查
  });
}
```

在 `index.ts` 的启动序列中，`installProcessGuards` 必须是第一个调用（在 `setLoggerRuntimeConfig` 之后立即执行）。

---

## Phase 3: 统一错误类型体系

**文件**: 新建 `apps/server/src/utils/errors.ts`

### 错误码枚举

```typescript
export const ErrorCode = {
  // AI
  AI_PROVIDER_FAIL: 'AI_PROVIDER_FAIL',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_CIRCUIT_OPEN: 'AI_CIRCUIT_OPEN',
  AI_STREAM_FAIL: 'AI_STREAM_FAIL',
  AI_PARSE_FAIL: 'AI_PARSE_FAIL',
  AI_NO_PROVIDER: 'AI_NO_PROVIDER',
  // Inference
  INFERENCE_COMPACTION_FAIL: 'INFERENCE_COMPACTION_FAIL',
  INFERENCE_LOCK_CONTENTION: 'INFERENCE_LOCK_CONTENTION',
  INFERENCE_STRATEGY_FAIL: 'INFERENCE_STRATEGY_FAIL',
  // Plugin
  PLUGIN_LOAD_FAIL: 'PLUGIN_LOAD_FAIL',
  PLUGIN_EXECUTION_FAIL: 'PLUGIN_EXECUTION_FAIL',
  PLUGIN_WORKER_FAIL: 'PLUGIN_WORKER_FAIL',
  PLUGIN_TERMINATE_FAIL: 'PLUGIN_TERMINATE_FAIL',
  // Pack
  PACK_LOAD_FAIL: 'PACK_LOAD_FAIL',
  PACK_SCOPE_FAIL: 'PACK_SCOPE_FAIL',
  PACK_SNAPSHOT_FAIL: 'PACK_SNAPSHOT_FAIL',
  // Scheduler
  SCHEDULER_QUERY_FAIL: 'SCHEDULER_QUERY_FAIL',
  SCHEDULER_CURSOR_PARSE_FAIL: 'SCHEDULER_CURSOR_PARSE_FAIL',
  // Sidecar
  SIDECAR_TRANSPORT_FAIL: 'SIDECAR_TRANSPORT_FAIL',
  SIDECAR_COMMUNICATION_FAIL: 'SIDECAR_COMMUNICATION_FAIL',
  // Runtime
  RUNTIME_CLOCK_PARSE_FAIL: 'RUNTIME_CLOCK_PARSE_FAIL',
  RUNTIME_PERCEPTION_FAIL: 'RUNTIME_PERCEPTION_FAIL',
  // Storage
  STORAGE_QUERY_FAIL: 'STORAGE_QUERY_FAIL',
  STORAGE_PARSE_FAIL: 'STORAGE_PARSE_FAIL',
  // Context
  CONTEXT_TRANSFORM_FAIL: 'CONTEXT_TRANSFORM_FAIL',
  CONTEXT_OVERLAY_FAIL: 'CONTEXT_OVERLAY_FAIL',
  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PARSE_FAIL: 'PARSE_FAIL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

### AppError 基类

```typescript
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;
  readonly cause?: Error;

  constructor(code: ErrorCode, message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.context = options?.context;
  }
}
```

### 领域子类

```typescript
export class AIError extends AppError {
  constructor(code: ErrorCode, message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
    super(code, message, options);
    this.name = 'AIError';
  }
}

export class InferenceError extends AppError { ... }
export class PluginError extends AppError { ... }
export class PackError extends AppError { ... }
export class SchedulerError extends AppError { ... }
export class SidecarError extends AppError { ... }
export class StorageError extends AppError { ... }
```

### ApiError 适配

`ApiError` 保持不变（HTTP 传输层），但增加 `cause` 支持：

```typescript
export class ApiError extends AppError {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, options?: { cause?: Error; details?: unknown }) {
    super(code as ErrorCode, message, { cause: options?.cause });
    this.status = status;
    this.details = options?.details;
  }
}
```

---

## Phase 4: `captureError` 工具函数

```typescript
// apps/server/src/utils/capture_error.ts
import { createLogger } from './logger.js';

const captureLogger = createLogger('error-capture');

/**
 * 全局错误捕获 —— 所有原本空 catch 的位置的最低门槛。
 * 不抛出，不中断流程，但保证错误被记录。
 */
export function captureError(
  error: unknown,
  context: { module: string; message: string; code?: string; data?: Record<string, unknown> }
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  captureLogger.error(context.message, {
    error: err,
    code: context.code ?? 'CAPTURED_ERROR',
    data: { module: context.module, ...(context.data ?? {}) }
  });
}
```

使用示例 —— 将：

```typescript
} catch {
  // Compaction is best-effort. Swallow errors silently.
}
```

替换为：

```typescript
} catch (err: unknown) {
  captureError(err, {
    module: 'inference-service',
    message: 'Compaction failed',
    code: ErrorCode.INFERENCE_COMPACTION_FAIL
  });
}
```

---

## Phase 5: 消除 AI 网关 & Provider 静默吞

### 5a. `ai/gateway.ts` (行 590, 609, 649)

**当前**: 候选路由失败 `catch { continue }`，静默尝试下一个。所有候选失败后只剩 "no provider" 错误。

**改为**: 收集每个候选的失败原因，最终失败时报告完整信息。

```typescript
const candidateErrors: Array<{ provider: string; model: string; error: string }> = [];

// 在 catch 块中:
} catch (err: unknown) {
  candidateErrors.push({
    provider: candidate.provider,
    model: candidate.model,
    error: err instanceof Error ? err.message : String(err)
  });
  captureError(err, {
    module: 'ai-gateway',
    message: `AI candidate failed: ${candidate.provider}:${candidate.model}`,
    code: ErrorCode.AI_PROVIDER_FAIL
  });
}

// 最终失败时:
yield {
  type: 'error',
  code: 'STREAM_NO_PROVIDER',
  message: `No streaming provider available (tried ${candidateErrors.length} candidates)`,
  details: { candidates: candidateErrors }
};
```

### 5b. `ai/providers/anthropic.ts` (行 453, 472, 479, 490)

**当前**: `parseErrorPayload` 和 `tryParseJsonFromText` 中的空 catch 只注释 `// ignore`。

**改为**: 在 `tryParseJsonFromText` 中，每个 fallback 失败时记录 debug 级别日志（预期的 JSON 格式不匹配是正常情况）。在 `parseErrorPayload` 中，JSON 解析失败是意外情况，记录 warn。

### 5c. `ai/providers/openai.ts` 和 `openai_compatible.ts`

同样模式 —— JSON 解析 fallback 记录 debug，错误响应解析失败记录 warn。

---

## Phase 6: 消除推理 & 行为树静默吞

### 6a. `inference/service.ts:548` — 压缩失败

**当前**: `catch { // Compaction is best-effort. Swallow errors silently. }`

**改为**:

```typescript
} catch (err: unknown) {
  captureError(err, {
    module: 'inference-service',
    message: 'Compaction failed for speaker memory',
    code: ErrorCode.INFERENCE_COMPACTION_FAIL,
    data: { speaker_id: speakerMemory.speaker?.agent_id }
  });
}
```

### 6b. `inference/service.ts:756` — 锁所有权检查

**当前**: `catch { return null; }` — 锁竞争导致执行静默取消。

**改为**: `catch (err: unknown) { captureError(err, ...); return null; }` — 保留 return null 行为（锁竞争不是错误），但记录日志。

### 6c. `inference/providers/behavior_tree/nodes/leaves.ts:29,77` — 行为树失败

**当前**: `catch { return 'failure'; }` — action handler 和 LLM decision 失败都静默映射为 'failure'。

**改为**: 记录错误日志后再返回 'failure'，携带行为树名称和 agent ID。

```typescript
} catch (err: unknown) {
  captureError(err, {
    module: 'behavior-tree',
    message: `Action handler failed in tree "${treeName}"`,
    code: ErrorCode.PLUGIN_EXECUTION_FAIL,
    data: { agent_id: ctx.blackboard['agent_id'], tree_name: treeName, action: action.kernel }
  });
  return 'failure';
}
```

---

## Phase 7: 消除插件系统静默吞

### 7a. `plugins/runtime.ts:311` — `.catch(() => {})`

**当前**: DB 持久化失败完全丢弃。

**改为**: 至少 `.catch((err: unknown) => { captureError(err, { module: 'plugin-runtime', message: 'Failed to persist plugin installation error' }); })`

### 7b. `plugins/worker/PluginWorkerManager.ts` (行 235-275，5 处)

**当前**: `.catch(() => {})` 和 `.catch(() => undefined)` 在 terminate/deactivate/persistInstallationError 上。

**改为**: 全部改为 `.catch((err: unknown) => { captureError(err, { module: 'plugin-worker-manager', message: '...' }); })`。保留 undefined fallback 行为（cleanup 失败不应该阻断流程）。

---

## Phase 8: 消除调度器 & 存储层静默吞

### 8a. `app/services/scheduler/worker-queries.ts:26` 和 `rebalance-queries.ts:27`

**当前**: `catch { return []; }` — 存储查询失败静默返回空列表。

**改为**: 记录 warn 后再返回空列表。

### 8b. `packs/storage/internal/PostgresPackStorageAdapter.ts` (行 388, 415, 511)

**当前**: 查询失败静默返回空数组或 false。

**改为**: 记录 warn 后再返回 fallback。

### 8c. `packs/orchestration/pack_catalog_service.ts:49`

**当前**: pack 加载失败静默返回 null。

**改为**: 记录 warn 后再返回 null。

---

## Phase 9: 消除运行时 & 上下文静默吞

### 9a. `app/runtime/perception_pipeline.ts:44`

**当前**: `catch { // ignore parse errors }`

**改为**: 记录 debug 级别（parse 失败在感知管道中是预期内的）。

### 9b. `app/http/pack_scope_middleware.ts:43`

**当前**: scope 解析失败静默回退到 stub scope。

**改为**: 记录 warn 后再回退。

### 9c. `context/workflow/executors/content_transform.ts:130`

**当前**: `catch { // On transform error, keep original content }`

**改为**: 记录 warn（携带 transformer 名称）后再保留原始内容。

### 9d. `inference/context/state_snapshot_builder.ts:57`

**当前**: `catch { return []; }` — DB 查询失败静默返回空。

**改为**: 记录 warn 后再返回空。

---

## Phase 10: JSON.parse 规范化

**问题**: 约 30+ 处 `JSON.parse` 被空 catch 包裹，失败静默返回 `null`/`[]`/`{}`/`''`。虽然大部分是预期内的（解析可能畸形的用户数据），但累计效应是任何 JSON 解析失败都完全不可见。

**方案**: 创建统一的 `tryParseJson<T>` 包装：

```typescript
// apps/server/src/utils/json_parse.ts
import { createLogger } from './logger.js';

const parseLogger = createLogger('json-parse');

export function tryParseJson<T = unknown>(
  value: string,
  options?: { module?: string; context?: string; warnOnFail?: boolean }
): T | null {
  try {
    return JSON.parse(value) as T;
  } catch (err: unknown) {
    if (options?.warnOnFail) {
      parseLogger.warn('JSON parse failed', {
        error: err instanceof Error ? err : undefined,
        data: { module: options.module, context: options.context, preview: value.slice(0, 200) }
      });
    }
    return null;
  }
}
```

**策略**:
- 存储层 JSON.parse（pack 数据、memory blocks、conversation store）→ `warnOnFail: true`（数据损坏应该被知道）
- AI 响应解析 → `warnOnFail: false`（JSON 提取失败是正常情况，有 fallback 逻辑）
- 配置/模板解析 → `warnOnFail: true`（配置错误应该被知道）
- CLI 工具 → `warnOnFail: false`（用户可见的输出已足够）

---

## Phase 11: re-throw 保留 cause 链

**受影响文件**:

| 文件 | 当前行为 | 改为 |
|------|---------|------|
| `app/runtime/runtime_clock_projection.ts:69` | `catch { throw new Error(...) }` | `catch (err: unknown) { throw new Error(... , { cause: err }) }` |
| `app/http/runtime.ts:27` | `catch { throw new ApiError(400, ...) }` | `catch (err: unknown) { throw new ApiError(400, ..., { cause: err }) }` |
| `app/services/inference_workflow/ai_invocations.ts:162` | `catch { throw new ApiError(400, ...) }` | 同上 |
| `app/services/social/social.ts:176` | `catch { throw new ApiError(400, ...) }` | 同上 |
| `app/services/scheduler/cursor.ts:23` | `catch { throw new ApiError(400, ...) }` | 同上 |
| `app/services/inference_workflow/parsers.ts:163` | `catch { throw new ApiError(400, ...) }` | 同上 |

`ApiError` 构造函数已支持 `cause` 选项（Phase 3），所以这些改动是纯机械的。

---

## Phase 12: Web 端错误处理

### 12a. `web/server/middleware/proxy-api.ts:18`

**当前**: `catch { throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' }) }` — 原始错误丢失。

**改为**:

```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[proxy-api] Proxy request failed: ${target} — ${message}`);
  throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', data: { proxy_error: message } });
}
```

### 12b. `web/pages/packs/[packId].vue:44`

**当前**: API 调用失败静默重试然后回退到 'default'，用户看不到任何错误。

**改为**: 在最终回退时通过 notification store 显示错误。

### 12c. `inference/providers/behavior_tree/evaluator.ts:123`

**当前**: `console.error(...)` 绕过 logger。

**改为**: 使用 `createLogger('behavior-tree-evaluator')`。

---

## Phase 13: 消除重复日志路径

**文件**: `apps/server/src/utils/notifications.ts`

**当前**: `NotificationManager.push()` 同时调 `logger.error/warn/info` 和存内存。

**问题**: 同一条错误产生两条日志路径（Logger → stdout，NotificationManager → 内存），没有协调。如果 logger 格式变了，NotificationManager 的日志调用可能不同步。

**改为**: `NotificationManager.push()` 不再直接调 logger。改为返回 notification ID，由调用方决定是否同时记录日志。在 Express error handler 等少数位置，显式调用 `logger.error` + `notifications.push`。

---

## Phase 14: Prisma 错误映射层

**文件**: 新建 `apps/server/src/utils/prisma_errors.ts`

**问题**: 只有 `PrismaClientKnownRequestError` 的 `P2002`（唯一约束冲突）被处理。所有其他 Prisma 错误类型 —— `PrismaClientValidationError`（坏输入）、`PrismaClientInitializationError`（连接失败）、`PrismaClientRustPanicError`（引擎崩溃）、`PrismaClientUnknownRequestError`（未知数据库错误）—— 都无差别地变成 500 `API_INTERNAL_ERROR`。

**方案**: 集中化的 Prisma 错误 → `AppError` 映射函数。

```typescript
// apps/server/src/utils/prisma_errors.ts
import { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from './errors.js';

/**
 * 将 Prisma 错误映射为 AppError。
 * 未知错误返回 null，由调用方决定如何处理。
 */
export function mapPrismaError(err: unknown, context?: Record<string, unknown>): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return new AppError(ErrorCode.STORAGE_QUERY_FAIL,
          `Unique constraint violation on ${String(err.meta?.target ?? 'unknown')}`,
          { cause: err, context });
      case 'P2025':
        return new AppError(ErrorCode.STORAGE_QUERY_FAIL,
          'Record not found',
          { cause: err, context });
      default:
        return new AppError(ErrorCode.STORAGE_QUERY_FAIL,
          `Database query failed: ${err.message}`,
          { cause: err, context });
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return new AppError(ErrorCode.STORAGE_QUERY_FAIL,
      'Invalid database query',
      { cause: err, context });
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new AppError(ErrorCode.STORAGE_QUERY_FAIL,
      'Database connection failed',
      { cause: err, context });
  }
  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return new AppError(ErrorCode.INTERNAL_ERROR,
      'Database engine crashed',
      { cause: err, context });
  }
  return null;
}
```

**迁移策略**: 找到现有的两处 `PrismaClientKnownRequestError` 处理（`workflow_job_repository.ts:374` 和 `workflow_run_repository.ts:81`），替换为 `mapPrismaError`。在 Express error handler 中增加对 Prisma 错误类型的识别，自动映射为 AppError。

---

## Phase 15: ESLint 回归防护

**文件**: `apps/server/eslint.config.mjs`（修改）

**问题**: 重构完成后，没有任何 ESLint 规则阻止开发者写出新的 `console.log` 或空 `catch`。

**变更**:

```javascript
// 1. 禁止直接 console — logger.ts 内部除外
rules: {
  'no-console': ['error', { allow: [] }],
  // logger.ts 文件内用 overrides 放行
}

// 2. 禁止空 catch 块
rules: {
  '@typescript-eslint/no-empty-object-type': 'error', // 已有
  // 手动配置 no-empty 对 catch 子句的检查
  'no-empty': ['error', { allowEmptyCatch: false }],
}

// 3. 禁止 throw 原始值
rules: {
  '@typescript-eslint/only-throw-error': 'error',
}
```

**logger.ts 例外**: 在 `overrides` 中为 `src/utils/logger.ts` 放行 `no-console`：

```javascript
{
  files: ['src/utils/logger.ts'],
  rules: {
    'no-console': 'off',
    'no-empty': 'off',
  }
}
```

**CLI 脚本例外**: CLI 文件可有条件放行 `no-console`（CLI 的输出本质上是用户界面）：

```javascript
{
  files: ['src/cli/**/*.ts'],
  rules: {
    'no-console': 'off',
  }
}
```

---

## Phase 16: Rate Limit 错误信封一致性

**文件**: `apps/server/src/app/middleware/rate_limit.ts`

**当前**: rate limit 中间件返回裸格式：
```typescript
res.status(429).json({ error: 'Too many requests, please try again later.' });
```

缺少 `success: false`、`code`、`request_id`、`timestamp` — 与其他所有 API 错误不一致。客户端解析时对不同端点需要不同的错误形状判断。

**改为**:

```typescript
res.status(429).json({
  success: false,
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later.',
    request_id: typeof res.locals['requestId'] === 'string' ? res.locals['requestId'] : 'req_unknown',
    timestamp: Date.now()
  }
});
```

---

## Phase 17: safe_fs 错误类型化

**文件**: `apps/server/src/utils/safe_fs.ts`（修改）

**当前**: 所有错误都是 `new Error('[safe_fs] ...')`，调用方无法在 catch 中区分 path traversal 和其他 fs 错误（ENOENT、EACCES 等）。

**改为**: 引入 `SafeFsError` 子类，继承 `AppError`：

```typescript
export class SafeFsError extends AppError {
  readonly fsOperation: string;
  readonly targetPath: string;

  constructor(code: ErrorCode, message: string, fsOperation: string, targetPath: string, options?: { cause?: Error }) {
    super(code, message, { cause: options?.cause, context: { fs_operation: fsOperation, target_path: targetPath } });
    this.name = 'SafeFsError';
    this.fsOperation = fsOperation;
    this.targetPath = targetPath;
  }
}
```

path traversal 检测抛出 `SafeFsError(ErrorCode.PARSE_FAIL, ...)`，文件系统错误（ENOENT、EACCES 等）包装原始 errno 错误并用 `STORAGE_QUERY_FAIL` 码抛出。

---

## Phase 18: Graceful Shutdown 加固

**文件**: `apps/server/src/index.ts` (行 314-337) 和 `apps/server/src/bootstrap/application.ts` (行 57-78)

**问题**:
1. `httpServer.close()` 没有 await — 可能丢弃正在处理的请求
2. 关闭序列中任意一步抛错会跳过后续步骤
3. 没有区分 SIGTERM（短超时）和 SIGINT（长超时）

**改为**:

```typescript
// index.ts — 关闭 handler
application.onShutdown(async (signal) => {
  // 每个步骤独立 try/catch，单步失败不阻断后续
  const errors: Array<{ step: string; error: string }> = [];

  // 1. 停止模拟循环（最先，防止新工作）
  try {
    wiring.multiPackLoopHost.shutdown();
    logger.info('MultiPackLoopHost 已停止');
  } catch (err: unknown) {
    errors.push({ step: 'loop-host', error: getErrorMessage(err) });
  }

  // 2. 停止 HTTP 服务器（await close）
  if (httpServer) {
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => { err ? reject(err) : resolve(); });
      });
      logger.info('HTTP 服务器已关闭');
    } catch (err: unknown) {
      errors.push({ step: 'http-close', error: getErrorMessage(err) });
    }
  }

  // 3-5. Sidecar, Prisma, Watchers（同之前但独立 try/catch）
  // ...

  if (errors.length > 0) {
    logger.warn('Graceful shutdown completed with errors', { data: { errors } });
  } else {
    logger.info('优雅关闭完成');
  }
});
```

---

## Phase 19: config/watcher 可见性

**文件**: `apps/server/src/config/watcher.ts`

**问题**: 配置目录不存在时 `startConfigWatcher()` 返回 `null` 但没有日志。运维无法知道热加载是否在线。

**改为**: 在返回 `null` 之前加一行：

```typescript
if (!configDir) {
  logger.warn('Config watcher disabled: config directory not found', {
    data: { searched_paths: searchPaths }
  });
  return null;
}
```

并在 `startConfigWatcher` 成功启动时加：

```typescript
logger.info(`Config watcher active: ${configDir}`, {
  data: { config_dir: configDir, files: watchedFiles }
});
```

---

## Phase 20: 验证

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
```

### 额外手动验证

1. 启动服务器，触发 AI 网关全部候选失败 → 确认日志输出包含所有候选的失败原因
2. 触发行为树 action handler 失败 → 确认日志输出包含 tree name 和 agent ID
3. 触发插件 worker crash → 确认 terminate/deactivate 错误被记录
4. 发送畸形的 JSON 到需要解析的端点 → 确认 warn 日志出现
5. 触发未处理的 Promise 拒绝 → 确认 `PROCESS_UNHANDLED_REJECTION` 日志出现
6. 触发 rate limit → 确认 429 响应格式与其他 API 错误一致
7. 触发 Prisma 连接失败 → 确认返回 `DATABASE_CONNECTION_FAILED` 码而非泛型 500
8. 配置目录缺失时启动 → 确认出现 "Config watcher disabled" warn 日志

---

## 影响范围

### 文件改动数量估算

| Phase | 新建文件 | 修改文件 | 改动性质 |
|-------|---------|---------|---------|
| P1 Logger 重写 | 0 | 1 (重写) + ~80 (适配调用点) | 破坏性: 接口变更 |
| P2 进程安全网 | 1 | 1 (index.ts) | 加代码 |
| P3 错误类型体系 | 1 | 1 (api_error.ts) | ApiError 加 cause |
| P4 captureError | 1 | 0 | 新建工具 |
| P5 AI 网关 | 0 | 4 | 空 catch → captureError |
| P6 推理 | 0 | 3 | 同上 |
| P7 插件 | 0 | 2 | .catch(()=>{}) → captureError |
| P8 调度器/存储 | 0 | 5 | 空 catch → captureError |
| P9 运行时/上下文 | 0 | 4 | 空 catch → captureError |
| P10 JSON.parse | 1 | ~30 | 替换为 tryParseJson |
| P11 re-throw cause | 0 | 6 | 加 `{ cause: err }` |
| P12 Web 端 | 0 | 3 | 小改动 |
| P13 通知去重 | 0 | 2 | 删代码 |
| P14 Prisma 映射 | 1 | 3 | 新建 + 替换 |
| P15 ESLint | 0 | 1 | 规则配置 |
| P16 Rate limit | 0 | 1 | 小改动 |
| P17 safe_fs | 0 | 1 | 加错误类型 |
| P18 Shutdown | 0 | 2 | 加固 |
| P19 Watcher | 0 | 1 | 加日志 |
| **合计** | **5** | **~150** | |

### 执行顺序

基础设施层（必须串行）:
```
P1 (Logger) → P2 (安全网) → P3 (错误类型) → P4 (captureError)
```

之后分为三条并行轨道:

**轨道 A — 消除静默吞**（可部分并行）:
```
P5 (AI网关) → P6 (推理) → P7 (插件) → P8 (调度器/存储) → P9 (运行时/上下文)
```

**轨道 B — 规范化 & 加固**（独立于轨道 A）:
```
P10 (JSON.parse) ∥ P11 (cause链) ∥ P13 (通知去重)
P14 (Prisma映射) ∥ P17 (safe_fs) ∥ P18 (Shutdown) ∥ P19 (Watcher)
```

**轨道 C — 防护 & 验证**（最后）:
```
P15 (ESLint) → P12 (Web端) → P16 (Rate limit) → P20 (全量验证)
```

### 不纳入本次范围

1. 引入第三方日志库（winston、pino）—— 自定义 logger 够用
2. 分布式追踪（OpenTelemetry）—— 独立议题
3. 日志聚合/导出到外部服务 —— 独立议题
4. 审计日志重构（`operator/audit/logger.ts`）—— 已有 DB 审计跟踪
5. Express 换框架 —— 不在范围
6. **Rust sidecar 日志**（`apps/server/rust/`）—— 需要在三个 sidecar 加 `tracing` crate，范围太大，独立后续计划
7. **Web 端 client-side logger** — CSR-only 前端已有 UI notification 管道，独立议题
8. **完整 `Result<T, E>` 模式迁移** — 本次只加 `tryParseJson` 工具函数作为过渡，完整迁移是独立计划

---

## 不纳入本次范围

1. 引入第三方日志库（winston、pino）—— 自定义 logger 够用，避免依赖膨胀
2. 分布式追踪（OpenTelemetry）—— 独立议题
3. 日志聚合/导出到外部服务 —— 独立议题
4. 审计日志重构（`operator/audit/logger.ts`）—— 数据库审计跟踪已满足需求，不改
5. Express 换框架 —— 不在范围
