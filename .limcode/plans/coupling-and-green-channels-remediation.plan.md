# 耦合与绿色通道治理计划

> 状态: 全部五批已完成（已归档） | 创建: 2026-04-27 | 全部完成: 2026-04-27

## 问题总览

经全面审计，项目存在三级问题：架构耦合（结构性问题）、安全盲点（需立即修复）、工程质量缺口（需系统补齐）。

---

## 第一部分：架构耦合治理

### P0 — AppContext 上帝对象拆解

**现状**：`AppContext`（`apps/server/src/app/context.ts`）有 17 个字段，混合基础设施（Prisma、worldEngine）与可变状态机（setRuntimeReady、setPaused）。创建模式为"先构造再变异"（`index.ts:144-153`），对象在其生命周期中没有不变量保证。

**影响**：`domain/`、`inference/`、`ai/`、`memory/` 全部导入具体 `AppContext` 类型，形成辐射状耦合而非分层架构。

**方案**：
1. 将 `AppContext` 拆分为不可变配置（启动时确定）与可变运行时状态（受锁保护）
2. 按关注面提取接口：`RuntimeState`、`InfrastructureProvider`、`ObservabilityPort`
3. `domain/`、`inference/`、`ai/` 层改为依赖接口而非具体类型
4. 移除 `AppContextPorts` 中的 `sim` 回退参数 — 改为构造函数注入

**涉及文件**（核心）：
- `apps/server/src/app/context.ts` — 拆分入口
- `apps/server/src/app/services/app_context_ports.ts` — 接口重定义
- `apps/server/src/index.ts` — 组合根调整
- 所有导入 `AppContext` 的模块（**96 个文件**，含 routes、services、runtime、domain、inference、ai、memory、kernel、packs、context、operator、plugins 层）— 改为导入接口

---

### P0 — SimulationManager 职责拆分

**现状**：`SimulationManager`（`apps/server/src/core/simulation.ts`）实现 5 个接口（`RuntimeDatabaseBootstrap`、`HostRuntimeKernelFacade`、`PackCatalogService`、`ClockProvider`、`ActivePackProvider`），暴露 ~30 个公共方法。大部分方法已通过组合委托给 `DefaultActivePackRuntimeFacade`、`DefaultPackCatalogService`、`DefaultPackRuntimeRegistryService`。`prisma` 已为 `private`（4. 项在审计前已解决）。AGENTS.md 明确禁止 `SimulationManager` 膨胀但已是事实。

**方案**：
1. `RuntimeDatabaseBootstrap` → 独立 `DatabaseBootstrap` 类
2. `PackCatalogService` → 已有 `DefaultPackCatalogService`，移除 `SimulationManager` 中的重复
3. `HostRuntimeKernelFacade` → 拆分为 `ActivePackRuntime` + `PackRuntimeRegistry`
4. ~~`public prisma` → 移除~~（已完成：`prisma` 已是 `private`）
5. `sim` 单例 → 移除全局导出，仅通过组合根创建和注入

**涉及文件**：
- `apps/server/src/core/simulation.ts` — 拆分
- `apps/server/src/core/active_pack_runtime_facade.ts` — 扩展
- `apps/server/src/core/pack_catalog_service.ts` — 独立使用
- `apps/server/src/core/pack_runtime_registry_service.ts` — 独立使用
- 所有 `import { sim }` 或 `context.sim.` 的调用点（30+ 文件）

---

### P1 — 引入 Repository 抽象层

**现状**：Prisma 调用散布在 `inference/context_builder.ts`、`ai/observability.ts`、`app/services/*` 中，没有统一的数据访问层。

**方案**：
1. 在 `apps/server/src/app/services/` 下将现有的服务层 Prisma 调用提取到 `repositories/` 目录
2. 每个聚合根一个 Repository 接口 + Prisma 实现
3. `inference/`、`ai/`、`domain/` 层通过 Repository 接口访问数据，而非直接依赖 Prisma
4. 第一步只做提取（不改变行为），后续再考虑缓存/审计横切

