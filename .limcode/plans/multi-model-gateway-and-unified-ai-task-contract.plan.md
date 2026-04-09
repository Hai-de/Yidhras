<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/multi-model-gateway-and-unified-ai-task-contract-design.md","contentHash":"sha256:2f7214454ac5f95ac54a2492e36753db80ea250d6b96823e47088631e6110813"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 建立 apps/server/src/ai/ 内部合同与基础模块，定义 AiTaskType、ModelGatewayRequest/Response、ModelRegistry、AiRoutePolicy、provider capability 模型与配置装载入口  `#mmg-p1`
- [x] 实现 ModelGateway / AiTaskService 最小骨架、provider adapter SPI、PromptBundle→AiMessage 适配与结构化输出校验链，并保留 mock 适配路径  `#mmg-p2`
- [x] 将 inference 与新网关集成，引入 gateway-backed provider/engine mode 适配层，在不破坏现有 /api/inference/* 与 mock/rule_based 兼容性的前提下打通调用主链  `#mmg-p3`
- [x] 新增 AiInvocationRecord 持久化、fallback/usage/safety/error-stage 观测与与 InferenceTrace 的关联证据面  `#mmg-p4`
- [x] 落地首个真实 provider adapter 与模型注册配置（默认按 OpenAI-first 规划，若执行前确定本地优先则可等价替换为 Ollama-first），打通路由、超时、重试与降级策略  `#mmg-p5`
- [x] 补齐 unit/integration/e2e 与文档同步，明确内部网关与公共 API 的边界，并为后续 public model_routed 扩展保留但不立即开放  `#mmg-p6`
<!-- LIMCODE_TODO_LIST_END -->

# 多模型网关与统一 AI 任务合同实施计划

> Source Design: `.limcode/design/multi-model-gateway-and-unified-ai-task-contract-design.md`

## 1. 目标

本计划基于已确认的“多模型网关与统一 AI 任务合同设计”，目标是在 **不打断现有 inference/workflow 对外接口** 的前提下，为 Yidhras 引入一套可持续演进的内部 AI 执行层，包括：

- `AiTaskService`：统一 AI 任务入口
- `RouteResolver`：按任务/pack/隐私/能力要求选路
- `ModelGateway`：统一请求/响应、超时、重试、fallback、结构化输出、safety、usage
- `Provider Adapters`：屏蔽 OpenAI / Anthropic / Gemini / Ollama / custom HTTP 差异
- `AiInvocationRecord`：统一模型调用观测与审计证据面

本轮重点不是一次性把系统所有行为都改成 LLM 驱动，而是先建立 **稳定底座**，让后续 agent decision、context summary、moderation、embedding、extraction 等能力都能落在同一条网关主线之上。

---

## 2. 当前代码状态与切入点

### 2.1 已有基础

当前仓库已经具备以下可直接延展的基础：

- `apps/server/src/inference/provider.ts`
  - 当前只有最小 `InferenceProvider { name, strategies, run(context, prompt) }`
- `apps/server/src/inference/service.ts`
  - 已具备：
    - `previewInference`
    - `runInference`
    - `submitInferenceJob`
    - `replayInferenceJob`
    - `retryInferenceJob`
  - 已具备：
    - prompt 构建
    - decision normalization
    - intent grounding
    - workflow/job/trace 落库
- `apps/server/src/inference/types.ts`
  - 当前 `InferenceStrategy = 'mock' | 'rule_based'`
  - 已有 `PromptBundle / InferenceContext / DecisionResult / TraceMetadata`
- `packages/contracts/src/inference.ts`
  - 当前只承载 `/api/inference/*` 的公共 HTTP 合同
  - 并不承载内部多模型网关合同
- `apps/server/src/index.ts`
  - 当前统一装配 `createInferenceService(...)`
- `apps/server/src/app/context.ts`
  - 当前 `AppContext` 尚未持有 AI gateway/task service 能力
- `apps/server/prisma/schema.prisma`
  - 已有 `InferenceTrace / DecisionJob / ActionIntent` 等 workflow 主干对象
  - 但尚无通用 `AiInvocationRecord` 证据层
- `apps/server/src/config/*`
  - 已有统一配置装载机制，可作为模型注册表与 provider secrets 配置入口

### 2.2 当前主要缺口

从实施角度，最核心的缺口有五个：

1. **任务层不存在**
   - 业务模块还没有统一 `AiTaskRequest -> AiTaskResult` 入口
2. **模型网关不存在**
   - 没有统一请求/响应合同
   - 没有统一 retry/fallback/usage/safety 处理
3. **模型注册与路由不存在**
   - 还没有 `ModelRegistry` / `RouteResolver`
4. **供应商适配层不存在**
   - 未来若直接在业务模块中接各家 SDK，会快速失控
5. **通用 AI 调用证据层不存在**
   - 当前只有 `InferenceTrace`
   - 未来 summary/moderation/embedding 等调用不应全部挤进 inference 语义里

### 2.3 约束与边界

本计划应始终坚持以下约束：

- **不直接破坏现有 `/api/inference/*` 外部合同**
- **不立刻把 `packages/contracts/src/inference.ts` 扩展成完整内部网关合同**
- **不让业务模块直接依赖供应商 SDK**
- **不开放模型直接写世界状态或高权限工具执行**
- **不一开始就做前端模型管理页面**
- **不把系统拆成独立 AI 微服务**；第一阶段先在 `apps/server` 内部落地

---

## 3. 实施范围

## 3.1 Phase A：建立内部 AI 合同、模型注册与配置骨架

### 目标

先把“统一语言”定下来，让内部 AI 模块有稳定类型边界，而不是继续在 `inference/*` 中零散扩展。

### 推荐新增目录

建议新增：

```text
apps/server/src/ai/
  types.ts
  registry.ts
  route_resolver.ts
  task_service.ts
  gateway.ts
  observability.ts
  providers/
```

### 计划内容

1. 在 `apps/server/src/ai/types.ts` 中定义内部核心合同：
   - `AiTaskType`
   - `AiMessage / AiContentPart`
   - `AiResponseMode`
   - `AiToolSpec / AiToolPolicy`
   - `AiStructuredOutputSpec`
   - `ModelGatewayRequest / ModelGatewayResponse`
   - `AiTaskRequest / AiTaskResult`
   - `AiModelCapabilities / AiModelRegistryEntry`
   - `AiRoutePolicy`
2. 在 `apps/server/src/ai/registry.ts` 中定义模型注册表读取与查询能力：
   - provider/model 唯一标识
   - capability 过滤
   - availability / pricing / defaults
3. 在 `apps/server/src/ai/route_resolver.ts` 中定义最小路由选择模型：
   - 按 `task_type`
   - 按 `pack_id`
   - 按 capability/隐私/延迟/成本约束
   - fallback 候选链
4. 通过 `apps/server/src/config/*` 增加模型配置装载入口：
   - 建议支持 `apps/server/config/ai_models.yaml`
   - provider key 与 endpoint secrets 继续由 env 承载
5. 明确边界：
   - **内部网关合同先放 `apps/server/src/ai/*`**
   - `packages/contracts` 暂不承载这套内部协议

### 关键文件候选

- `apps/server/src/ai/types.ts`
- `apps/server/src/ai/registry.ts`
- `apps/server/src/ai/route_resolver.ts`
- `apps/server/src/config/schema.ts`
- `apps/server/src/config/loader.ts`
- 可选新增：`apps/server/config/ai_models.yaml`

### 范围控制

本阶段不实现真实 provider SDK 调用，只先把：

- 类型边界
- 配置装载
- 路由决策输入/输出

稳定下来。

---

## 3.2 Phase B：实现 ModelGateway / AiTaskService 最小骨架与 provider adapter SPI

### 目标

建立统一执行主链，让后续所有 provider 都走同一套流程，而不是在业务里直接调用 SDK。

### 计划内容

1. 在 `apps/server/src/ai/gateway.ts` 中实现统一网关骨架：
   - request normalization
   - route resolution
   - provider selection
   - timeout / retry / fallback 编排
   - usage/safety/error 统一归一化
2. 在 `apps/server/src/ai/task_service.ts` 中提供业务友好入口：
   - `runTask<TOutput>(request)`
3. 定义 provider adapter SPI，例如：
   - `AiProviderAdapter`
   - `AiProviderExecutionContext`
   - `AiProviderResult`
4. 新增最小 provider adapter：
   - `mock adapter`
   - 可选 `custom_http/local stub adapter`
5. 新增 prompt 适配层：
   - 把当前 `PromptBundle` 映射为标准 `AiMessage[]`
   - 先满足 inference 场景
6. 建立结构化输出校验链：
   - response mode 声明
   - provider raw result -> gateway normalized result
   - 本地 schema/zod 二次校验
   - 错误阶段区分：`provider / decode / validate / safety / route`

### 推荐新增文件

```text
apps/server/src/ai/
  gateway.ts
  task_service.ts
  adapters/prompt_bundle_adapter.ts
  providers/mock.ts
  providers/types.ts
  schemas/decision.ts
```

### 关键兼容点

- 当前 `normalizeDecision(...)` 的二次校验思想应保留
- 当前 `PromptBundle` 不需要立即废弃
- 当前 provider 概念先不删除，而是为后续 gateway-backed provider 做铺垫

---

## 3.3 Phase C：将 inference 与新网关打通，但保持现有公共 API 稳定

### 目标

在不破坏现有 `/api/inference/*` 的情况下，让 inference 能逐步使用统一网关作为实际模型执行层。

### 计划内容

1. 评估并引入兼容适配层，推荐两种实现路径二选一：
   - **方案 A：新增 `GatewayBackedInferenceProvider`**
   - **方案 B：把 `InferenceProvider` 语义逐步降级为 decision-engine adapter**
2. 优先建议执行方案 A：
   - 保留 `MockInferenceProvider`
   - 保留 `RuleBasedInferenceProvider`
   - 新增 `GatewayBackedInferenceProvider`
3. 在 `apps/server/src/inference/service.ts` 中调整 provider 选择逻辑：
   - 维持当前 public `strategy = mock | rule_based`
   - 内部允许在受控分支下接入 `model_routed`
   - 但第一轮不要求开放公共 schema
4. 将 inference 场景封装为 `AiTaskRequest`：
   - `task_type = agent_decision`
   - 上游输入来自 `InferenceContext + PromptBundle`
   - 输出经 gateway 正规化后再回到：
     - `normalizeDecision(...)`
     - `IntentGrounder`
     - `ActionIntentDraft`
5. 在 `apps/server/src/index.ts` / `apps/server/src/app/context.ts` 中补足 AI 模块装配：
   - registry
   - route resolver
   - gateway
   - ai task service
   - 可供 inference service 注入

### 重点边界

- `packages/contracts/src/inference.ts` 第一阶段保持不变
- `/api/inference/preview` 与 `/api/inference/run` 继续可用
- 当前 `mock / rule_based` 测试链不能回归
- `model_routed` 若未开放公共 schema，只能作为内部受控能力存在

### 关键文件候选

- `apps/server/src/inference/service.ts`
- `apps/server/src/inference/provider.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/index.ts`
- `apps/server/src/app/context.ts`

---

## 3.4 Phase D：新增 AiInvocationRecord 持久化、观测与与 InferenceTrace 的关联证据层

### 目标

建立通用 AI 调用证据面，避免未来非 inference 任务也只能挤进 `InferenceTrace`。

### 计划内容

1. 在 Prisma 中新增最小持久化模型（名称以最终 schema 为准）：
   - `AiInvocationRecord`
2. 建议字段至少覆盖：
   - `id / invocation_id`
   - `task_id`
   - `task_type`
   - `provider`
   - `model`
   - `route_id`
   - `status`
   - `finish_reason`
   - `attempted_models`
   - `fallback_used`
   - `latency_ms`
   - `usage_json`
   - `safety_json`
   - `error_code`
   - `error_message`
   - `error_stage`
   - `audit_level`
   - `source_inference_id` 或等价关联字段
   - `created_at / completed_at`
3. 在 `apps/server/src/ai/observability.ts` 中统一封装记录逻辑：
   - 开始记录
   - 尝试链记录
   - fallback 记录
   - 结束记录
4. 与现有 `InferenceTrace` 建立最小关联：
   - inference 场景至少能从 trace 找到对应 invocation
   - 但不强迫所有 invocation 只服务 inference
5. 审计分级控制：
   - `minimal`
   - `standard`
   - `full`
   以控制 raw prompt/raw response 是否落库

### 范围控制

- 第一轮不要求立刻提供新的公共 API endpoint
- 可先保证：
  - 数据落库
  - workflow trace 可间接关联
  - debug/service 层可查询

### 关键文件候选

- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/*`
- `apps/server/src/ai/observability.ts`
- `apps/server/src/inference/sinks/prisma.ts`
- `apps/server/src/app/services/inference_workflow/*`

---

## 3.5 Phase E：落地首个真实 provider adapter 与模型配置

### 目标

在统一网关主线稳定后，至少落地一个真实 provider，验证这套架构不是只停留在接口层。

### 推荐策略

按设计文档，第一批真实 provider 建议 **二选一**：

- **OpenAI-first**：如果当前阶段更重视云端结构化输出能力与快速验证
- **Ollama-first**：如果当前阶段更重视本地优先、隐私与离线可控

为了便于执行，计划默认按 **OpenAI-first** 编排；若在执行前明确项目必须本地优先，则可以等价替换为 **Ollama-first**，不影响前四阶段结构。

### 计划内容

1. 在 `apps/server/src/ai/providers/` 下新增首个真实 adapter：
   - `openai.ts` 或 `ollama.ts`
2. 统一 provider 归一化输出：
   - free text
   - json object / json schema
   - usage / finish reason
   - safety / refusal / blocked normalization
3. 接入模型注册表能力声明：
   - structured output
   - tool calling
   - max context/output
   - pricing/default timeout
4. 打通 route policy：
   - `agent_decision` 至少有一条默认路由
   - fallback 链可从真实 provider 回退到 mock/备用模型或稳定模型
5. 增加 feature flag / env guard：
   - 无 secrets 时系统仍可用 mock/rule_based
   - 不因 provider 未配置导致 server 启动失败

### 关键风险控制

- provider SDK 差异不要泄漏到业务模块
- provider refusal / safety block 必须标准化
- 路由失败、无可用模型、schema decode 失败都必须有稳定错误码

---

## 3.6 Phase F：测试、回归与文档同步

### 目标

确保新网关落地后不会破坏现有 inference/workflow 主链，并把边界写清楚。

### 测试建议

#### Unit

1. `ModelRegistry` 过滤与查询
2. `RouteResolver` 能力/隐私/availability 判定
3. `ModelGateway` 的 timeout/retry/fallback 流程
4. `PromptBundle -> AiMessage` 适配
5. structured output decode/validate 失败路径
6. provider capability mismatch 的错误归一化

#### Integration

1. inference 通过 gateway-backed provider 跑通一条 `agent_decision` 主链
2. `mock` 与 `rule_based` 兼容路径无回归
3. `AiInvocationRecord` 与 `InferenceTrace` 的关联落库正确
4. route/fallback 行为在持久化与 workflow 中可观测

#### E2E / Regression

优先覆盖：

1. `apps/server/tests/e2e/smoke-endpoints.spec.ts`
   - 现有 `/api/inference/*` 不回归
2. workflow replay / retry 相关 E2E
3. scheduler 驱动 inference 不回归
4. 若首个真实 provider 有 feature flag，可增加有条件运行或 mock SDK 测试

### 文档同步

建议同步：

- `docs/ARCH.md`
- `docs/API.md`
- `docs/LOGIC.md`
- `README.md`
- `TODO.md`
- `记录.md`

重点写清：

- 内部新增 AI task/gateway/provider adapter 层
- `packages/contracts` 与内部网关合同的边界
- 第一阶段公共 inference strategy 仍不强制开放 `model_routed`
- 未来 public 扩展与 tool calling 仍受控推进

---

## 4. 风险与控制

### 风险 1：再次把 strategy / route / provider 混在一起

影响：

- 代码语义混乱
- public API 与内部执行边界继续耦合

控制：

- 明确拆分：
  - `task_type`
  - `route policy`
  - `provider/model`
- 避免在业务代码中写死具体模型名

### 风险 2：provider 差异泄漏到业务层

影响：

- 以后每加一个 provider 就要修改业务逻辑

控制：

- 所有 SDK/HTTP 差异只允许出现在 `apps/server/src/ai/providers/*`
- gateway 只向上暴露标准化响应

### 风险 3：raw prompt/raw response 落库带来隐私与体积风险

影响：

- 数据过大
- 隐私风险上升

控制：

- 引入 `audit_level`
- 默认不全量落库 raw 内容
- 仅在必要场景提升为 `full`

### 风险 4：fallback 破坏 workflow 可解释性

影响：

- 最终用了哪个模型、为何失败很难追溯

控制：

- `AiInvocationRecord` 必须记录：
  - attempted models
  - fallback used
  - error stage
  - finish reason

### 风险 5：成本和并发不可控

影响：

- 多 agent 并发时 token/cost 迅速膨胀

控制：

- route policy 中预留：
  - latency/cost/privacy 约束
- invocation 侧记录 estimated cost
- 先从少量任务类型接入，不全面放开

---

## 5. 验收标准

本计划执行完成后，应满足：

1. `apps/server/src/ai/*` 已形成正式内部模块，而非把多模型逻辑继续塞进 `inference/*`
2. 已存在统一内部合同：
   - `AiTaskRequest/Result`
   - `ModelGatewayRequest/Response`
   - `ModelRegistry`
   - `RouteResolver`
3. inference 至少有一条路径可通过 gateway-backed provider 运行，同时现有 `mock / rule_based` 不回归
4. 已存在通用 `AiInvocationRecord` 证据层，并可关联 inference workflow
5. 已有至少一个真实 provider adapter 能在配置完备时跑通
6. 无真实 provider 配置时，server 仍能以现有 mock/rule_based 路径稳定运行
7. 文档已明确：
   - 内部网关是 server-side contract
   - 公共 `/api/inference/*` 合同第一阶段保持稳定
   - future `model_routed` 扩展是后续演进，不在本轮强制公开

---

## 6. 建议实施顺序

建议按以下顺序执行：

1. **Phase A**：先立内部合同、注册表、路由与配置边界
2. **Phase B**：再做网关主链、adapter SPI 与结构化输出校验
3. **Phase C**：然后把 inference 通过兼容适配层接到网关上
4. **Phase D**：再补通用 invocation 持久化与观测证据层
5. **Phase E**：最后接入首个真实 provider 与路由配置
6. **Phase F**：收尾测试、回归与文档同步

这个顺序的优势是：

- 先稳定边界，再接真实模型
- 先保证兼容性，再扩大能力面
- 避免一开始就因 SDK/供应商差异把主链打乱

---

## 7. 结论

本轮实施最重要的不是“再加一个 provider 文件”，而是：

> **先把 Yidhras 的 AI 执行层从当前 inference 内部策略抽象，提升为真正可复用的任务层 + 路由层 + 网关层 + 适配层。**

这样做之后：

- `agent_decision` 可以稳定接入真实模型
- `context_summary / moderation / embedding / extraction` 也有统一落点
- provider 差异、fallback、usage、safety、审计都能被统一治理
- 同时不需要立刻打破现有 inference/workflow 公共接口

因此，推荐下一阶段的执行主线就是：

- `apps/server/src/ai/*` 内部模块化
- inference 与 gateway 的兼容接入
- `AiInvocationRecord` 通用证据层
- 首个真实 provider 落地验证

而不是继续在现有 `InferenceProvider` 上做零散的供应商特判扩展。
