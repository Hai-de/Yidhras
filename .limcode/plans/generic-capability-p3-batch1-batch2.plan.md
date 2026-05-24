<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/generic-capability-gap-analysis.md","contentHash":"sha256:4b1a89722d3ec7edc31b65862c1b888a97c1dd58d355d429d9e65c7e289f4855"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 实现自动快照最小版配置、服务、loop 接入和 retention  `#p3-auto-snapshot`
- [x] 补齐 /api/health sidecar 响应契约、字段和测试  `#p3-health-sidecar`
- [x] 实现显式插件 reload API 与 CLI 调用路径  `#p3-plugin-reload`
- [x] 补齐 Prometheus metrics 初始化与 inference/action/plugin/sidecar 打点  `#p3-prometheus-metrics`
- [x] 增强 sim:dump CLI，覆盖 runtime/snapshot/plugin/prisma 维度  `#p3-runtime-dump-cli`
- [x] 补充单元/集成测试并运行 typecheck/test  `#p3-tests-validation`
<!-- LIMCODE_TODO_LIST_END -->

# Generic Capability P3 第一批/第二批实施计划

## 来源设计

- 来源缺口文档：`.limcode/design/generic-capability-gap-analysis.md`
- 目标范围：第 318-330 行“未实施（长期 P3）”中的第一批与第二批低/中等复杂度项。
- 本计划基于实际代码审查，不按旧文档状态直接假设。

## 实际代码现状摘要

### 1. 边车健康暴露

实际代码中已经有一版 `/api/health` 边车健康外显：

