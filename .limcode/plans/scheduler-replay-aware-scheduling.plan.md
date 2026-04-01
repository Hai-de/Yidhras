## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 为 DecisionJob 增加 intent_class 字段与迁移  `#sra1`
- [ ] 在 direct submit / scheduler / replay / retry 路径写入统一 intent_class 与 job_source metadata  `#sra2`
- [ ] 在 workflow list/detail/snapshot 读模型中暴露 intent_class  `#sra3`
- [ ] 补充 scheduler/replay/retry/direct submit e2e 验证  `#sra4`
- [ ] 同步 API/ARCH/TODO/记录 文档  `#sra5`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler Replay-Aware Scheduling 与 Job Intent Classes 实施计划

> Source Design: `.limcode/design/scheduler-replay-aware-scheduling-design.md`

## 1. 目标

在不等待前端开发的前提下，继续推进后端 runtime/workflow 主线：

- 为 `DecisionJob` 增加稳定的 `intent_class`
- 为 direct submit / scheduler / replay / retry 写入统一 job source metadata
- 让 workflow read model 能直接暴露 job 语义类别
- 为后续 scheduler summary/trend、operator drill-down、multi-worker 语义和 replay-aware policy 打基础

## 2. 实施范围

### 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/**`

### 服务 / 运行层
- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/inference/service.ts`

### 读模型 / 路由
- workflow list/detail/snapshot 相关 read helper
- 必要时更新 `apps/server/src/app/routes/inference.ts` 的响应字段映射

### 验证
- `apps/server/src/e2e/agent_scheduler.ts`
- `apps/server/src/e2e/workflow_replay.ts`
- 必要时新增独立 e2e

### 文档
- `docs/API.md`
- `docs/ARCH.md`
- `TODO.md`
- `记录.md`

## 3. 具体任务拆解

## Task 1. Schema 与迁移

### 目标
为 `DecisionJob` 新增：
- `intent_class String @default("direct_inference")`

### 建议
- 增加索引：`@@index([intent_class, created_at])`
- 保持 string literal，不引入 enum

### 验收
- prisma generate / migrate deploy 通过
- 默认旧路径不会因为缺字段而崩溃

---

## Task 2. 创建路径统一写入 intent_class 与 job_source

### 目标
确保以下入口都显式写入正确语义：

- direct submit -> `direct_inference`
- scheduler periodic -> `scheduler_periodic`
- scheduler event-driven -> `scheduler_event_followup`
- replay -> `replay_recovery`
- retry -> `retry_recovery`

### 具体位置
- `createPendingDecisionJob()`
- `createReplayDecisionJob()`
- retry reset / retry execution path
- scheduler create path
- direct submit path in inference service

### request_input.attributes 统一补充
- `job_intent_class`
- `job_source`

### 验收
- 不同路径创建出的 job 可以稳定区分
- request_input.attributes 中存在一致 source label

---

## Task 3. Workflow Read Model 暴露 intent_class

### 目标
补充以下读路径：

- jobs list item
- job detail
- workflow snapshot

### 要求
- BigInt transport 继续 string-based
- route handlers 保持 thin adapter
- 不做破坏性 read model 重构，仅增量加字段

### 验收
- `GET /api/inference/jobs`
- `GET /api/inference/jobs/:id`
- workflow snapshot read 能看到 `intent_class`

---

## Task 4. 验证脚本

### 目标
补充/增强 e2e：

- direct submit -> `direct_inference`
- scheduler periodic -> `scheduler_periodic`
- scheduler event-driven -> `scheduler_event_followup`
- replay -> `replay_recovery`
- retry -> `retry_recovery`

### 建议
- 优先复用现有 `agent_scheduler.ts` / `workflow_replay.ts`
- 如需要可加一个 focused e2e，例如 `workflow_intent_class.ts`

### 验收
- typecheck 通过
- 相关 e2e 脚本通过

---

## Task 5. 文档同步

### 更新内容
- `docs/API.md`：补充 `intent_class` 响应字段
- `docs/ARCH.md`：说明 job source / intent class 是 workflow semantics 的稳定分类层
- `TODO.md`：更新当前 scheduler/workflow baseline 状态
- `记录.md`：写入验证快照

---

## 4. 风险控制

### 风险 1：语义字段与 scheduler metadata 混层
控制：
- `intent_class` 只做顶层分类
- `scheduler_reason` 等继续做 scheduler 解释层

### 风险 2：不同入口写法不一致
控制：
- 尽量把默认写入逻辑收敛在 workflow service helper 中
- 不让 route 层和 runtime 层各自随意拼字段

### 风险 3：read model 改动范围过大
控制：
- 本阶段只增量暴露字段，不重构整体 workflow DTO

## 5. 验收标准

完成后应满足：

1. `DecisionJob.intent_class` 已落地并持久化
2. direct submit / scheduler / replay / retry 创建的 job 能稳定区分
3. `request_input.attributes.job_intent_class` / `job_source` 统一存在
4. workflow list/detail/snapshot 暴露 `intent_class`
5. e2e 能验证各主要入口的 intent_class 断言
6. 文档与 TODO/记录 已同步
