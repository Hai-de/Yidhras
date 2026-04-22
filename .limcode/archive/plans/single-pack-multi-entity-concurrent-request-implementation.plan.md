<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/single-pack-multi-entity-concurrent-request-design.md","contentHash":"sha256:8cd7aa0450949c1ed054908cba8c470aac840e2122325bd4db3b3083bd95e6cf"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 补 runtime config contract：新增 entity_concurrency / tick_budget / runner concurrency 配置、schema 与默认值  `#plan-phase-a-config-contract`
- [x] 将 decision job runner 与 action dispatcher runner 改为受限并发池，保持 claim/lock/ownership 契约不变  `#plan-phase-b-runner-concurrency`
- [x] 补强 scheduler readiness 与 runner claim 后复核，正式落实实体级 single-flight / activity budget  `#plan-phase-c-single-flight`
- [x] 补充并发相关 observability、测试与部署调优文档  `#plan-phase-d-observability-docs`
<!-- LIMCODE_TODO_LIST_END -->

# 单世界包多实体并发请求实施计划

## 0. 来源设计

- 本计划基于已确认设计：`.limcode/design/single-pack-multi-entity-concurrent-request-design.md`
- 本轮实施只覆盖 **单 active pack** 前提下的 **多实体受控并发**，不进入多世界包同时运行。
- 关键设计结论：
  - pack 级虚拟时钟仍由 `simulation_loop.ts` 串行推进；
  - 不同实体允许并发进入 workflow；
  - 同一实体默认保持 `single-flight`；
  - 数据库策略只提供保守默认值与调优入口，不强制世界包开发者使用特定数据库。

## 1. 实施目标

本轮计划需要达成以下结果：

1. runtime config 中正式出现实体并发、tick budget、runner concurrency 的配置 contract；
2. `DecisionJob` runner 与 `ActionIntent` dispatcher 从顺序 `for` 循环升级为受限并发执行；
3. scheduler 与 runner 形成统一的实体级 `single-flight` 约束，而不是只靠零散的 `pending_workflow` 语义；
4. 冲突延后、claim miss、ownership 失效、并发执行数等信号可以被观察；
5. 默认值保持保守，部署者 / world pack 开发者可以按自身数据库能力调优；
6. 不破坏现有单 pack API / route / projection 合约。

## 2. 约束与原则

### 2.1 保持不变的边界

- 不修改 `SimulationManager` 的单 active pack 前提；
- 不让多个线程/worker 同时推进 pack clock；
- 不在本轮实现中引入多 pack runtime registry；
- 不默认开放同实体多条 writer workflow 真并发；
- 不把数据库能力假设写死进世界语义。

### 2.2 实施原则

- 优先复用现有 partition / lease / claim / ownership / retry 基线；
- 所有高吞吐参数都走 runtime config，而不是 ad-hoc 常量；
- scheduler 只负责创建工作，不直接承担执行器职责；
- runner 并发化后仍坚持“list 发现候选、claim 决定资格、lock ownership 决定合法执行”；
- 实体冲突延后应从“真正失败”中分离统计。

## 3. 代码范围与主要落点

### 3.1 核心实现文件

预计主要涉及：

- `apps/server/src/app/runtime/simulation_loop.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/runtime/job_runner.ts`
- `apps/server/src/app/runtime/action_dispatcher_runner.ts`
- `apps/server/src/app/runtime/scheduler_ownership.ts`
- `apps/server/src/app/services/inference_workflow/workflow_job_repository.ts`
- `apps/server/src/app/services/action_intent_repository.ts`
- `apps/server/src/inference/service.ts`
- `apps/server/src/config/runtime_config.ts`
- `apps/server/config/**` 中对应 runtime config scaffold / defaults / examples

### 3.2 可能新增或拆分的实现模块

按需要新增轻量模块，避免继续把逻辑堆进单文件：

- `apps/server/src/app/runtime/entity_activity_policy.ts`
- `apps/server/src/app/runtime/entity_activity_query.ts`
- `apps/server/src/app/runtime/runner_concurrency.ts`
- `apps/server/src/app/services/scheduler_concurrency_observability.ts`

若最终不拆文件，也需要在职责上明确区分：

- 配置解析；
- 实体活动判定；
- runner 并发池；
- 并发观测。

### 3.3 测试与文档范围

预计涉及：

- `apps/server/tests/**` 下 scheduler / runtime / workflow / inference 相关测试；
- `docs/ARCH.md`
- `docs/LOGIC.md`
- `docs/guides/DB_OPERATIONS.md`
- `docs/guides/COMMANDS.md`
- 如有必要，补并发调优示例配置。

## 4. 分阶段实施

## Phase A：配置 contract 与默认值收口

### 4.1 A1 — 扩展 runtime config schema