- `apps/server/src/app/routes/system.ts:76-96`
  - 调用 `context.worldEngine.getHealth()`；
  - 返回 `sidecars.world_engine.alive`；
  - 但 `startupHealthDataSchema.parse(snapshot.body)` 只校验原始 body，没有校验包含 `sidecars` 的最终响应。
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts:232-240`
  - 已有 `getHealth()` RPC。
- `apps/server/src/app/runtime/sidecar/stdio_jsonrpc_transport.ts`
  - 有 heartbeat/restart 机制，但没有公开 transport 级快照 getter。

结论：此项不是从零实现，而是补齐响应契约、细化字段、测试和指标联动。

### 2. 自动快照

手动快照已完整存在：

- API：`apps/server/src/app/routes/pack_snapshots.ts`
  - `GET /api/packs/snapshots`
  - `POST /api/packs/snapshots`
  - `POST /api/packs/snapshots/:snapshotId/restore`
  - `DELETE /api/packs/snapshots/:snapshotId`
- 核心实现：
  - `apps/server/src/packs/snapshots/snapshot_capture.ts`
  - `apps/server/src/packs/snapshots/snapshot_restore.ts`
  - `apps/server/src/packs/snapshots/snapshot_locator.ts`
- CLI 只有 list/show/delete：`apps/server/src/cli/snapshot_cli.ts`。

结论：自动快照应复用 `capturePackSnapshot()`，不要复制快照逻辑。

### 3. 运行时 dump CLI

`sim:dump` 已存在：

- `apps/server/package.json:35`：`"sim:dump": "tsx src/cli/dump_cli.ts"`
- `apps/server/src/cli/dump_cli.ts`
  - 支持 `agent|relation|memory|all`；
  - 直接读 SQLite pack storage；
  - 不包含 pack runtime 状态、clock、snapshot 列表、插件状态、sidecar health、Prisma domain 数据等。

结论：此项是增强现有 CLI，不是新建 CLI。

### 4. Prometheus / metrics

Prometheus 基础已存在：

- 依赖：`prom-client` 已在 `apps/server/package.json`。
- server：`apps/server/src/observability/metrics_server.ts` 已提供 metrics HTTP server。
- registry：`apps/server/src/observability/metrics.ts` 已定义：
  - tick duration / total；
  - inference duration / total；
  - action intent count；
  - plugins active；
  - sidecar health。
- 启动：`apps/server/src/index.ts:467-470` 会按 `runtime.metrics_port` 启动 metrics server。
- 已接入：`apps/server/src/app/runtime/PackSimulationLoop.ts:393/397` 已记录 per-step tick metrics。
- 未接入：代码搜索只发现 `recordTickCompleted` 被调用；`recordInferenceCompleted`、`recordActionIntentDispatched`、`setPluginsActive`、`setSidecarHealth` 未调用。
- `initMetrics()` 存在但未搜索到调用。

结论：metrics 不是未实施，而是“基础存在，初始化和关键打点未补齐”。

### 5. 显式插件 reload

插件 runtime 已有重建入口：

- `apps/server/src/plugins/runtime.ts:480-586`：`syncPackPluginRuntime(context, packId)` 会读取 enabled installations、加载 entrypoint、注册 runtime，并在结尾：
  - `pluginRuntimeRegistry.clearRuntimes(normalizedPackId)`
  - `pluginRuntimeRegistry.setRuntimes(normalizedPackId, runtimes)`
- `clearRuntimes()` 已调用 deactivate（fire-and-forget）。
- CLI `apps/server/src/cli/plugin_cli.ts` 只有 list/confirm/enable/disable，没有 reload。
- 当前 `AppContext` 没有直接暴露 plugin reload port。

结论：优先做“显式 reload API/CLI”，不做文件监听 HMR，不承诺清理 Node ESM module cache。

## 范围边界

本计划包含：

1. `/api/health` sidecar 字段正规化与测试；
2. 自动快照最小版；
3. `sim:dump` 增强为 runtime dump；
4. Prometheus 初始化与关键打点补齐；
5. 显式插件 reload API/CLI。

本计划不包含：

- Worker 线程插件隔离；
- 完整 HMR / 文件监听自动热重载；
- 完整日志传输层；
- 数据迁移框架；
- 全模拟强确定性。

## 设计原则

1. 复用已有实现，不复制核心逻辑。
2. 默认关闭可能产生 IO 成本的自动功能。
3. API 响应必须有 contracts schema 覆盖。
4. Prometheus labels 限制低基数，避免 `agent_id`、`job_id` 级别 label。
5. 插件 reload 只保证 runtime registry 重建，不承诺 ESM module cache 清理。
6. 所有新增功能必须可单元测试或集成测试覆盖。

---

# Phase 1：边车健康暴露补齐

## 目标

把已有 `/api/health` 的 `sidecars.world_engine` 从 `{ alive: boolean }` 升级为稳定契约，包含可诊断字段。

## 实施点

### 1.1 扩展 contracts

文件：`packages/contracts/src/system.ts`

新增 schema：

```ts
const sidecarHealthStatusSchema = z.object({
  alive: z.boolean(),
  engine_status: z.string().optional(),
  protocol_version: z.string().optional(),
  error: z.string().optional()
})
```

并把 `startupHealthDataSchema` 扩展为可选：

```ts
sidecars: z.record(z.string(), sidecarHealthStatusSchema).optional()
```

注意：当前 route 只 parse `snapshot.body`，需要改为 parse 最终 `body`。

### 1.2 调整 `/api/health`

文件：`apps/server/src/app/routes/system.ts`

当前逻辑：

```ts
const body = { ...snapshot.body, ...(sidecars ? { sidecars } : {}) };
startupHealthDataSchema.parse(snapshot.body);
```

改为校验最终 body：

```ts
startupHealthDataSchema.parse(body);
```

`world_engine` 字段建议返回：

```ts
world_engine: {
  alive: weHealth.engine_status === 'ready' || weHealth.engine_status === 'degraded',
  engine_status: weHealth.engine_status,
  protocol_version: weHealth.protocol_version
}
```

如果异常：

```ts
world_engine: {
  alive: false,
  error: getErrorMessage(err)
}
```

### 1.3 指标联动

在 `/api/health` 成功/失败路径调用：

```ts
setSidecarHealth('world_engine', alive)
```

不要在每次 metrics scrape 时主动 RPC sidecar，避免 `/metrics` 变成 sidecar 健康探测器。

## 测试

新增或扩展 system route 测试：

- worldEngine.getHealth() 成功时返回 `sidecars.world_engine.alive=true`；
- worldEngine.getHealth() 抛错时返回 `alive=false` 且不导致 `/api/health` 500；
- schema 校验覆盖最终 body。

---

# Phase 2：自动快照最小版

## 目标

在每个 pack loop 中按 tick 间隔自动创建快照，默认关闭，失败不影响模拟。

## 配置设计

文件：`apps/server/src/config/domains/runtime.ts`

新增：

```ts
snapshot: z.object({
  auto_enabled: z.boolean().default(false),
  interval_ticks: z.number().int().positive().default(1000),
  retention_count: z.number().int().positive().max(100).default(20)
}).strict()
```

默认：

```ts
snapshot: {
  auto_enabled: false,
  interval_ticks: 1000,
  retention_count: 20
}
```

环境变量可选：

- `RUNTIME_SNAPSHOT_AUTO_ENABLED`
- `RUNTIME_SNAPSHOT_INTERVAL_TICKS`
- `RUNTIME_SNAPSHOT_RETENTION_COUNT`

如果不想扩大环境变量面，也可以第一版只支持 YAML 配置；实施时二选一即可，不要两套半成品。

## 服务封装

新增文件建议：

- `apps/server/src/packs/snapshots/auto_snapshot_service.ts`

职责：

```ts
interface AutoSnapshotServiceInput {
  context: AppContext
  packId: string
  packRuntime: PackRuntimePort
}

