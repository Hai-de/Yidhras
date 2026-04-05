## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 增加开发环境的数据收敛策略：启动清理或保留上限，避免 scheduler/trace 表持续膨胀  `#dev-retention-reset-switch`
- [x] 补充 README/开发文档，说明开发库重置、SQLite pragma、串行 simulation loop 与调试开关  `#docs-readme-runtime-stability`
- [x] 新增更强的 e2e，通过人为注入长耗时 step 证明 simulation loop 不会重入  `#e2e-loop-overlap-proof`
- [x] 修正误导性的 BigInt 报错文案，并补充锁竞争/超时诊断信息  `#error-message-observability`
- [x] 补充验证脚本或 e2e，确认无重入、SQLite pragma 生效、冷启动后不会复现超时  `#regression-verification`
- [x] 新增开发环境数据库重置方案：停止服务后清空/重建 SQLite 文件，并提供一键脚本  `#reset-dev-db`
- [x] 将 simulation loop 从 setInterval(async) 改为严格串行执行，彻底消除步进重入  `#serialize-simulation-loop`
- [x] 在 Prisma/SQLite 初始化阶段应用 WAL、busy_timeout 等运行时 pragma  `#sqlite-runtime-pragmas`
<!-- LIMCODE_TODO_LIST_END -->

# 开发环境调度超时根除计划

## 1. 背景

当前 `schedulerLease.upsert()` 报错表面发生在租约抢占阶段，但根因并不在 BigInt 计算，而在以下组合问题：

1. `simulation_loop.ts` 使用 `setInterval(async () => ...)`，存在上一轮未结束、下一轮又启动的重入风险。
2. 当前 SQLite 运行时处于 `journal_mode=delete`、`busy_timeout=0`，对持续写入场景非常脆弱。
3. `SchedulerRun`、`SchedulerCandidateDecision`、`InferenceTrace` 等表在开发库中长期累积，导致写压和锁竞争越来越明显。
4. 上层错误文案统一提示“可能存在 BigInt 异常”，掩盖了真实的数据库锁/超时原因。

由于当前是开发环境，历史数据不重要，因此方案目标不是“尽量保留现状”，而是**通过破坏式重置 + 运行时改造彻底消灭该类问题的复现条件**。

---

## 2. 目标

### 核心目标

- 根除 runtime loop 重入导致的并发写入。
- 让 SQLite 在开发环境下具备可接受的锁等待与并发读写表现。
- 避免开发库无限膨胀，降低后续再次触发锁竞争的概率。
- 让报错信息能直接反映“SQLite/Prisma 超时/锁竞争”，而不是误报 BigInt。

### 非目标

- 本次不做生产级数据库迁移。
- 本次不追求保留现有开发数据。
- 本次不重做 scheduler 业务语义，只聚焦运行稳定性与可诊断性。

---

## 3. 总体策略

分四层处理：

1. **先清场**：重置开发数据库，去掉历史膨胀和坏状态。
2. **再堵源头**：把 simulation loop 改为严格串行，彻底消灭重入。
3. **再增强底座**：为 SQLite 启动 WAL / busy_timeout 等 pragma，降低锁冲突敏感度。
4. **最后做兜底**：增加开发环境清理策略、改善报错与回归验证，防止问题再次潜伏。

---

## 4. 实施阶段

## 阶段 A：开发数据库破坏式重置

### 目标

把现有 1.5G 级别的开发库直接清空重建，消除历史积累造成的干扰。

### 实施内容

1. 停掉 `apps/server` 开发进程。
2. 删除开发数据库文件及 sidecar 文件：
   - `data/yidhras.sqlite`
   - `data/yidhras.sqlite-wal`
   - `data/yidhras.sqlite-shm`
3. 执行现有准备流程重建库：
   - `pnpm --filter yidhras-server exec prisma migrate deploy`
   - `pnpm --filter yidhras-server run init:runtime`
   - `pnpm --filter yidhras-server run seed:identity`
