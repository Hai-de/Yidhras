# AI Gateway / Invocation Observability

本文档集中说明内部 AI task / gateway 执行层，以及 `AiInvocationRecord` 相关观测能力。

## 1. 文档定位

本文件回答：

- 内部 AI gateway 的分层是什么
- world pack 能如何影响 AI task 路由
- `model_routed` 在系统中的位置
- `AiInvocationRecord` 暴露了什么观测能力

本文件不负责：

- 公共 `/api/inference/*` 的完整 contract：看 `docs/API.md`
- 整体系统模块边界：看 `docs/ARCH.md`
- 推理与世界执行的业务语义：看 `docs/LOGIC.md`

## 2. 内部执行层概览

服务端当前已形成内部 AI 执行层，主要组件包括：

- `AiTaskService`
- `RouteResolver`
- `ModelGateway`
- provider adapters

相关实现主要位于：

- `apps/server/src/ai/task_service.ts`
- `apps/server/src/ai/route_resolver.ts`
- `apps/server/src/ai/gateway.ts`
- `apps/server/src/ai/providers/mock.ts`
- `apps/server/src/ai/providers/openai.ts`

## 3. 分层关系

当前可概括为：

```text
AiTaskService
  -> RouteResolver
  -> ModelGateway
  -> provider adapters
```

作用分别是：

- `AiTaskService`：面向 task type 的内部统一入口
- `RouteResolver`：按任务、配置、路由提示决定走哪条 route
- `ModelGateway`：承接模型调用与 provider adapter 调度
- provider adapters：落到具体 provider 协议

## 4. world pack 的影响范围

world pack 当前只能通过声明式 `pack.ai` 影响：

- prompt organization
- output schema
- parse / decoder behavior
- route hints

world pack **不能**：

- 直接操纵 raw provider payload
- 注入任意可执行 parser / composer 代码
- 绕过 server-side registered extension 模式

## 5. public boundary 与 internal boundary

当前公开 HTTP inference contract 仍然只稳定承诺：

- `mock`
- `rule_based`

内部虽然已经存在：

- `model_routed`
- `gateway_backed` inference provider
- OpenAI-first rollout

但这些目前仍属于内部 / 受控能力，不应被当成正式 public execution contract。

换言之：

- 对外 API 的稳定说明仍是 `mock | rule_based`
- gateway path 是服务端内部的执行底座
- 其 public 化程度目前主要停留在**只读观测面**

## 6. Workflow metadata 透传

当前 workflow metadata 已透传到：

- `PromptBundle.metadata`
- AI messages metadata
- `AiTaskRequest.metadata`
- `ModelGatewayRequest.metadata`
- `AiInvocationTrace`

这意味着 gateway path 的观测不只是“最终 prompt 文本是什么”，还能够回答：

- 当前任务类型是什么
- 命中了哪个 workflow profile
- 使用了哪些 step
- section / placement 结果是什么

## 7. AiInvocationRecord

kernel-side Prisma 当前包含 `AiInvocationRecord`，记录例如：

- provider / model / route
- fallback / attempted models
- usage / safety / latency
- request / response audit payload（受 audit level 控制）
- 与 `InferenceTrace.source_inference_id` 的关联

它的职责更接近：

- AI 调用证据
- provider 观测记录
- workflow 与模型执行之间的桥接证据

而不是 public execution contract 本身。

## 8. Public read-only observability surface

当前已经公开的只读接口：

- `GET /api/inference/ai-invocations`
- `GET /api/inference/ai-invocations/:id`

这些接口的语义是：

- 暴露观测证据
- 支持列表 / 详情查询
- 不改变 `/api/inference/*` 的外部执行契约

当 inference 通过内部 gateway path 执行时，trace metadata 还可能包含：

- `ai_invocation_id`

该字段用于把 workflow-side `InferenceTrace` 关联到 kernel-side `AiInvocationRecord`。

## 9. 当前边界

当前已成立的边界：

- `model_routed` 仍是 internal / controlled capability
- public `/api/inference/*` 不以 provider-specific contract 对外承诺
- world pack 的 AI 定制能力是 declarative 的，不是任意执行能力
- 更复杂的 AI 行为扩展应继续走 server-side registered extension

## 10. 相关文档

- 公共接口契约：`../API.md`
- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- Prompt Workflow：`./PROMPT_WORKFLOW.md`
- 相关设计资产：`.limcode/design/multi-model-gateway-and-unified-ai-task-contract-design.md`