maybeCaptureAutoSnapshot(input): Promise<void>
```

逻辑：

1. 读取 `getRuntimeConfig().runtime.snapshot`；
2. 如果未启用直接返回；
3. 如果当前 tick 不是 `interval_ticks` 的倍数，返回；
4. 如果当前 pack storage backend 不是 sqlite，记录 warn 后返回；
5. 调用 `capturePackSnapshot()`；
6. label 使用固定前缀：`auto:<tick>`；
7. 捕获成功后执行 retention 清理；
8. 捕获失败只记录 logger.warn，不抛出。

## 接入点

文件：`apps/server/src/app/runtime/PackSimulationLoop.ts`

推荐位置：`runPackSimulationIteration()` 中所有 step 和 data cleaner 完成后、返回前。

原因：

- 此时 tick 内所有运行时变化已完成；
- 不会截取半个 step 的状态；
- 失败不应记为 step error。

伪代码：

```ts
await maybeCaptureAutoSnapshot({
  context: input.context,
  packId: input.packId,
  packRuntime: input.packRuntime
})
```

## retention

复用：

- `listSnapshotDirs()`
- `readSnapshotMetadata()`
- `deleteSnapshotDir()`

只删除 label 以 `auto:` 开头的快照，避免删除手动快照。

## 并发与阻塞

第一版接受快照同步阻塞 loop，因为 `capturePackSnapshot()` 当前就是同步文件读写 + Prisma 查询。必须在文档和日志中明确：自动快照默认关闭，间隔不应过小。

不要第一版引入后台队列，否则范围扩大。

## 测试

- 配置关闭时不调用 capture；
- tick 未达间隔不调用 capture；
- tick 达间隔时调用 capture；
- capture 抛错不会让 loop step failed；
- retention 只删除 `auto:` 快照，不删手动快照。

---

# Phase 3：runtime dump CLI 增强

## 目标

增强现有 `sim:dump`，输出更接近“运行时状态 dump”的 JSON，而不是只读 SQLite 三类数据。

## 当前 CLI

文件：`apps/server/src/cli/dump_cli.ts`

当前类型：

```ts
agent | relation | memory | all
```

## 增强设计

新增类型：

```ts
runtime | snapshot | plugin | prisma | all
```

建议最终类型：

```ts
world       // 原 agent/relation/memory 的集合，或兼容旧 all
agent
relation
memory
runtime
snapshot
plugin
prisma
all
```

为兼容当前用户，保留旧类型行为。

## 输出内容

### runtime

离线 CLI 拿不到进程内 `PackRuntimeHandle`，所以第一版只输出持久化可读信息：

- pack_id；
- runtime.sqlite 路径和大小；
- storage-plan 是否存在；
- world entity count；
- entity state count；
- rule execution record count；
- 最新 `__world__/clock` 或 meta state（如果存在）。

不要假装能 dump live in-memory 状态。

### snapshot

复用：

- `listSnapshotDirs()`
- `readSnapshotMetadata()`

输出最近 N 个快照摘要。

### plugin

用 Prisma 读 `PluginInstallation`，按 pack scope/global 输出：

- installation_id；
- plugin_id；
- version；
- lifecycle_state；
- scope；
- last_error。

### prisma

输出 pack-scoped domain 记录计数即可，不第一版输出完整 records：

- Agent count；
- Identity count；
- IdentityNodeBinding count；
- Post count；
- Relationship count；
- MemoryBlock count；
- ContextOverlayEntry count；
- MemoryCompactionState count；
- ScenarioEntityState count。

## CLI 参数

新增：

```bash
pnpm --filter yidhras-server sim:dump <packId> --type runtime
pnpm --filter yidhras-server sim:dump <packId> --type all --out dump.json
pnpm --filter yidhras-server sim:dump <packId> --type snapshot --limit 20
```

新增 `--out` 可选；默认仍 stdout。

## 测试

- parseArgs 单元测试；
- invalid type 报错；
- snapshot type 在无快照时返回空数组；
- plugin/prisma type 在空 DB 下返回空/0，而不是抛错。

---

# Phase 4：Prometheus metrics 补齐

## 目标

让已有 metrics infra 真正覆盖关键路径。

## 4.1 初始化 metrics

文件：`apps/server/src/index.ts`

在启动阶段调用：

```ts
import { initMetrics } from './observability/metrics.js'

