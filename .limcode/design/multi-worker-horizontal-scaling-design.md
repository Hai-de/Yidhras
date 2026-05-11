# 多 Worker 横向扩展设计

> 状态：草案
> 日期：2026-05-11
> 范围：Phase 1 (worker 感知) + Phase 2 (多进程启动) + 世界引擎 sidecar 进程隔离

---

## 1. 背景与目标

### 1.1 当前状态

审计报告 §5.4 指出多包运行时是"单进程多租户"——接口层面有 registry/handle/scope/partition 等分布式词汇，但实际所有 pack loop 跑在同一个 Node.js 事件循环中，世界引擎 sidecar 全 pack 共享一个进程。

代码层面的真实情况比审计描述得更微妙：

- **调度器分区系统已具备多 worker 基础设施**：`scheduler_partitioning.ts` 支持 `SCHEDULER_WORKER_TOTAL`、`SCHEDULER_WORKER_INDEX`、`SCHEDULER_WORKER_PARTITIONS` 三个环境变量做 worker ↔ partition 分配。`resolveOwnedSchedulerPartitionIds()` 实现了显式指定 / 取模轮询 / 全量回退三种策略。
- **分布式协调层已落地**：`scheduler_lease.ts`(256 行) 做 partition-scoped lease 获取，`scheduler_ownership.ts`(438 行) 做 worker ↔ partition 归属追踪和迁移，`scheduler_rebalance.ts`(394 行) 做自动再平衡。这些模块在单进程场景下是过度设计，但在多 worker 场景下是正确的分布式调度基础设施。
- **两个模拟循环共存**：旧版 `simulation_loop.ts`（全局单循环，含感知管线）和 `PackSimulationLoop.ts`（per-pack 循环，不含感知管线）。两者的 world engine 步长、workerId 策略、故障隔离机制都不同。
- **世界引擎 sidecar 共享**：`createWorldEngineSidecarClient` 在 `index.ts:215` 创建一次，所有 pack 的 step 调用共享同一个 Rust 进程。

### 1.2 目标

实现单机多 worker 进程的横向扩展，使：
- 不同 worker 处理不同调度器分区的 agent
- 世界引擎 sidecar 进程隔离（每个 worker 独立 spawn）
- 现有单进程模式（`SCHEDULER_WORKER_TOTAL` 未设置时）行为完全不变 —— 零回归

### 1.3 非目标

- 跨机器分布式部署（Phase 3，不在本次范围）
- PostgreSQL 迁移（SQLite WAL 模式足以支持单机多 worker 并发读）
- 旧版模拟循环重写（保持兼容，见决策 3）

---

## 2. 关键设计决策

### 决策 1：Worker 身份识别方式

**背景**：多 worker 需要区分彼此以分配分区。当前 `index.ts:118-121` 已通过环境变量读取：

```typescript
const schedulerWorkerId = process.env.SCHEDULER_WORKER_ID
  ?? `scheduler:${process.pid}:${Date.now()}`;
const schedulerPartitionIds = resolveOwnedSchedulerPartitionIds({
  workerId: schedulerWorkerId
});
```

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 环境变量 | `SCHEDULER_WORKER_INDEX=0` `SCHEDULER_WORKER_TOTAL=2` | 已实现，零改动，Docker/k8s 友好 | 开发时手动 export 繁琐 |
| B. CLI 参数 | `tsx src/index.ts --worker-index 0 --worker-total 2` | 显式，一行命令启动 | 需要新增参数解析，与现有 env-var 体系重复 |
| **C. 两者都支持** | CLI 参数覆盖环境变量 | 灵活，Docker 用 env var，开发用 CLI | 需处理优先级 |

**推荐 C**。`index.ts` 在顶部解析 `process.argv` 中的 `--worker-index` 和 `--worker-total`，若存在则覆盖环境变量。解析逻辑可以极简（手动解析 `--key=value` 格式，不引入 commander/yargs）。

---

### 决策 2：多 Worker 下的 HTTP 路由

