# Scheduler Docker 式容器隔离设计

> 目标：每个 world pack 拥有物理上完全独立的调度器运行时，类比 Docker/Podman 容器模型 — 每个"容器"内跑自己完整的 scheduler。

## 1. 现状分析

### 1.1 当前架构

```
simulation_loop.ts (全局单循环)
  └─ agent_scheduler.ts (全局单调度器)
       ├─ scheduler_lease.ts (lease/cursor 共享表)
       ├─ scheduler_ownership.ts (ownership 共享表)
       ├─ scheduler_partitioning.ts (partition 分配全局)
       └─ scheduler_decision_kernel_provider.ts (单 decision kernel)
```

- 所有 scheduler 数据（lease、cursor、ownership）存在主 Prisma DB，无 pack 维度隔离。
- `runtime_kernel_service.ts` 是全局单例，绑定唯一的 active pack。
- `experimental_scheduler_runtime.ts` 仅在 partition_id 字符串层面加 `packId::` 前缀，底层读同一份数据。
- simulation loop 只 tick active pack，实验性 pack 只能通过 API 手动 step。

### 1.2 关键文件

| 文件 | 角色 |
|------|------|
| `app/runtime/agent_scheduler.ts` | 调度主循环 |
| `app/runtime/scheduler_lease.ts` | lease 获取/释放/续约 |
| `app/runtime/scheduler_ownership.ts` | partition 所有权分配 |
| `app/runtime/scheduler_partitioning.ts` | partition 分片逻辑 |
| `app/runtime/scheduler_decision_kernel_provider.ts` | 决策内核提供者 |
| `app/runtime/runtime_kernel_service.ts` | 运行时内核外观（单例） |
| `app/runtime/simulation_loop.ts` | 全局模拟循环 |
| `app/services/experimental_scheduler_runtime.ts` | 多包 scheduler projection |

### 1.3 当前 pack scoping 机制

`multi_pack_scheduler_scope.ts` 提供的 `buildPackScopedPartitionId(packId, partitionId)` 输出 `"packId::partitionId"`，在 lease/cursor key 层面做了隔离。但底层 ownership assignments、workers、summary 等数据来自全局 kernel，不受 pack 影响。

**问题：** scoping 是键名前缀，不是数据隔离。两个 pack 的 scheduler 数据仍在同一张表、同一个 kernel 里混在一起。

---

## 2. 目标架构

### 2.1 容器模型

```
┌─────────────────────────────────────────────┐
│              Runtime Host                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Pack A   │  │ Pack B   │  │ Pack C   │  │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │
│  │ │Sched │ │  │ │Sched │ │  │ │Sched │ │  │
│  │ │Loop  │ │  │ │Loop  │ │  │ │Loop  │ │  │
│  │ │Worker │ │  │ │Worker │ │  │ │Worker │ │  │
│  │ │Part. │ │  │ │Part. │ │  │ │Part. │ │  │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │
│  │  Own DB  │  │  Own DB  │  │  Own DB  │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────┘
```

每个 pack = 一个独立"容器"，内部包含：
- 独立的 scheduler 循环
- 独立的 worker 池
- 独立的 partition 分配
- 独立的 lease / cursor / ownership 存储（在 pack runtime SQLite 中）

### 2.2 核心原则

1. **物理隔离：** scheduler 数据存入 pack 自己的 runtime SQLite，不共享主 DB 表。
2. **独立生命周期：** pack load → scheduler 初始化；pack unload → scheduler 完全拆除。
3. **独立配置：** 每个 pack 可配置自己的 partition 数量、worker 数量。
4. **Host 层仅做多路复用：** Host 只负责启动/停止各 pack 的 scheduler loop，不共享任何调度状态。

---

## 3. 分阶段实施

### Phase 1: 数据层隔离（存储迁移）

将 scheduler lease / cursor / ownership 从主 Prisma DB 迁移到各 pack 的 runtime SQLite。

**变更：**

- `scheduler_lease.ts` — lease/cursor 读写改为通过 `PackStorageAdapter` 走 pack runtime DB
- `scheduler_ownership.ts` — ownership assignments 存入 pack runtime DB
- `scheduler_lease_repository.ts` / `scheduler_ownership_repository.ts` — repository 接口增加 pack scope 参数，实现改为 per-pack SQLite
- 主 Prisma schema 标记旧 scheduler 表为 deprecated，后续迁移完成后删除

**兼容：** active pack（单包模式）不受影响，其 scheduler 数据迁移到它自己的 runtime SQLite。

### Phase 2: 内核实例化（per-pack kernel）

将 `runtime_kernel_service.ts` 从全局单例改为 per-pack 工厂。

**变更：**

- `createRuntimeKernelService(context, packId)` — 接受 packId，内部所有操作绑定到该 pack
- `scheduler_decision_kernel_provider.ts` — 每个 pack 独立实例
- `experimental_scheduler_runtime.ts` — 不再需要字符串前缀 hack，直接读对应 pack 的 kernel

### Phase 3: 调度循环多路复用（per-pack loop）

`simulation_loop.ts` 改为管理多个 per-pack loop。

**变更：**

- `simulation_loop.ts` → `PackSchedulerLoop` 类，每个 pack 一个实例
- Host 层 `MultiPackSchedulerHost` 管理所有 loop 的启停
- 每个 loop 独立的 interval、pause/resume 状态
- `runtime_clock_projection.ts` 按 pack 隔离

### Phase 4: 移除全局 active pack 依赖

清理所有假定单一 activePack 的代码路径。

**变更范围：**
- Routes 改为从 pack scope 解析目标 pack
- Services 不再隐式依赖 "当前活跃包"
- `AppContext` 移除 `activePack`、`clock` 等单例字段，改为 `packScope: PackScopeResolver`

---

## 4. 风险与约束

| 风险 | 缓解 |
|------|------|
| 迁移期间单包模式可用性 | Phase 1 保持 schema 兼容，active pack 先迁移 |
| scheduler 表 schema 变更 | 通过 Prisma migration，保留旧表直至验证完成 |
| 多 loop 并发资源竞争 | per-pack loop 完全独立，共享的只有 Host 层启停信令 |
| worker 数量膨胀 | `max_loaded_packs` × `SCHEDULER_PARTITION_COUNT` 需配置上限 |

---

## 5. 不在此设计范围内的内容

- 跨 pack scheduler 通信 / 事件广播
- 多 pack 共享 worker 池
- Pack 间 partition 迁移 / 负载均衡