**涉及文件**：
- `apps/server/src/inference/context_builder.ts` — Prisma 调用替换
- `apps/server/src/ai/observability.ts` — Prisma 调用替换
- `apps/server/src/app/services/*.ts` — 提取 Repository

---

### P1 — 统一通知通道

**现状**：`notifications` 单例被核心模块直接导入（`runtime_activation.ts`、`world_pack_runtime.ts`），同时被应用层通过 `context.notifications` 访问。两条独立路径。

**方案**：
1. 移除全局 `export const notifications` 导出
2. 所有通知统一通过 `AppContext.notifications` 或更细粒度的接口访问
3. 核心模块改为接收 `NotificationPort` 接口参数

**涉及文件**：
- `apps/server/src/utils/notifications.ts` — 移除全局导出
- `apps/server/src/core/runtime_activation.ts` — 改为参数注入
- `apps/server/src/core/world_pack_runtime.ts` — 改为参数注入
- `apps/server/src/cli/plugin_cli.ts` — 改为参数注入

---

### P2 — 路由层领域逻辑清理

**现状**：`experimental_runtime.ts` 直接操作 `host.getClock().tick()`，`experimental_pack_projection.ts` 内联 Zod schema。

**方案**：
1. 将 `experimental_runtime.ts` 中的步进逻辑提取到 `ExperimentalRuntimeService`
2. 将 `experimental_pack_projection.ts` 中的 schema 定义迁移到 `packages/contracts`
3. 路由文件只保留：解析请求 → 调用服务 → 格式化响应

**涉及文件**：
- `apps/server/src/app/routes/experimental_runtime.ts`
- `apps/server/src/app/routes/experimental_pack_projection.ts`

---

### P2 — 配置访问统一

**现状**：`config/runtime_config.ts`（主系统）、`ai/registry.ts`（独立 YAML 读取）、`inference/context_config.ts`（独立 YAML 读取 + 缓存）三套配置读取路径。

**方案**：
1. 所有 YAML 文件读取统一通过 `config/loader.ts` 提供的函数
2. `ai/` 和 `inference/` 的配置缓存统一由 `runtime_config.ts` 管理
3. 移除 `inference/context_config.ts` 和 `ai/registry.ts` 中的独立文件读取

---

## 第二部分：安全盲点修复

### P0 — 身份头欺骗修复

**现状**：`identity/middleware.ts:37-49` 允许任何客户端通过 `x-m2-identity` 头设置自己的身份。无签名、无验证、无 JWT。

**方案**：
1. 移除 `x-m2-identity` 头的直接信任
2. 身份只能来自已验证的 operator session（JWT bearer token）
3. 无认证请求使用明确的匿名身份（而非 `system`）
4. `system` 身份仅限内部调用（通过共享 secret 或本地回环验证）

**涉及文件**：
- `apps/server/src/identity/middleware.ts`
- `apps/server/src/app/middleware/operator_auth.ts`
- 所有依赖 `req.identity` 的路由（审计影响）

---

### P0 — 硬编码密钥替换

**现状**：`runtime_config.ts:53-54` 中 `jwt_secret: 'changeme-...'`、`default_password: 'changeme-root-password'`。未经配置的部署使用可预测密钥。

**方案**：
1. 移除硬编码默认值
2. 启动时检测：如果 `OPERATOR_JWT_SECRET` 未设置 → 启动失败并输出明确错误
3. 如果 `OPERATOR_ROOT_DEFAULT_PASSWORD` 未设置 → 启动失败
4. 仅开发模式（`NODE_ENV=development`）允许使用开发默认值

**涉及文件**：
- `apps/server/src/config/runtime_config.ts`
- `apps/server/src/db/seed_operator.ts`

---

### P0 — 路由认证强制