**背景**：多个 worker 进程各自启动 Express HTTP 服务器。外部请求需要路由到正确的 worker（或所有 worker）。

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 不同端口 + nginx | worker-0:3001, worker-1:3002, nginx 前置 | 生产标准，支持负载均衡、健康检查、SSL 终结 | 开发环境需要额外配置 nginx |
| **B. 不同端口，无反向代理** | worker 各自监听不同端口，客户端直接访问 | 零依赖，开发友好 | 不适用于生产，客户端需要知道所有 worker 端口 |
| C. 单一 HTTP worker | 仅 worker-0 启动 HTTP，其他 worker 只跑模拟 | 最简单，无需路由 | HTTP 只能查询 worker-0 负责的分区数据 |
| D. cluster 模块 | Node.js `cluster` 模块，主进程 fork 子进程 | 共享端口，内置负载均衡 | 主进程崩溃影响所有 worker，与 sidecar 进程管理冲突 |

**推荐 B（Phase 2）+ A（后续）**。Phase 2 先以不同端口启动，开发/测试可直接使用。生产环境通过 nginx 或 docker-compose 做端口映射和负载均衡。方案 C 会导致 HTTP API 行为不一致（同一请求在不同 worker 上返回不同结果），不可取。方案 D 的 cluster 模块对 sidecar 子进程的管理有副作用。

具体做法：
- Worker 端口 = `APP_PORT` + `SCHEDULER_WORKER_INDEX`（如 3001, 3002）
- 健康检查 `/api/health` 返回当前 worker 的 partition 归属信息

---

### 决策 3：旧版模拟循环的处理

**背景**：当前两个循环并存 —— 旧版 `simulation_loop.ts`（全局，含 `runPerceptionPipeline`）和 `PackSimulationLoop.ts`（per-pack，不含感知管线）。旧版循环在 `index.ts:485` 的 `startSimulation()` 中启动。

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 统一到 MultiPackLoopHost** | 删除旧版循环，active pack 也通过 MultiPackLoopHost 启动 | 消除重复，单一代码路径，感知管线统一加入 | 改动最大，需要验证 active pack 的启动时机 |
| B. 保持旧版，使其分区感知 | 旧版循环也传 `partitionIds` | 改动最小 | 两套循环长期并存，维护负担 |
| C. 保持旧版不变 | 只有 MultiPackLoopHost 的循环做分区过滤 | 零风险 | 旧版循环仍处理所有分区，多 worker 时旧版路径冲突 |

**推荐 A**。旧版和 per-pack 循环的差异（世界引擎步长、感知管线、故障隔离）已经造成事实上的行为不一致。统一到 `MultiPackLoopHost` + `PackSimulationLoop` 消除这种不一致。涉及变更：
- 将 `runPerceptionPipeline` 加入 `PackSimulationLoop` 的步骤
- Active pack 在 `init()` 完成后也调用 `multiPackLoopHost.startLoop()`
- 删除 `simulation_loop.ts` 的 `startSimulationLoop` 调用
- 保留 `simulation_loop.ts` 文件但标记 deprecated（后续 PR 删除）

---

### 决策 4：世界引擎 sidecar 进程隔离

**背景**：当前所有 pack 共享一个世界引擎 sidecar 进程。若 crash，所有 pack 受影响。用户明确要求 per-worker 隔离。

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. Per-worker sidecar** | 每个 worker 进程 spawn 自己的 world engine | 故障隔离，worker crash 不影响其他 | 内存开销 × worker 数量 |
| B. Per-pack sidecar | 每个 pack 独立 sidecar 进程 | pack 间完全隔离 | 内存开销 × pack 数量，过度隔离 |
| C. 保持共享（当前） | 不做改变 | 简单 | 故障不隔离 |

**推荐 A**。Per-worker 隔离是合理的粒度：一个 worker crash 不影响其他 worker 的模拟。Per-pack 隔离在当前 1-3 pack 规模下不必要，且增加 sidecar 间 pack 数据同步的复杂度。

具体做法：
- 将 `worldEngine` 的创建从 `index.ts` 全局移动到 `PackSimulationLoop`（或 per-worker 初始化）
- 每个 worker 启动时 spawn 自己的 world engine sidecar
- Pack load 时，只向本 worker 的 sidecar 发送 load 请求

---

### 决策 5：Pack 加载策略

**背景**：多 worker 场景下，每个 worker 是否都需要加载所有 pack？还是只加载自己负责的 pack？

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 全量加载** | 每个 worker 加载所有 pack，但只在自己负责的分区上运行 agent | 简单，HTTP API 一致性（任何 worker 都能回答所有 pack 的查询） | 每个 worker 都要做 world engine step（所有 pack 的状态变更） |
| B. Pack 级分片 | 每个 worker 只加载自己负责的 pack，运行时注册表持久化到数据库 | 内存节省 | HTTP 需要路由到正确 worker，实现复杂 |