4. 补一个一键脚本，例如：
   - `reset:dev-db`
   - 或 `rebuild:dev-runtime`

### 产出

- 一套可重复执行的“开发环境重建数据库”命令。
- 后续任何运行时异常，都可以先基于干净库复现，而不是被历史状态污染。

### 验收标准

- 数据库重建后体积显著缩小。
- 服务可正常启动并完成 runtime 初始化。

---

## 阶段 B：彻底消除 simulation loop 重入

### 目标

将 runtime 从“定时触发 async 任务”改为“上一轮结束后再决定下一轮何时开始”的模式。

### 现状问题

当前实现使用 `setInterval(async () => { ... })`。如果单轮执行超过 interval，下一轮会在上一轮未结束时并发进入，直接制造 SQLite 写锁竞争。

### 改造方案

将 `startSimulationLoop` 改为**严格串行循环**，可选实现：

1. `setTimeout` 递归调度；或
2. 单独的 `async runLoop()` + `finally` 中安排下一轮；或
3. 保留 timer 句柄，但增加 `inFlight` guard，发现未完成则直接跳过并记录告警。

推荐方案：

- 使用串行调度作为主逻辑；
- `inFlight` 作为保护和诊断补丁；
- 记录每轮开始、结束、耗时、是否跳过。

### 需要保证的行为

- pause/resume 语义不变；
- 出错后仍能暂停 runtime；
- 重新启动 loop 时不会残留旧 timer；
- 不会因为异常导致调度链永久失活。

### 验收标准

- 任意时刻最多只有一轮 simulation step 在执行；
- 无法再构造出“上一轮未结束，下一轮已进入 `runAgentScheduler`”的情况；
- 即使人为注入延迟，也不会出现重叠调用。

---

## 阶段 C：SQLite 运行时配置加固

### 目标

让开发环境 SQLite 更适合持续写入的 runtime 服务。

### 建议配置

在 PrismaClient 初始化后立即执行 pragma：

- `PRAGMA journal_mode = WAL;`
- `PRAGMA busy_timeout = 5000;`（或 10000）
- `PRAGMA synchronous = NORMAL;`（开发环境可接受）
- `PRAGMA foreign_keys = ON;`

如果需要更激进的开发优化，可额外评估：

- `PRAGMA temp_store = MEMORY;`
- `PRAGMA wal_autocheckpoint = <更合适阈值>`

### 放置位置

优先放在 `SimulationManager` / Prisma 初始化集中位置，确保：

- server 正常启动路径一定执行；
- e2e/脚本如果复用同一初始化入口也能受益；
- 日志可打印实际生效的 pragma 值。

### 验收标准

- 启动后查询 pragma 显示为预期值；
- 同等负载下锁竞争明显减少；
- 再次出现数据库超时时，等待行为和日志能更清楚地暴露问题。

---

## 阶段 D：开发环境数据收敛策略

### 目标

既然开发数据不重要，就不要让 runtime 观测表无限增长。

### 可选策略

#### 方案 1：启动时清理开发观测数据

当 `APP_ENV=development` 时，在启动前或启动后清理以下表：

- `SchedulerCandidateDecision`
- `SchedulerRun`
- `InferenceTrace`
- `ActionIntent`
- `DecisionJob`
- 视需要包括 `SchedulerCursor` / `SchedulerLease`

适合“每次启动都从相对干净状态开始”的开发模式。

#### 方案 2：保留上限

只保留最近 N 条 / 最近 N tick / 最近 N 天记录，例如：

- Scheduler run 只保留最近 1000 条；
- Trace / job / action 只保留最近若干条。

适合还需要保留一点调试痕迹的开发模式。

#### 推荐

优先采用：

- **默认保留上限**，防止表无限膨胀；
- 再提供一个**可选的 dev 启动清空开关**，用于快速恢复纯净环境。

### 验收标准

