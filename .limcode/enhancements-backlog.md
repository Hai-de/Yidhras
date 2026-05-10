# 增强功能储备

> 本文件记录经评估后确认有价值但当前阶段不适合实施的功能增强。
> 每项标注判定时间和暂缓原因。

---

## 插件 per-operator 配置

- **提出时间**: 2026-04-28
- **暂缓原因**: 当前系统选择 pack 作为插件管理的最小粒度，此设计是刻意的架构决策而非遗漏。per-operator 插件配置会导致同一 pack 内 operator 看到不同的插件行为，与"pack 作为世界状态单元"的核心假设冲突。需要在此之前先澄清"插件的归属权"和 P2P agent 自主行为时的权限传递模型。
- **前置条件**:
  1. 明确插件生命周期中的"所有者"概念（pack vs operator vs agent）
  2. 解决 agent 自主推理时的插件配置来源问题
  3. 评估是否需要比 pack 更细的"租户"抽象
- **替代方案**: 通过 capability 控制 operator 的插件管理权限（已有 `MANAGE_PLUGINS`），无权限的 operator 无法管理插件，但不影响已激活插件的运行时行为

---

## Streaming/SSE 支持（AI 推理流式响应）

- **评估时间**: 2026-05-01（更新于 2026-05-10）
- **当前状态**: 后端 adapter + gateway 流式能力已实现。`openai_compatible.ts`（Chat Completions SSE）和 `anthropic.ts`（Messages SSE with typed events）均支持 `executeStream()`。`ModelGateway.executeStream()` 提供跨 provider 的流式调度（含不支持流式的 adapter 退化到 `execute()` 的 fallback）。SSE endpoint（`POST /api/inference/stream`）待前端接入后启用。
- **暂缓部分**: 前端 SSE 消费和 SSE endpoint 注册仍暂缓，原因不变：
  - **推理由仿真循环异步批量驱动**，非用户交互触发。AI 调用发生在 `job_runner.ts` 的后台 worker 中，没有 HTTP 客户端在等待响应。
  - **前端是只读轮询控制台**，不触发推理。所有推理数据通过 3-30 秒间隔的 fetch 拉取已完成的作业结果，无可展示流式文本的 UI 组件。
  - 工具循环 (`tool_loop_runner.ts`) 不使用流式模式（串行阻塞模型与流式增量解析冲突），仅非 tool 请求使用流式。
- **已实现 vs 未实现**：
  - ✅ adapter 流式接口（`AiProviderAdapter.executeStream`、`AiProviderAdapterChunk`）
  - ✅ OpenAI Chat Completions streaming + Anthropic Messages streaming
  - ✅ Gateway 流式调度（`ModelGateway.executeStream`）+ 不支持流式 adapter 的退化 fallback
  - ❌ OpenAI Responses API streaming（仅 Chat Completions 路径支持）
  - ❌ SSE endpoint 注册（`POST /api/inference/stream`）—— adapter + gateway 已就绪，需前端接入时在 route handler 中串联
  - ❌ 前端 SSE 消费
  - ❌ Tool loop 流式模式