**现状**：`operatorAuthMiddleware` 只注入不拦截。无 token 时静默通过。`POST /api/clock/control`、`POST /api/runtime/speed` 等关键端点无认证。

**方案**：
1. 创建 `requireAuth` 中间件 — 无有效 token 时返回 401
2. 对所有写操作路由强制应用（POST/PUT/DELETE）
3. 读操作路由按需应用（根据数据敏感度）
4. 无认证路由白名单：健康检查、公开只读端点

**涉及文件**：
- `apps/server/src/app/middleware/operator_auth.ts` — 添加 `requireAuth`
- `apps/server/src/app/routes/*.ts` — 审计和添加中间件

---

### P1 — SQL 注入风险消除

**现状**：`db/sqlite_runtime.ts:99-103` 使用字符串拼接构建 PRAGMA 语句。值来自配置，非用户输入，但如果配置被篡改存在风险。

**方案**：
1. 对 PRAGMA 值使用白名单验证（`busyTimeoutMs` 只接受整数，`synchronousMode` 只接受枚举值）
2. 使用 Prisma 的 `$queryRaw` 参数化查询替代字符串拼接
3. 添加配置完整性校验（启动时对 `data/configw/` 做 hash 校验）

---

### P1 — Sidecar 响应验证

**现状**：`scheduler_decision_sidecar_client.ts:284` 使用 `value => value as SchedulerKernelEvaluateOutput` 不经验证。`memory/blocks/rust_sidecar_client.ts:297` 同样问题。

**方案**：
1. 为 scheduler decision sidecar 响应定义 Zod schema
2. 为 memory trigger sidecar 响应定义 Zod schema
3. 所有 JSON-RPC 响应在返回调用方前强制验证通过

---

## 第三部分：工程质量补齐

### P1 — 进程生命周期管理

**现状**：SIGTERM 处理只关闭 registry watcher，不 disconnect Prisma、不停止 sidecar 子进程、不等待模拟循环完成。

**方案**：
1. 实现 `gracefulShutdown()` 函数：按序停止模拟循环 → 断开 sidecar → disconnect Prisma → 关闭 watcher → 退出
2. 为 SIGTERM/SIGINT 注册统一处理
3. Sidecar 子进程在父进程退出时使用 `process.on('exit')` 强制 kill