- 长期运行后数据库体积不再无上限增长；
- scheduler 观测接口仍可用于近期调试；
- 清理策略仅在开发环境生效，不影响后续生产策略。

---

## 阶段 E：错误分类与诊断增强

### 目标

让下一次类似问题第一眼就能看出是 SQLite/Prisma 超时，而不是 BigInt。

### 改造点

1. 调整 `handleSimulationStepError` 文案：
   - 不再统一写“可能存在 BigInt 异常”；
   - 对 Prisma timeout / SQLite lock / 普通业务异常分级输出。
2. 在 scheduler lease 获取失败时补充上下文：
   - 当前 workerId
   - partitionId
   - 当前 tick
   - 上轮执行耗时
3. 在 runtime status 或通知中增加：
   - loop 是否 in-flight
   - 最近一次 step 耗时
   - 最近一次 step 失败阶段（scheduler / job runner / dispatcher）

### 验收标准

- 错误通知不再误导排查方向；
- 出现失败时可以直接定位到“数据库锁等待超时”或“loop overlap”。

---

## 阶段 F：回归验证

### 目标

确认改造不是“看起来更稳”，而是对问题复现路径真正封堵。

### 验证项

1. **串行调度验证**
   - 人为给 scheduler 或 dispatcher 注入延迟；
   - 确认不会出现 loop overlap。
2. **SQLite pragma 验证**
   - 启动后检查 `journal_mode`、`busy_timeout`。
3. **冷启动验证**
   - 删除数据库后重建并启动；
   - 连续运行若干分钟不出现 lease upsert timeout。
4. **高频写入验证**
   - 保持 scheduler 正常运行并访问 operator 页面；
   - 确认不会再次快速复现锁超时。
5. **开发清理策略验证**
   - 连续运行一段时间后确认表大小和记录数受控。

### 建议补充的测试

- 新增一个 e2e 或最小集成测试，专门验证 simulation loop 不重入。
- 新增一个启动检查脚本，打印当前 SQLite pragma 与关键表数量。

---

## 5. 实施顺序建议

按以下顺序执行，收益最高：

1. **先重建开发数据库**
2. **立即改 simulation loop 为串行**
3. **接着加 SQLite pragma 初始化**
4. **再加开发环境清理/保留上限**
5. **最后补错误诊断与回归测试**

原因：

- 串行 loop 是最核心的根因修复；
- SQLite pragma 是第二道保险；
- 数据清理是避免问题长期回潮；
- 错误诊断和测试用于让后续维护成本下降。

---

## 6. 风险与取舍

### 风险

- 串行 loop 可能让“理论吞吐”下降，但它换来的是可控性和稳定性。
- 启动清理开发数据会丢失调试历史，但这是当前明确可接受的前提。
- WAL 模式会产生 `-wal/-shm` 文件，需要在 reset 脚本里一并处理。

### 取舍

本次优先级是：

**稳定性 > 吞吐 > 历史数据保留 > 调试便利性**

在开发环境这是合理取舍。

---

## 7. 完成标准（Definition of Done）

满足以下条件即可认为本问题已被“根除级处理”：

- development 环境数据库已可一键重建；
- simulation loop 绝不会重入；
- SQLite 运行时固定启用 WAL + busy_timeout；
- 观测/trace 表不会无限膨胀；
- runtime 错误信息不再误报 BigInt；
- 在干净库和连续运行场景下，无法再轻易复现 `schedulerLease.upsert()` 超时。

---

## 8. 后续可选增强（非本次必做）

如果后续开发规模继续扩大，再考虑：

- 将 runtime 主数据库从 SQLite 升级到 PostgreSQL；
- 把 scheduler observability 写入迁到异步或独立存储；
- 给 runtime loop 增加更完整的运行指标面板。

这部分不是当前阶段必须动作，因为开发环境下先通过串行化 + WAL + 清理策略，已经足够把当前问题压到很低。