**推荐 A**。当前 pack 数量少（≤3），全量加载的内存开销可忽略。World engine step 是轻量级操作（规则匹配 + 状态变更），主要瓶颈是 AI 推理调用（步骤 3-5），而步骤 3-5 已经按分区过滤。Pack 级分片在 pack 数量增长到 10+ 时再考虑。

注意：步骤 2（world engine step）每个 worker 都会执行一次，意味着**同一个 pack 的状态变更会在多个 worker 上重复执行**。这是否安全取决于 world engine step 的幂等性。需要在实现中验证——如果 Rust sidecar 的 state mutation 不是幂等的，需要改为只有一个 worker 执行步骤 2。

**这引出了一个重要的实现细节**：步骤 1（expire bindings）和步骤 2（world engine step）是全局操作（对所有 agent 生效），不应按分区过滤。只有步骤 3-5（agent scheduler → decision jobs → action dispatch）按分区过滤。需要引入"全局步骤"和"分区步骤"的区分。

---

### 决策 6：World Engine Step 的幂等性与协调

**背景**：如果多个 worker 都执行步骤 2（world engine step），可能导致状态变更被执行多次。需要协调。

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. World engine lease** | 类似 scheduler lease，只有一个 worker 获取 world engine step lease 后执行步骤 2 | 安全，复用已有 lease 模式 | 增加 lease 竞争延迟 |
| B. World engine step 幂等 | 确保 Rust sidecar 的 step 操作是幂等的（同一 tick 多次调用无副作用） | 无需协调 | 需要修改 Rust sidecar 逻辑 |
| C. 固定 worker 执行 | 指定 worker-0 执行步骤 2，其他 worker 跳过 | 简单 | 单点故障，worker-0 crash 后步骤 2 不执行 |

**推荐 A**。World engine step 使用与 scheduler 相同的 lease 机制，在当前 tick 只有一个 worker 执行步骤 2。步骤 2 完成后，所有 worker 各自执行步骤 3-5（只处理自己分区的 agent）。这与 scheduler 的 partition lease 模式一致，不引入新概念。

---

## 3. 架构设计

### 3.1 目标架构

```
┌──────────────────────────────────────────────────────────┐
│                   单机 / 单容器                            │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Worker 0    │  │  Worker 1    │  │  Worker 2    │   │
│  │  port 3001   │  │  port 3002   │  │  port 3003   │   │
│  │              │  │              │  │              │   │
│  │ partitions:  │  │ partitions:  │  │ partitions:  │   │
│  │   p0, p1     │  │   p2, p3     │  │   p4, p5     │   │
│  │              │  │              │  │              │   │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │   │
│  │ │ World    │ │  │ │ World    │ │  │ │ World    │ │   │
│  │ │ Engine   │ │  │ │ Engine   │ │  │ │ Engine   │ │   │
│  │ │ (Rust)   │ │  │ │ (Rust)   │ │  │ │ (Rust)   │ │   │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │   │
│  │              │  │              │  │              │   │
│  │ Pack A,B,C   │  │ Pack A,B,C   │  │ Pack A,B,C   │   │
│  │ (全量加载)    │  │ (全量加载)    │  │ (全量加载)    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  SQLite (WAL mode) — shared coordination store    │   │
│  │  scheduler_leases, scheduler_ownership,            │   │
│  │  scheduler_cursors, pack runtime state            │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 3.2 每 Tick 执行流程

```
每个 worker 的 PackSimulationLoop.runIteration():

Step 1: expirePackIdentityBindings
         → 全局操作，所有 worker 执行（幂等，按时间戳过期）

Step 2: stepPackWorldEngine
         → 所有 worker 都调用（无协调）
         → Rust sidecar 内部按 (packId, tick) 去重，同一 tick 第二次调用直接返回缓存结果
         → TS 持久化层同样去重：同一 (packId, tick) 的 prepared step 只写入一次
         → Rust sidecar: prepare → commit（或命中缓存，直接返回）

Step 3: runAgentScheduler
         → resolveOwnedSchedulerPartitionIds() 获取本 worker 的分区
         → 只在本 worker 的分区上 acquire lease
         → 只调度属于本 worker 分区的 agent

Step 4: runDecisionJobRunner
         → 处理本 worker 创建的 decision jobs

Step 5: runActionDispatcher
         → 分发本 worker 产生的 action intents