initMetrics()
```

注意 `prom-client` 全局 registry 重复注册风险。`initMetrics()` 应保证幂等，避免测试或重复 import 导致 default metrics 重复注册。

建议改 `metrics.ts`：

```ts
let metricsInitialized = false
export const initMetrics = () => {
  if (metricsInitialized) return
  collectDefaultMetrics(...)
  metricsInitialized = true
}
```

## 4.2 tick metrics

已存在：

- `PackSimulationLoop.ts:393/397`

保留。必要时将 histogram 单位从 `_ms` 改为 Prometheus 推荐 `_seconds` 需要兼容性权衡。当前已有名称未对外稳定，可以改，但要同步测试。

建议保守：保留现有 `_ms`，避免额外破坏。

## 4.3 inference metrics

文件：`apps/server/src/inference/service.ts`

接入点：`executeRunInternal()` 中 provider.run 周围。

当前 provider 调用在 `service.ts:305-311`。

实现：

```ts
const providerStartedAt = Date.now()
try {
  rawDecision = await provider.run(...)
  recordInferenceCompleted(packId, provider.name, taskType, Date.now() - providerStartedAt, 'success')
} catch (err) {
  recordInferenceCompleted(packId, provider.name, taskType, Date.now() - providerStartedAt, 'failed')
  throw err
}
```

pack_id 来源：`inferenceContext.world_pack.instance_id`。

taskType 当前多处固定 `agent_decision`，第一版可使用 `input.task_type ?? 'agent_decision'`，实际类型不存在时固定 `agent_decision`。

## 4.4 action dispatch metrics

实际搜索未找到 `recordActionIntentDispatched` 调用。

需要先定位 dispatch 实现文件。代码中 `runActionDispatcher()` 在：

- `apps/server/src/app/runtime/action_dispatcher_runner.ts`

计划实施时读取 `action_dispatcher_runner.ts` 和实际 dispatch 函数，接入：

- completed；
- dropped；
- failed。

label：

- `pack_id`；
- `intent_type`；
- `outcome`。

不要加入 `agent_id`、`intent_id`。

## 4.5 plugin active metrics

文件：`apps/server/src/plugins/runtime.ts`

在 `syncPackPluginRuntime()` 结尾：

```ts
setPluginsActive(normalizedPackId, runtimes.length)
```

注意这里只统计成功构建 runtime 的数量。当前代码在 `registerManifestContributions(runtime); runtimes.push(runtime);` 后即 push，即使 activate entrypoint 失败，runtime 仍在数组中。是否算 active 需要明确。

建议第一版定义为“registered runtime count”，但指标名 `plugins_active` 容易误导。两种选择：

1. 保留现有 metric 名称，按当前 runtime count；
2. 新增 `yidhras_plugins_registered`，避免 active 语义不准确。

推荐选择 2，或者把 activate 失败 runtime 排除出 active 计数。实施前需要决定。

## 4.6 sidecar health metrics

在 `/api/health` route 更新 `setSidecarHealth()`。

后续也可以在 `WorldEngineSidecarClient` unhealthy/restarted 事件更新，但第一版先在 health probe 路径更新即可。

## 测试

- metrics registry 能输出 default metrics；
- `/metrics` 返回 text/plain prometheus 格式；
- runPackSimulationIteration 后 tick counter 增长；
- inference success/failure 后 counter 增长；
- sidecar health probe 更新 gauge。

---

# Phase 5：显式插件 reload API/CLI

## 目标

提供受控的手动 reload，不做文件监听 HMR。

## 语义定义

`reload` 的定义：

1. 对指定 pack 调用 `syncPackPluginRuntime(context, packId)`；
2. 旧 runtime 通过 `pluginRuntimeRegistry.clearRuntimes(packId)` deactivate；
3. 根据 DB 当前 enabled installations 重新构建 runtime registry；
4. 返回 reload 结果摘要。

不保证：

- 清理 Node ESM module cache；
- 重新编译插件；
- 自动监听文件变更；
- 回滚到旧 runtime。

## API 设计

新增 route 建议放在：

- `apps/server/src/app/routes/plugins.js/ts` 或新增 `plugin_runtime_admin.ts`

Endpoint：

```http
POST /api/plugins/reload
Content-Type: application/json
Authorization: Bearer <root>