目标：先把并发策略从隐式行为升级为正式 host policy。

实施内容：

1. 在 runtime config 中新增并校验以下配置组：
   - `scheduler.entity_concurrency.*`
   - `scheduler.tick_budget.*`
   - `scheduler.runners.decision_job.concurrency`
   - `scheduler.runners.action_dispatcher.concurrency`
2. 明确保守默认值，满足现有单进程 / SQLite baseline；
3. 为 env override 提供映射入口；
4. 确保 runtime config snapshot 能展示这些最终生效值。

完成标准：

- 新配置能被 schema 校验；
- 缺省值不会改变当前部署的保守行为；
- operator 能看到当前并发参数快照。

### 4.2 A2 — 更新 scaffold / example / docs contract

目标：让部署者知道这些参数存在，且知道这是可调 host policy。

实施内容：

1. 更新默认配置 scaffold / example；
2. 在文档中明确：
   - 平台只提供保守默认值；
   - 世界包开发者 / 部署者自行承担数据库吞吐调优责任；
   - 不限制数据库类型，但应自行评估与并发参数匹配关系。

完成标准：

- 首次启动或示例配置里能看到新参数；
- 文档表述与设计一致，不把数据库策略写成硬约束。

## Phase B：runner 并发池化

### 4.3 B1 — DecisionJob runner 改为受限并发

目标：让不同实体的 decision job 能并发执行，但不破坏现有锁语义。

实施内容：

1. 抽出通用受限并发执行 helper，或在 `job_runner.ts` 内实现小型并发池；
2. 保持现有流程：
   - `listRunnableDecisionJobs()` 发现候选；
   - `claimDecisionJob()` 决定资格；
   - `executeDecisionJob()` 在 lock ownership 下运行；
3. 并发上限由 `scheduler.runners.decision_job.concurrency` 控制；
4. 区分：
   - list 命中数量；
   - claim 成功数量；
   - 真正执行数量；
   - claim miss / ownership invalid 数量。

完成标准：

- 单轮 runner 可并发消费多个 decision jobs；
- 未 claim 成功的 job 不会误执行；
- 原有 retry / replay / release lock 流程不被破坏。

### 4.4 B2 — Action dispatcher runner 改为受限并发

目标：让不同实体的 action dispatch 并发化，但默认并发度更保守。

实施内容：

1. 对 `runActionDispatcher()` 应用同类并发池模式；
2. 保持：
   - `listDispatchableActionIntents()` 发现候选；
   - `claimActionIntent()` 争抢资格；
   - `assertActionIntentLockOwnership()` 校验执行合法性；
3. 并发度由 `scheduler.runners.action_dispatcher.concurrency` 控制；
4. 保持现有 memory recording / compaction / completed/failed/dropped 路径完整。

完成标准：

- dispatcher 可并发处理多个 intent；
- 同一 intent 仍只会由一个 worker 成功 claim；
- 失败和 dropped 行为与原语义一致。

### 4.5 B3 — loop 指标与执行摘要最小补充

目标：避免并发后 loop 仍是黑盒。

实施内容：

1. 在 loop / runner diagnostics 中记录每轮：
   - list 数；
   - claim success 数；
   - executed/dispatched 数；
   - 当前配置的 concurrency；
2. 避免大体量日志，只保留摘要指标。

完成标准：

- 基础并发行为可以在 runtime diagnostics 中被感知；
- 不显著膨胀 trace / log 体积。

## Phase C：实体级 single-flight 与 activity budget 补强

### 4.6 C1 — 正式化 active workflow 判定

目标：把“同实体默认单飞行”变成清晰 contract。

实施内容：

1. 定义实体 active workflow 查询口径：
   - `DecisionJob` 的 pending/running/retry-waiting 等状态；
   - `ActionIntent` 的 pending/dispatching 状态；
   - recovery window 抑制状态；
2. 提供统一 helper，供 scheduler 与 runner 共用；
3. 避免不同文件各自散落判断条件。

完成标准：

- 存在统一的实体活动判定入口；
- scheduler 与 runner 使用同一口径。

### 4.7 C2 — scheduler readiness 接入 entity budget

目标：从现有 `pending_workflow` 雏形升级为正式活动约束。

实施内容：

1. 在 `evaluateSchedulerActorReadiness()` 基础上补入：
   - entity active workflow 检查；
   - per-tick activation budget；
   - tick budget / candidate scan budget；
2. 保留并明确现有：
   - periodic cooldown；
   - replay / retry suppression；
   - signal coalescing；
3. 统一 skip reason 命名与统计维度。

完成标准：

- 同实体不会因并发 runner 打开后在同一轮被重复创建多条 writer workflow；
- readiness 结果可以区分预算、冷却、恢复窗口、single-flight 抑制等原因。

### 4.8 C3 — runner claim 后复核 single-flight