感知管线 (runPerceptionPipeline):
         → 全局操作，所有 worker 执行（无副作用）
```

关键性质：步骤 1 和步骤 2 是**全局步骤**（所有 worker 执行相同操作，依赖幂等性保证安全性），步骤 3-5 是**分区步骤**（每个 worker 只处理自己的分区）。

### 3.3 World Engine Step 幂等性设计

**选择幂等而非 lease 协调的理由**：world engine step 通常在 500ms 内完成，lease 竞争引入的延迟（等待其他 worker 完成 → 轮询 → 再执行）比直接执行更大。且幂等实现后，Rust sidecar 的 (packId, tick) 去重也是正确的长期行为——即使单 worker 场景下意外重试也不会造成双重变更。

**Rust 侧（world_engine_sidecar）**：

```
world_engine 内部维护 HashMap<(PackId, Tick), PreparedStepResult>

step(pack_id, tick):
  if cache hit for (pack_id, tick):
    return cached_result   // 直接返回，不做任何 mutation
  result = prepare()       // 正常执行：规则匹配 → 模板渲染 → mutation 规划
  cache.insert((pack_id, tick), result)
  return result

commit(pack_id, tick):
  // 仅在第一次 commit 时写入
  if already_committed(pack_id, tick):
    return
  persist_mutations()
  mark_committed(pack_id, tick)

// tick 前进时清理旧缓存（保留最近 N 个 tick 即可）
```

**TS 侧（world_engine_persistence.ts）**：

```typescript
// executeWorldEnginePreparedStep 内部
const existingStep = await adapter.findPreparedStep(packId, tick);
if (existingStep) {
  return existingStep;  // 已存在，跳过写入
}
// ... 正常的 prepare → persist → commit 流程
```

**缓存生命周期**：
- Rust sidecar: 保留最近 5 个 tick 的缓存（覆盖 worker 间最大时间偏差）
- TS persistence: 数据库 `prepared_steps` 表本身即去重（`(pack_id, tick)` UNIQUE 约束）

### 3.4 统一后的 PackSimulationLoop

`PackSimulationLoop` 不做分区感知——它仍然是纯 5 步 + 感知管线循环。分区过滤在 `runAgentScheduler` 内部通过 `resolveSchedulerOwnershipSnapshot` 完成。

`PackSimulationLoop` 的变更：
1. 新增步骤：`runPerceptionPipeline`（从旧版循环迁入）
2. World engine step 无需 lease —— 依赖 Rust/TS 双端幂等
3. 构造函数增加 `worldEngine` 参数（per-worker sidecar 实例）

### 3.5 Worker 启动入口

```bash
# 开发环境 — 手动启动 N 个终端
pnpm dev:server --worker-index 0 --worker-total 2
pnpm dev:server --worker-index 1 --worker-total 2

# 或使用启动脚本
./start-dev.sh --workers 2