{
  "pack_id": "snowbound_mansion"
}
```

权限：root operator。

响应：

```json
{
  "reloaded": true,
  "pack_id": "snowbound_mansion",
  "runtime_count": 3
}
```

如果不容易拿 runtime_count，可先返回 installation enabled count，但不要标错为 runtime_count。

## AppContext port

当前 `syncPackPluginRuntime(context, packId)` 可直接在 route 调用，但为了测试和解耦，可以在 `AppContext` 增加：

```ts
pluginRuntimeControl?: {
  reload(packId: string): Promise<{ pack_id: string; runtime_count?: number }>
}
```

`index.ts` 初始化：

```ts
appContext.pluginRuntimeControl = {
  reload: async packId => {
    await syncPackPluginRuntime(appContext, packId)
    return { pack_id: packId }
  }
}
```

## CLI 设计

增强 `apps/server/src/cli/plugin_cli.ts`：

```bash
pnpm --filter yidhras-server plugin reload --pack <pack-id>
```

这里有两种实现路线：

### 路线 A：CLI 直接 DB/runtime 本地重建

不可行或意义有限，因为 CLI 是独立进程，调用 `syncPackPluginRuntime()` 只会重建 CLI 进程内 registry，不能影响正在运行的 server。

### 路线 B：CLI 调用 server admin API

推荐。需要参数：

```bash
--server http://localhost:3001
--token <operator-token>
```

或者从环境变量读取：

- `YIDHRAS_SERVER_URL`
- `YIDHRAS_OPERATOR_TOKEN`

第一版 CLI 可以只打印说明，或者实现 HTTP 调用。若实现 HTTP 调用，需要确认 Node 运行时 fetch 可用（Node 18+ 标准 fetch 可用；当前项目 TS target 需验证）。

## 测试

- route 无 root 权限返回 403；
- route 调用 reload port；
- reload 失败返回标准 ApiError；
- CLI 参数解析覆盖 reload；
- CLI 不提供 token/server 时给出明确错误。

---

# 风险与取舍

## 自动快照阻塞 loop

`capturePackSnapshot()` 当前包含同步文件读写和 Prisma 查询。自动快照会增加 tick 延迟。通过默认关闭、较大 interval、失败不抛出控制风险。

## `/api/health` 主动 RPC sidecar

当前 `/api/health` 每次请求都会调用 `worldEngine.getHealth()`。如果 sidecar 卡住，可能拖慢 health endpoint。现有 `WorldEngineSidecarClient` 有 timeout。第一版保留现状，只补齐契约和错误字段。

## plugin reload 不等于 HMR

由于 Node ESM `import()` cache，reload 不保证重新加载同一路径的新代码。它只保证 DB 安装状态和 runtime registry 重新同步。如果要真正 reload 新代码，需要插件构建产物使用 cache-busting URL/path 或 Worker 隔离；这不在本计划内。

## metrics label 基数

不能把 agent_id/job_id/intent_id 放入 Prometheus label。需要在 review 时检查。

---

# 验收标准

1. `/api/health` 返回 contract 覆盖的 `sidecars.world_engine`，sidecar 失败不会导致 health endpoint 500。
2. 自动快照默认关闭；开启后按 tick 间隔创建 `auto:<tick>` 快照；失败不影响 sim loop。
3. `sim:dump` 保持旧用法可用，并新增 runtime/snapshot/plugin/prisma 维度。
4. `/metrics` 能输出 default metrics 和至少 tick/inference/sidecar/plugin/action 中已接入的指标。
5. 插件 reload API 可由 root 调用，并触发 `syncPackPluginRuntime()`；CLI reload 不误导用户，以 HTTP 调用正在运行的 server 或明确报错。
6. 新增/修改功能有对应单元或集成测试。
7. `pnpm --filter yidhras-server typecheck` 和相关测试通过。