目标：即使 scheduler 前置抑制漏网，runner 侧也能兜底。

实施内容：

1. 在 claim 成功后、真正执行前进行实体级复核；
2. 对发现冲突的工作项执行：
   - 释放 lock 或回退到延后路径；
   - 打上专用 observability reason；
3. 区分“真正执行失败”和“设计性限流/冲突延后”。

完成标准：

- 并发 runner 不会让同实体轻易进入双 writer 并发；
- 冲突延后不污染普通失败统计。

## Phase D：observability、测试与文档收尾

### 4.9 D1 — scheduler / runner / worker 并发观测增强

目标：让 operator 能看见并发是否有效、冲突是否健康。

实施内容：

1. scheduler 层补充：
   - per tick / per partition 创建量；
   - actor skip reason 分布；
   - coalesced signal 数；
   - 热点 actor / 热点 partition 摘要；
2. decision runner 层补充：
   - claim success/fail；
   - 当前并发执行数；
   - ownership invalid；
   - entity conflict 延后数；
3. action dispatcher 层补充：
   - dispatch 并发数；
   - completed / failed / dropped 分布；
   - entity conflict 延后数；
4. worker / ownership 层补充：
   - renew 失败；
   - migration backlog；
   - stale/dead worker 影响。

完成标准：

- operator 可以区分数据库/claim 竞争、实体冲突、正常完成与真实失败；
- 关键指标能被已有 observability surface 消费。

### 4.10 D2 — 测试补齐

目标：为并发化改造建立可回归基线。

实施内容：

1. 单元测试覆盖：
   - runtime config 新 schema；
   - runner 并发池边界；
   - entity active workflow 判定；
   - skip reason / budget 逻辑；
2. 集成测试覆盖：
   - 多实体并发执行时，不同实体可同时推进；
   - 同实体不会同时跑双 writer workflow；
   - claim miss / ownership invalid / retry recovery 行为正确；
3. 如现有测试基础不足，先补最小可维护 harness。

完成标准：

- 并发路径不只靠手工验证；
- 核心行为有自动回归保障。

### 4.11 D3 — 文档与部署调优说明

目标：把“保守默认值 + 自行调优”写清楚。

实施内容：

1. 在 `ARCH.md` / `LOGIC.md` 中补正式语义：
   - pack clock 串行；
   - 多实体并发；
   - 同实体 single-flight；
2. 在部署文档中补：
   - 新配置解释；
   - 保守默认值示例；
   - 面向高吞吐数据库/更大世界包的调优示意；
3. 明确声明：平台不限制数据库类型，但部署者应自行承担吞吐调优责任。

完成标准：

- 设计、实现、运维文档保持一致；
- 部署者知道该调哪些参数，以及为什么需要自己评估数据库能力。

## 5. 验收标准

完成本计划后，应满足以下验收条件：

1. 单 active pack 前提保持不变；
2. `simulation_loop.ts` 仍串行推进 clock；
3. 不同实体可通过 decision/action runner 受限并发执行；
4. 同实体默认保持 single-flight，不出现明显双 writer 并发；
5. 并发度、budget、lease、batch 等参数均配置化；
6. 并发冲突、claim miss、ownership invalid、真实失败能够被区分观测；
7. 文档明确平台与世界包开发者/部署者的数据库调优责任边界。

## 6. 风险与应对

### 6.1 数据库写竞争上升

应对：

- 默认低并发；
- 所有参数配置化；
- 通过 observability 暴露 claim miss、执行耗时、冲突延后等指标；
- 文档明确由部署者按数据库能力调优。

### 6.2 同实体状态乱序

应对：

- scheduler 前置抑制；
- runner claim 后复核；
- 冲突延后而非继续执行。

### 6.3 单 tick wall-clock 过长

应对：

- 引入 tick budget；
- 区分 batch limit 与 concurrency；
- 保守默认值不追求极限吞吐。

### 6.4 观测不足导致难定位

应对：

- 优先把 skip reason / claim / conflict / worker 状态做成摘要指标；
- 复用已有 scheduler/operator observability surface，而不是另起一套黑盒日志。

## 7. 实施顺序建议

推荐按照以下顺序执行，避免并发化后难以回溯：

1. **先做配置 contract**，确保行为不是硬编码；
2. **再做 runner 并发池**，先释放多实体吞吐；
3. **再补实体级 single-flight 与 activity budget**，把约束收紧成正式 contract；
4. **最后补 observability、测试与文档**，形成可运维闭环。

## 8. 计划完成后的下一步

本计划完成后，再评估是否进入 `TODO.md` 中的下一阶段：

- 多世界包同时运行；
- 多 pack runtime registry；
- pack 级 clock / plugin runtime / projection / route context 隔离升级。

在此之前，不提前把第四阶段与第五阶段混做。