# Docker / 生产
docker-compose up --scale server=3
```

---

## 4. 实现计划

### Phase 1: Worker 感知 + 循环统一（2-3 天）

**目标**：单进程模式下，使调度器按 worker 分区过滤。删除旧版循环，统一到 MultiPackLoopHost。

**变更文件**：

| 文件 | 变更 |
|------|------|
| `index.ts` | 新增 `--worker-index` / `--worker-total` CLI 参数解析；将 `schedulerPartitionIds` 注入 `AppContext`；active pack 也走 `multiPackLoopHost.startLoop()`；删除旧版 `startSimulation()` 调用 |
| `PackSimulationLoop.ts` | 新增步骤 `runPerceptionPipeline`；world engine step 无需 lease（依赖幂等） |
| `simulation_loop.ts` | 标记 `@deprecated`，保留文件但不被调用 |
| `MultiPackLoopHost.ts` | 新增 `worldEngine` 参数；active pack 的 `startLoop` 由外部调用 |
| `scheduler_partitioning.ts` | 已有的 `resolveOwnedSchedulerPartitionIds` 在 `runAgentScheduler` 内部正确调用 |
| `agent_scheduler.ts` | 在 `runAgentScheduler` 入口处读取 `context.schedulerPartitionIds`（从 AppContext 注入）并传给 `resolveSchedulerOwnershipSnapshot` 的 `bootstrapPartitionIds` |
| `runtime_config.ts` | 新增 `worker.index` / `worker.total` 配置域（从 CLI/env 合并） |
| `world_engine_persistence.ts` | 新增 `(packId, tick)` 去重检查，同一 tick 的 prepared step 只写入一次 |
| Rust `world_engine_sidecar` | 新增 `(packId, tick)` 缓存，同一 tick 第二次调用直接返回缓存结果；commit 去重 |

**验证**：
- `pnpm test:unit` 通过
- `pnpm test:integration` 通过
- 单进程启动（不设 worker env vars）行为与当前完全一致
- 手动设置 `SCHEDULER_WORKER_INDEX=0 SCHEDULER_WORKER_TOTAL=1` 行为不变

### Phase 2: 多进程启动 + Sidecar 隔离（1-2 天）

**目标**：能够启动 N 个 worker 进程，各自拥有独立的 world engine sidecar。

**变更文件**：

| 文件 | 变更 |
|------|------|
| `index.ts` | 世界引擎 sidecar 创建移到 per-worker 初始化（而非全局）；worker 端口 = `APP_PORT + workerIndex` |
| `start-dev.sh` | 新增 `--workers N` 参数，循环启动 N 个 `tsx src/index.ts --worker-index $i --worker-total $N` |
| `package.json` | 新增 `dev:workers` 脚本（多 worker 开发模式） |
| `docs/guides/COMMANDS.md` | 新增多 worker 启动命令文档 |

**验证**：
- `./start-dev.sh --workers 2` 启动两个进程
- `curl http://localhost:3001/api/health` 和 `http://localhost:3002/api/health` 都返回 200
- 健康检查响应包含 worker 的 partition 归属信息
- 两个 worker 各有一个独立的 world engine 进程 (`ps aux | grep world_engine_sidecar` 显示 2 个)
- 日志中两个 worker 各自处理不同的 partition

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| World engine step 幂等实现不完整 | 状态变更被多次应用，数据错乱 | TS 侧 `(pack_id, tick)` UNIQUE 约束兜底；Rust 侧 HashMap 缓存 + commit 去重 |
| Rust sidecar 缓存无限增长 | 内存泄漏 | 仅保留最近 5 个 tick 的缓存，tick 前进时清理旧条目 |
| SQLite 并发写入冲突 | WAL 模式下写操作串行化，高 tick rate 下成为瓶颈 | 当前 tick interval 1s，写入频率低；SQLite WAL 的并发写入对于此规模足够 |
| 旧版循环删除导致功能回归 | 感知管线等逻辑遗漏 | Phase 1 中将 `runPerceptionPipeline` 迁入 `PackSimulationLoop` |
| Worker crash 后分区无人处理 | Agent 停止被调度 | `scheduler_rebalance.ts` 已有的再平衡逻辑 + worker heartbeat 超时检测 |
| Sidecar 进程数量膨胀 | 4 worker × 3 Rust sidecar 类型 = 12 进程 | `SchedulerSidecarPool` 已有的 max 限制；memory_trigger_sidecar 同理需要 pool 化 |
| Worker 间 tick 不同步 | 步骤 2 的 worker A 在 tick=100 执行，worker B 还在 tick=99 | `ChronosEngine` 各 worker 独立推进，但步骤 2 幂等保证同一 tick 多次调用安全。步骤 3-5 的分区 lease 用 `(partition, tick)` 做 key，自然按 tick 隔离 |

---

## 6. 测试策略

- **单元测试**：`resolveOwnedSchedulerPartitionIds` 已有测试；新增 world engine step 幂等性的单元测试（Rust sidecar 的 (packId, tick) 缓存命中/未命中场景）
- **集成测试**：新增多 worker 场景的集成测试（同一 SQLite 上模拟两个 workerId 竞争 partition lease）
- **E2E 测试**：手动启动 2 worker，运行 50 ticks，验证 agent 调度覆盖所有分区、无重复、无遗漏
- **回归测试**：单进程模式（不设 worker env vars）下所有现有测试通过

---

## 7. 已确认的决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | Worker 身份识别 | CLI 参数覆盖环境变量（`--worker-index`, `--worker-total`） |
| 2 | HTTP 路由 | 不同端口（worker-0→3001, worker-1→3002, ...） |
| 3 | 旧版循环 | 统一到 MultiPackLoopHost，删除旧版循环调用 |
| 4 | 世界引擎隔离 | Per-worker sidecar 进程 |
| 5 | Pack 加载 | 全量加载（每个 worker 加载所有 pack） |
| 6 | World engine step 协调 | 幂等性（Rust + TS 双端去重），不使用 lease |