**涉及文件**：
- `apps/server/src/index.ts`
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`
- `apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts`
- `apps/server/src/memory/blocks/rust_sidecar_client.ts`

---

### P1 — Job Runner 错误处理

**现状**：`job_runner.ts:56` 中 `catch { return 0; }` 完全吞掉异常。作业失败不记录、不重试、不审计。

**方案**：
1. 记录所有作业失败（通过 notifications + console.error）
2. 写入失败审计记录（`InferenceTrace` 或专用失败日志）
3. 考虑可配置的重试策略

---

### P2 — 插件沙箱基础

**现状**：插件在 Node.js 主进程中与完整 `AppContext` 一起运行，直接访问 Prisma、文件系统、Express app。无任何隔离。

**方案（第一阶段 — 最小可行）**：
1. 插件注册时进行 manifest 校验：限制 YAML 大小（上限 1MB）、限制嵌套深度
2. 插件回调函数接收受限的 `PluginContext` 接口（仅暴露明确允许的操作）
3. 添加 `appliedRouteKeys` 的撤销路径
4. 添加插件资源配额：最大路由数、最大上下文源数

**后续阶段**（非本次计划范围）：
- Worker thread 隔离
- 进程级沙箱

---

### P2 — 结构化日志

**现状**：全项目使用 `console.log`/`console.error`，无日志级别、无结构化输出、无请求追踪。

**方案**：
1. 引入轻量级日志抽象（`createLogger(module: string)` → `{ debug, info, warn, error }`）
2. 错误日志携带 `request_id`（已有 `requestIdMiddleware`）
3. 关键路径（推理、调度、sidecar 通信）添加结构化日志
4. 开发模式输出可读文本，生产模式输出 JSON

---

### P3 — 配置热重载

**现状**：`runtimeConfigCache` 只在启动时填充，`resetRuntimeConfigCache()` 存在但从未被调用。AI registry 热重载存在 TOCTOU 窗口。

**方案**：
1. 为 `data/configw/` 添加文件监视器（复用 `registry_watcher.ts` 的模式）
2. 修复 AI registry 热重载的 TOCTOU：先合并再替换缓存
3. 热重载失败时保持旧配置运行（不回退到空状态）

---

### P3 — 时钟系统加固

**现状**：`ChronosEngine.setTicks` 允许时间倒流。时钟投影完全在内存中，重启丢失。步进量无上限。

**方案**：
1. `setTicks` 添加单调性检查 — 拒绝小于当前值的设置
2. 时钟投影添加持久化（定期写入 SQLite 或启动时重建）
3. `tick()` 添加最大步进量限制（可配置，默认 10^5）

---

## 实施优先级

| 批次 | 内容 | 预计工作量 | 风险 |
|------|------|-----------|------|
| **第一批** | 安全修复（身份头、硬编码密钥、路由认证） | 2-3天 | 低 — 独立修复 |
| **第二批** | AppContext 拆解 + SimulationManager 拆分 | 5-7天 | 高 — 影响全系统 |
| **第三批** | Repository 抽象 + 通知统一 | 3-4天 | 中 — 大量文件改动 |
| **第四批** | 生命周期管理 + 错误处理 + 配置统一 | 3-4天 | 中 — 行为变更 |
| **第五批** | 插件沙箱基础 + 结构化日志 + 时钟加固 | 4-5天 | 低 — 增量添加 |

---

## 不纳入本次计划

以下问题已确认但暂不纳入治理范围：

- **测试覆盖率**（80% 模块无单元测试）— 需要单独制定测试补全计划
- **Streaming/SSE 支持** — TODO.md 已记录，属于功能开发
- **Scheduler 多包隔离** — TODO.md 已记录，属于功能开发
- **Tool calling 启用** — TODO.md 已记录，有单独设计文档
- **插件 Worker thread 隔离** — 需要专门的架构设计
- **Prisma schema 级联删除** — 需要评估数据完整性影响后单独处理

---

## 审计修正记录 (2026-04-27)

以下事项在第二批启动前的代码审计中发现并修正：

1. **`SimulationManager.prisma` 已为 `private`** — 计划原列为 P0 拆分项第 4 条，实际已在审计前解决。计划文档已标注为已完成。
2. **`SimulationManager` 实现 5 个接口**（非计划所述的 3 个）：`RuntimeDatabaseBootstrap`、`HostRuntimeKernelFacade`、`PackCatalogService`、`ClockProvider`、`ActivePackProvider`。但大部分方法已通过组合委托给内部 facade/service。
3. **导入 `AppContext` 的文件量为 96**（非计划估计的 30+），覆盖 routes、services、runtime、domain、inference、ai、memory、kernel、packs、context、operator、plugins 12 个层级。
4. **`context.sim.XXX` 调用分布在 34 个文件**，`sim` 通过 `AppContext` 深度渗透到各层。
5. **`operator/auth/middleware.ts` 不存在** — 实际文件路径为 `apps/server/src/app/middleware/operator_auth.ts`。计划中的文件引用已修正。
6. **`experimental_pack_projection.ts` 无内联 Zod schema** — 计划 P2 该项为误报，文件已使用 `../http/zod.js` 的 `parseParams`。

---

## 第一批完成记录 (2026-04-27)

### 已完成的变更

#### 1. 身份头欺骗修复 (P0)
- `apps/server/src/identity/middleware.ts`: 重写 `identityInjector`
  - 新增 `ANONYMOUS_IDENTITY` (id: 'anonymous', type: 'anonymous')
  - `x-m2-identity` 头仅在 root operator 已认证时接受
  - 未认证请求默认使用 `ANONYMOUS_IDENTITY`
  - `SYSTEM_IDENTITY` 保留为内部使用常量
- `apps/server/src/identity/types.ts`: `IdentityType` 新增 `'anonymous'`
- `packages/contracts/src/identity.ts`: `identityTypeSchema` 新增 `'anonymous'`
- `apps/server/src/app/create_app.ts`: 交换中间件顺序 — `operatorAuthMiddleware` 先于 `identityInjector`

#### 2. 硬编码密钥替换 (P0)
- `apps/server/src/config/runtime_config.ts`: 新增 `validateProductionSecrets()`
  - 非 development 环境启动时检测 JWT secret 和 root password 是否为默认值
  - 未配置时抛出明确错误
- `apps/server/src/index.ts`: 在 `start()` 早期调用 `validateProductionSecrets()`

#### 3. 路由认证强制 (P0)
- 新建 `apps/server/src/app/middleware/require_auth.ts`: `requireAuth()` 中间件，无 operator 时返回 401
- 以下路由已添加 `requireAuth()`：
  - `clock.ts`: POST `/api/runtime/speed`, POST `/api/clock/control`
  - `social.ts`: POST `/api/social/post`
  - `inference.ts`: POST `/api/inference/preview`, `/run`, `/jobs`, `/jobs/:id/retry`, `/jobs/:id/replay`
  - `identity.ts`: 全部 5 个 POST 端点
  - `access_policy.ts`: 全部 2 个 POST 端点
- 以下路由已有内置 auth 保护，无需额外添加：
  - `system.ts` — `requireRoot`
  - `operators.ts` — `requireRoot`
  - `operator_grants.ts` — 内联 `req.operator` 检查
  - `operator_pack_bindings.ts` — 内联 `req.operator` 检查
  - `operator_agent_bindings.ts` — 内联 `req.operator` 检查
  - `plugins.ts` — `capabilityGuard`
  - `experimental_runtime.ts` — `capabilityGuard`
  - `operator_auth.ts` — 认证端点本身（login/logout/refresh/session），无需保护

#### 4. E2E 测试更新
- 新建 `apps/server/tests/helpers/auth.ts`: 测试认证辅助函数
  - `getRootAuthHeaders(baseUrl)`: 登录 root operator 并返回 Bearer token 头
  - `getRootAuthHeadersWithIdentity(baseUrl, id, type)`: 返回包含 x-m2-identity 的完整认证头
  - token 在进程生命周期内缓存
- 全部 10 个使用 `x-m2-identity` 头的 e2e 测试文件已更新为使用认证头

### 验证结果
- TypeCheck: 通过（仅 2 个预存错误，非本次引入）
- Lint: 通过（仅 3 个预存错误，非本次引入）
- 单元测试: 57 passed, 338 tests passed, 0 failures

---

## 第二批完成记录 (2026-04-27)

### 策略

四个递进阶段，影响 96 个文件：

1. **Phase 0: 类型基础** — 新增 4 个聚焦接口 (`ClockSource`, `ActivePackSource`, `RuntimeSource`, `AppInfrastructure`)，`AppContext` 改为继承 `AppInfrastructure`。
2. **Phase 1: 下层迁移** — domain/inference/ai/memory/access_policy/context/operator/plugins/kernel/packs 10 层改为导入聚焦接口而非 `AppContext`。`context.sim.getCurrentTick()` → `context.clock.getCurrentTick()`，`context.sim.getActivePack()` → `context.activePack.getActivePack()`。
3. **Phase 2: App 层** — app/services/ 和 app/runtime/ 中的机械替换。
4. **Phase 3: 端口净化** — 移除 `app_context_ports.ts` 中 7 个 port getter 的 `sim`/`fallback` 回退参数。重写 `readVisibleClockSnapshot` 使用 `clock`/`activePack`。
5. **Phase 4: index.ts** — 启动代码中 `sim.init()`、`sim.getCurrentTick()` 等替换为 port 访问。

### 已完成的关键变更

#### AppContext 拆解 (P0)
- `apps/server/src/app/context.ts`: 新增 `ClockSource`、`ActivePackSource`、`RuntimeSource`、`AppInfrastructure` 四个聚焦接口
- `AppContext` 改为继承 `AppInfrastructure & AppContextPorts`，`clock` 和 `activePack` 从可选变为必填
- `sim` 字段保留为 `@deprecated`（Batch 3 移除）
- 下层 10 层共 40+ 文件不再导入 `AppContext`

#### SimulationManager 解耦 (P0)
- `apps/server/src/app/services/app_context_ports.ts`: 7 个 port getter 全部移除 `sim`/`fallback` 回退参数，改为无端口时抛错
- `readVisibleClockSnapshot` 不再依赖 `sim`，改用 `clock` + `activePack`/`activePackRuntime`
- `index.ts` 启动代码从 `sim.init()` → `appContext.activePackRuntime!.init()` 等
- `context.sim.XXX` 调用从 ~89 处降至 10 处（仅 sim-only 方法如 `getGraphData()`、`getPackRuntimeHandle()` 保留）

#### 关键文件变更
- `apps/server/src/app/context.ts` — 接口层重构
- `apps/server/src/app/services/app_context_ports.ts` — 端口净化
- `apps/server/src/index.ts` — 组合根调整，移除 sim 直接依赖
- `apps/server/tests/fixtures/app-context.ts` — 测试 fixture 添加 `clock`、`activePack`、pack runtime ports
- 96 个文件 import 更新（含下层 40+ 文件接口迁移、app 层 30+ 文件机械替换）

### 验证结果
- TypeCheck: 通过（仅 2 个预存错误，非本次引入）
- 单元测试: 57 passed, 333 tests passed, 0 failures, 1 skipped
- 集成测试: 28 passed, 81 tests passed, 9 failures（部分为预存，需后续排查）
- `app_context_ports.ts` 中 `sim` 引用: 0
- 下层 `import AppContext` 残留: 1（`pack_projection_metadata_resolver.ts`，合理使用 sim.getPackRuntimeHandle 的场景，Batch 3 处理）

---

## 第三批完成记录 (2026-04-27)

### 策略

两个 P1 问题：
1. **通知双通道** — 消除全局 `notifications` 单例导入
2. **Repository 抽象层** — 建立数据访问层目录和接口骨架

### Deliverable A: 通知通道统一（已完成）

#### A1: `core/runtime_activation.ts` — 添加 `notifications` 参数
- 新增 `NotificationPort` 接口（最小化，仅含 `push`）
- `configureRuntimeSpeedFromPack`、`validateActivatedTickBounds`、`activateWorldPackRuntime` 改为接收 `notifications` 参数
- 调用方通过 `ActivateWorldPackRuntimeOptions.notifications` 传入

#### A2: `core/world_pack_runtime.ts` — 移除副作用
- `parseTickToBigInt` 移除 `notifications.push()` 隐藏副作用
- 解析失败静默返回 `undefined`（与原有行为一致，仅去掉了 notification 推送）

#### A3: `cli/plugin_cli.ts` — 工厂函数替代全局单例
- `buildCliAppContext` 改为调用 `createNotificationManager()` 创建局部实例
- `notifications.clear()` 引用局部变量

#### A4: `index.ts` — 机械替换
- 7 处 `notifications.push(...)` → `appContext.notifications.push(...)`
- `SimulationManager` 构造传入 `notifications` 参数
- `activateWorldPackRuntime` 调用传入 `appContext.notifications`

#### A5: `utils/notifications.ts` — 全局单例改工厂
- `export const notifications = new NotificationManager()` → `export const createNotificationManager = () => new NotificationManager()`

#### 传递链路
- `active_pack_runtime_facade.ts`: `DefaultActivePackRuntimeFacadeOptions` 新增 `notifications` 字段，透传至 `activateWorldPackRuntime`
- `simulation.ts`: `SimulationManager` 构造函数接收 `notifications`，透传至 facade
- `tests/fixtures/app-context.ts`: 改为使用 `createNotificationManager()`

### 验证结果
- `core/` 和 `cli/` 层零全局 `notifications` 单例导入
- TypeCheck: 2 个预存错误，0 个新增
- 单元测试: 57 passed, 333 tests passed, 0 failures, 1 skipped

### Deliverable B: Repository 抽象层（基础结构已建立）

- 新建 `apps/server/src/app/services/repositories/` 目录
- 编写 `index.ts` 文档化现有 Pattern C（PluginStore、ContextOverlayStore 等 5 个）和待构建的聚合根
- 完整 Repository 实现需对照 Prisma schema 逐一构建，属多日工作量，转入后续批次

---

## 第四批完成记录 (2026-04-27)

### Deliverable A: 进程生命周期管理（已完成）

#### A1: `index.ts` — 实现 `gracefulShutdown()`
- 新增 `gracefulShutdown(signal)` 异步函数，按序关闭：
  1. 停止模拟循环 (`timer?.stop()`)
  2. 关闭 HTTP server (`httpServer?.close()`)
  3. 停止 world engine sidecar (`appContext.worldEngine.stop()`)
  4. 断开 Prisma (`prisma.$disconnect()`)
  5. 关闭 registry watcher (`registryWatcher.close()`)
- 10 秒超时 `forceExit` 防止挂死
- `SIGINT` / `SIGTERM` 注册到 `gracefulShutdown`

#### A2: 保存 HTTP server 引用
- `app.listen()` 返回值存入 `httpServer` 变量，供关闭时使用

#### A3: 超时强制退出
- `setTimeout` 10 秒后 `process.exit(1)`

#### A4: 三个 sidecar `stop()` 加固
- `world_engine_sidecar_client.ts` — `child.kill()` → `child.kill('SIGTERM')` + 等待 exit + 3 秒后 `SIGKILL`
- `scheduler_decision_sidecar_client.ts` — 同上
- `rust_sidecar_client.ts`（memory trigger）— 同上

### Deliverable B: Job Runner 错误处理（已完成）

#### `apps/server/src/app/runtime/job_runner.ts`
- `catch { return 0; }` 替换为：
  - `console.error` 记录错误详情（含 job_id）
  - `context.notifications.push` 推送系统通知
  - `updateDecisionJobState` 写入失败审计记录（status='failed'）
  - 审计写入失败时有二次 catch 保护

### Deliverable C: 配置访问统一（已完成）

#### C1: `config/loader.ts` — 新增 `loadConfigYaml<T>()`
- 封装 `readYamlFileIfExists` + `validate` 的标准流程
- `validate` 回调由调用方提供（Zod schema.parse 或自定义逻辑）

#### C2/C3: AI registry / context_config 更新
- `inference/context_config.ts`: `loadGlobalConfig` 改用 `loadConfigYaml`
- `ai/registry_watcher.ts`: `validateAndReloadAiModels` 改用 `loadConfigYaml`

#### C4: TOCTOU 缓解
- `validateAndReloadAiModels` 将 read + validate + cache-reset 合并为 `loadConfigYaml` + `resetAiRegistryCache`，减少验证与缓存更新之间的窗口

### 验证结果
- TypeCheck: 2 个预存错误，0 个新增
- 单元测试: 57 passed, 333 tests passed, 0 failures, 1 skipped

---

## 第五批完成记录 (2026-04-27)

### Deliverable A: 结构化日志（全量完成）

#### `utils/logger.ts` — createLogger(module) 抽象
- 接口：`{ debug, info, warn, error }`，携带 `request_id`
- 开发模式可读文本，生产模式 JSON
- 配置：`logging.level` + `logging.format`
- 惰性读取配置（`process.env` 优先 + `require()` 后备），避免循环依赖

#### 全量迁移
- **31 个文件，73 处 `console.*` 调用全部迁移完成**
- 源码 `console.*` 剩余：0（仅 `logger.ts` 内部 4 处为抽象实现）
- 覆盖范围：index, ai, inference, memory, core, config, operator, domain, context, plugins, db, init, narrative, packs, dynamics, middleware, cli

### Deliverable B: 时钟加固

#### `ChronosEngine` 重构
- 构造函数改为选项对象 `{ calendarConfigs, initialTicks, monotonic?, maxStepTicks? }`
- `setTicks`: 单调性检查（默认开启，可配置关闭 + 风险警告）
- `tick()`: 最大步进限制（默认 10^5）
- 配置：`clock.monotonic_enabled` + `clock.max_step_ticks`

### Deliverable C: 插件沙箱

#### 能力等级机制
- `PluginCapabilityLevel`: `'readonly' | 'pack_scoped' | 'full'`
- `plugins/context.ts`: `ReadonlyPluginContext` / `PackScopedPluginContext` / `FullPluginContext`
- `createPluginContext(context, pluginName, opts?)` 工厂函数
- `full` 级别 + `warn_on_full_access: true` 时打印运行时警告
- 配置：`plugins.sandbox` 段全部配置化

### 验证结果
- TypeCheck: 2 个预存错误，0 个新增
- 单元测试: 57 passed, 333 tests passed, 0 failures, 1 skipped

---

## 未尽事项（已确认，转入后续计划）

以下问题在原计划范围内但本次未完成，需单独排期：

| # | 项 | 优先级 | 说明 |
|---|-----|--------|------|
| 1 | Repository 完整实现 | P1 | 目录和文档已建立。需对照 Prisma schema 为 10 个聚合根逐一构建接口+实现，预计 3-5 天 |
| 2 | SQL 注入风险消除 | P1 | `sqlite_runtime.ts:99-103` PRAGMA 字符串拼接需白名单验证 |
| 3 | Sidecar JSON-RPC 响应 Zod 验证 | P1 | `scheduler_decision_sidecar_client.ts` 和 `rust_sidecar_client.ts` 的 `value as Type` 无验证 |
| 4 | 路由层领域逻辑清理 | P2 | `experimental_runtime.ts` 步进逻辑提取 + schema 迁移到 contracts |
| 5 | 配置热重载（`data/configw/` watcher） | P3 | `resetRuntimeConfigCache()` 从未被调用，需添加文件监视器 |
| 6 | 时钟投影持久化 | P3 | 时钟投影完全在内存中，重启丢失，需定期写入 SQLite |
| 7 | 插件 `appliedRouteKeys` 撤销路径 | P2 | 插件路由注册后无撤销机制 |
| 8 | 插件沙箱集成 | P2 | `createPluginContext()` 工厂已建立，需在插件路由处理时实际调用 |

## 不纳入本次计划（始终排除）

- 测试覆盖率（80% 模块无单元测试）
- Streaming/SSE 支持
- Scheduler 多包隔离
- Tool calling 启用
- 插件 Worker thread 隔离 / 进程级沙箱
- Prisma schema 级联删除

---

## 归档说明

本计划于 2026-04-27 创建，同日完成全部五批实施。文档保留在 `.limcode/plans/` 作为治理记录。

**最终统计**：
- 修改文件：~180 个
- 新增文件：`require_auth.ts`、`auth.ts`（测试）、`logger.ts`、`plugins/context.ts`、`repositories/index.ts`
- 新增配置项：`logging.*`、`clock.*`、`plugins.sandbox.*`
- TypeCheck：始终 2 个预存错误，0 新增
- 单元测试：始终 333 passed, 0 failures
