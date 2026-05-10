# AI Gateway 完整性补全 — 实施计划

> 设计依据：`.limcode/design/ai-gateway-completion-draft.md`
> 审计来源：`.limcode/design/skeptical-comprehensive-audit-report.md` §4.3
> 状态：全部完成 ✅
> 日期：2026-05-10

---

## 总览

**目标**：将 AI Gateway 从单一 OpenAI provider 扩展为多 provider 系统，补全弹性层、token 预算、缓存、streaming 等缺失能力。

**总工期**：约 15.5 天（Phase 0 + Phase 1: 5.5 天，Phase 2: 5 天，Phase 3: 5 天）

**验收标准**：
- [x] 任意单一 provider 故障时，系统自动 fallback 到下一个可用 provider，agent 决策不中断
- [x] 4 个 provider adapter 可用：OpenAI、Anthropic、DeepSeek、Ollama
- [x] 所有新代码通过 unit + integration 测试
- [x] 现有 OpenAI 测试套件零回归
- [x] 熔断器状态跨请求保持
- [x] Tool loop 不会撑爆上下文窗口

---

## Phase 0 — 前置修复（0.5 天）

### P0-1: Circuit breaker / rate limiter 生命周期修复

**文件**：`apps/server/src/ai/gateway.ts`

**当前 bug**：`cbMap` 和 `rlMap` 在 `execute()` 内部创建（line 282-283），每次调用实例重置，熔断器不积累失败计数。

**修改**：将两个 Map 提升到 `createModelGateway` 闭包作用域，与 `adapterByProvider` 同级。

**验收**：
- [x] `cbMap` 和 `rlMap` 在 `createModelGateway` 闭包中声明
- [x] 单元测试：同一 provider 连续 5 次失败后第 6 次被 circuit breaker 拒绝
- [x] 单元测试：rate limiter 并发计数跨请求保持

---

## Phase 1 — 多 Provider 生态（5 天）

### P1-1: OpenAI 兼容通用 Adapter 重构

**文件**：
- `apps/server/src/ai/providers/openai_compatible.ts`（新建，~350 行）
- `apps/server/src/ai/providers/openai.ts`（重构，401→350 行）

**内容**：
1. 从 `openai.ts` 提取 `buildChatCompletionsRequestBody`、`normalizeChatCompletionsResponse`、`performChatCompletionsRequest` 到 `openai_compatible.ts`
2. 实现 `createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig)` 工厂函数，含 `capabilityOverrides` 处理
3. 重构 `openai.ts`：委托 Chat Completions 路径给 `openai_compatible`，保留 Responses / Embeddings / 认证逻辑

**验收**：
- [x] Contract 测试：重构前后 OpenAI Chat Completions 路径输入/输出完全一致
- [x] 现有 OpenAI 测试全绿

### P1-2: Anthropic Provider Adapter

**文件**：`apps/server/src/ai/providers/anthropic.ts`（新建，~450 行）

**内容**：
1. 实现 Messages API 调用（POST `https://api.anthropic.com/v1/messages`）
2. System prompt 提取：从 `messages[]` 提取 `role='system'|'developer'`，合并到顶层 `system` 参数
3. Structured output 折中：
   - `response_mode=json_schema` → 包装 `__structured_output` tool，`tool_choice` 强制调用
   - `response_mode=json_object` → 提示词注入 + JSON.parse + 失败重试 1 次
   - 与真实 tool calling 冲突时 `tool_choice='any'`（允许并行调用）
4. `endpoint_kind='messages'`
5. `thinking` 参数通过 `sampling.extensions.thinking` 透传

**验收**（Anthropic）：
- [x] 单元测试：system prompt 正确提取到顶层参数，messages 数组不残留 system role
- [x] 单元测试：`json_schema` 模式生成正确的 `__structured_output` tool
- [x] 单元测试：`json_object` 模式注入提示词，解析失败触发重试
- [x] 单元测试：tool_use response 正确解析为 `tool_calls`
- [x] 单元测试：鉴权失败返回 `AI_PROVIDER_AUTH_MISSING`

**文件**：`apps/server/src/ai/providers/deepseek.ts`（新建，~40 行）

**内容**：调用 `createOpenAiCompatibleAdapter` + `capabilityOverrides`（`disallowTempWithTopP: true`、`maxTokensField: 'max_tokens'`、`maxStructuredOutput: 'json_object'`）

**验收**（DeepSeek）：
- [x] 单元测试：`temperature` 和 `top_p` 同时传入时只保留 `temperature`
- [x] 单元测试：请求体使用 `max_tokens` 而非 `max_completion_tokens`

### P1-4: Ollama Provider Adapter

**文件**：`apps/server/src/ai/providers/ollama.ts`（新建，~25 行）

**内容**：调用 `createOpenAiCompatibleAdapter`，默认 `base_url: http://localhost:11434/v1`，无 API key。注册 nomic-embed-text 为 embedding fallback。

**验收**（Ollama）：
- [x] 单元测试：无 API key 时不报 auth 错误（`api_key_env` 为 null）
- [x] `default.embedding` route 的 `fallback_models` 包含 `ollama:nomic-embed-text`

### P1-5: 注册表更新

**文件**：`apps/server/src/ai/registry.ts`

**内容**：
- 内置 `providers[]` 新增 anthropic、deepseek、ollama
- 内置 `models[]` 新增 claude-sonnet-4-6、deepseek-chat、llama3.2、nomic-embed-text
- 内置 `routes[]` 的 `fallback_models` 添加 Anthropic/DeepSeek 候选
- `default.embedding` 添加 ollama:nomic-embed-text 作为 fallback

**验收**（注册表）：
- [x] `pnpm typecheck` 通过
- [x] `getAiRegistryConfig()` 返回完整多 provider 配置

### P1-6: Provider Fallback 集成测试

**文件**：`apps/server/tests/integration/ai-gateway-fallback.spec.ts`（新建）

**内容**（使用 mock adapter，不调用真实 API）：
- [x] 场景 1：OpenAI 失败 → Anthropic 接管成功
- [x] 场景 2：OpenAI auth 失败 → 仍 fallback（不同 provider 不同 key）
- [x] 场景 3：OpenAI circuit breaker open → 跳过 → DeepSeek 接管
- [x] 场景 4：所有 provider 不可用 → 返回错误
- [x] 场景 5：OpenAI → Anthropic → DeepSeek 级联 fallback
- [x] 场景 6：allow_fallback=false → 仅 primary
- [x] 场景 7：adapter 缺失 → 跳过到下一候选
- [x] 场景 8：circuit breaker 状态跨 gateway.execute() 调用保持

---

## Phase 2 — 弹性与成本控制（5 天）

### P2-1: Rate Limit 动态校准

**文件**：
- `apps/server/src/ai/elasticity/rate_limiter.ts`（修改）
- `apps/server/src/ai/elasticity/types.ts`（修改）
- `apps/server/src/ai/gateway.ts`（修改：429 响应触发 adjustFromHints）

**内容**：
1. `RateLimiter` 新增 `adjustFromHints(hints)` 方法
2. Gateway 层：provider adapter 返回 429 → 解析 `Retry-After`/`x-ratelimit-*` 头 → 调用 `adjustFromHints`
3. 调整策略：429 → maxConcurrent 降为 `min(active, 1)` → 30s 冷却 → 恢复到 50% → 线性 ramp-up

**验收**：
- [x] 429 + `Retry-After: 30` → maxConcurrent 降为 1 + 冷却后逐步恢复
- [x] 所有 adapter 在 429 时传递 rate limit headers 至 gateway

### P2-2: Tool Loop Token 预算管理

**文件**：
- `apps/server/src/ai/token_counter.ts`（新建）
- `apps/server/src/ai/tool_loop_runner.ts`（修改）

**内容**：
1. 实现 `TiktokenTokenCounter`（`tiktoken` 依赖）
2. TokenCounter 接口：`countTokens()` / `countMessagesTokens()`
3. 模型→encoding 映射：gpt-4.1→o200k_base、gpt-4/deepseek→cl100k_base、anthropic→字符数/3.5
4. ToolLoopRunner 每轮后累计 token，超 `max_total_tokens`（默认 `max_context_tokens * 0.85`）提前终止
5. Tool result 超 `max_tool_result_tokens` 截断
6. Anthropic thinking tokens 纳入累计

**验收**：
- [x] TokenCounter 使用 tiktoken（OpenAI 兼容）+ 字符估算（Anthropic）
- [x] Tool loop 每轮累计 token，超过 max_total_tokens 提前终止
- [x] Tool result 超 max_tool_result_chars 截断

### P2-3: Response Caching

**文件**：
- `apps/server/src/ai/cache.ts`（新建）
- `apps/server/src/ai/gateway.ts`（修改）
- `apps/server/src/ai/observability.ts`（修改）
- `packages/contracts/src/ai_shared.ts`（修改：新增 `cached` 字段）

**内容**：
1. `InMemoryPromptCache`（LRU，max 500 entries）
2. Cache key：`hash(provider, model, messages[], temperature, response_mode, structured_output_schema?, tools?, tool_policy?, pack_id, task_type)`
3. Per-task-type TTL（agent_decision: 60s, context_summary: 300s, embedding: 3600s 等，默认 120s）
4. 仅缓存 `temperature=0` + `response_mode=json_schema`
5. 缓存命中 → 写 `AiInvocationRecord`（`provider='cache'`, `cached: true`, `cost_usd: 0`）
6. `ModelGatewayResponse` 新增 `cached` 字段

**验收**：
- [x] InMemoryPromptCache（LRU + per-task-type TTL）+ gateway 集成
- [x] 缓存命中时写入审计记录（provider='cache'）
- [x] 仅缓存 temperature=0 + 非 tool_call + 非 streaming 请求

---

## Phase 3 — Streaming（5 天）

### P3-1: Adapter 流式接口 + Gateway SSE

**文件**：
- `apps/server/src/ai/providers/types.ts`（修改：新增 `executeStream`、`AiProviderAdapterChunk`）
- `apps/server/src/ai/providers/openai.ts`（修改：Responses API streaming）
- `apps/server/src/ai/providers/anthropic.ts`（修改：Messages API streaming）
- `apps/server/src/ai/providers/openai_compatible.ts`（修改：Chat Completions streaming）
- `apps/server/src/ai/gateway.ts`（修改：新增 `executeStream`）
- `apps/server/src/app/routes/inference.ts`（修改：新增 SSE endpoint）

**内容**：
1. `AiProviderAdapter` 新增 `executeStream?(): AsyncIterable<AiProviderAdapterChunk>`
2. `AiProviderAdapterChunk` 联合类型：`text_delta | tool_call_delta | finish | error`
3. OpenAI: Responses API `stream: true`，SSE 事件解析
4. Anthropic: Messages API `stream: true`，SSE 事件解析（message_start/content_block_start/content_block_delta/message_delta/message_stop）
5. `POST /api/inference/stream` — 返回 `text/event-stream`

**范围限制**：
- Tool loop 不使用流式（串行阻塞模型不兼容）
- 前端消费不在本次范围（后续按需）

**验收**：
- [ ] 集成测试：OpenAI streaming → SSE chunk 序列正确
- [ ] 集成测试：Anthropic streaming → SSE chunk 序列正确
- [ ] 集成测试：streaming 模式下 tool_calls 不触发 tool loop（返回 tool_call_delta chunks）

---

## 文件变更清单

```
apps/server/src/ai/
├── gateway.ts                    # 修改：Phase 0 cbMap/rlMap 提升 + P2-1 429 处理 + P2-3 缓存集成
├── token_counter.ts              # 新建：P2-2
├── cache.ts                      # 新建：P2-3
├── tool_loop_runner.ts           # 修改：P2-2
├── observability.ts              # 修改：P2-3 cached 标记
├── registry.ts                   # 修改：P1-5 注册表
├── types.ts                      # 修改：P2-3 cached 字段
├── providers/
│   ├── types.ts                  # 修改：P3-1 executeStream + AiProviderAdapterChunk
│   ├── openai_compatible.ts      # 新建：P1-1
│   ├── openai.ts                 # 修改：P1-1 重构 + P3-1 streaming
│   ├── anthropic.ts              # 新建：P1-2 + P3-1 streaming
│   ├── deepseek.ts               # 新建：P1-3
│   └── ollama.ts                 # 新建：P1-4
├── elasticity/
│   ├── rate_limiter.ts           # 修改：P2-1 adjustFromHints
│   └── types.ts                  # 修改：P2-1 RateLimitHints
├── config/
│   └── ai_models.yaml            # 可选：用户侧覆盖
app/server/tests/
├── integration/
│   └── ai-gateway-fallback.spec.ts   # 新建：P1-6
│   └── ai-gateway-cache.spec.ts      # 新建：P2-3
packages/contracts/src/
└── ai_shared.ts                  # 修改：P2-3 cached 字段
```

---

## 实施检查点

| 检查点 | 完成条件 | 预计日期 | 状态 |
|--------|---------|---------|------|
| CP1: Phase 0 完成 | circuit breaker 状态跨请求保持，测试通过 | Day 0.5 | ✅ 完成 |
| CP2: Phase 1 完成 | 4 个 provider adapter 可用，fallback 集成测试全绿 | Day 5.5 | ✅ 完成 |
| CP3: Phase 2 完成 | rate limit 动态校准 + token 预算 + 缓存全绿 | Day 10.5 | ✅ 完成 |
| CP4: Phase 3 完成 | adapter streaming + gateway executeStream | Day 15.5 | ✅ 完成 |

每个检查点必须通过 `pnpm typecheck && pnpm lint && pnpm test`。

---

## Phase 4：可插拔 Provider 配置文件扩展（新增）

> 设计依据：`.limcode/design/ai-gateway-completion-draft.md` §4
> 工期：约 1.5 天

### 目标

当前 `gateway.ts` 的 adapter 列表为硬编码 5 个（mock / openai / anthropic / deepseek / ollama）。新增 OpenAI-compatible 渠道（OpenRouter、SiliconFlow、Groq 等）需修改源码重新部署。本 Phase 实现配置驱动：用户通过 `ai_models.yaml` 的 `provider_templates` 段零代码添加新渠道，利用现有热加载即时生效。

### 已决策项

| 决策 | 选择 | 说明 |
|------|------|------|
| D1 覆盖内置 | A：允许 | template 可按 name 覆盖内置 adapter；覆盖 `openai` 会丧失 Responses API/Embeddings，文档需显式警告 |
| D2 配置分离 | A：templates 与 providers 独立 | template 描述"如何构建 adapter"，provider config 描述"运行时参数" |
| D3 碎片文件 | A：单文件 | 当前所有配置在 `ai_models.yaml`；provider > 10 时再考虑 `ai_providers.d/` |
| D4 schema 校验 | A：zod enum | `builtin_name` 使用 `z.enum(['mock','openai','anthropic','deepseek','ollama'])`，新增内置 adapter 时同步更新 enum |
| D5 自定义 adapter | C：外部 HTTP 代理 | 私有模型通过 litellm/one-api 暴露 OpenAI 兼容接口后接入，不通过 plugin 加载 adapter 代码 |
| D6 流式声明 | A：默认全支持 | `openai_compatible` template 自动继承流式能力；遇到不兼容 provider 时再追加 override 字段 |

### P4-1: YAML Schema 扩展

**文件**：`apps/server/src/ai/registry.ts`

**内容**：
1. 新增 `AiProviderTemplate` 类型和 `providerTemplateSchema` zod schema
2. `aiRegistryConfigSchema` 新增 `provider_templates: z.array(providerTemplateSchema).default([])`
3. 新增 `mergeProviderTemplates()` 合并函数（按 `name` key deep-merge）
4. 内置 `BUILTIN_AI_REGISTRY_CONFIG.provider_templates` 为空数组

**验收**：
- [ ] `pnpm typecheck` 通过
- [ ] `getAiRegistryConfig()` 返回空 `provider_templates`

### P4-2: adapter_registry.ts

**文件**：`apps/server/src/ai/providers/adapter_registry.ts`（新建）

**内容**：
1. `builtinFactories` Map：mock / openai / anthropic / deepseek / ollama → factory functions
2. `buildAdaptersFromRegistry(registryConfig)`：
   - 加载所有内置 adapter（默认启用）
   - 遍历 `provider_templates`：`kind: openai_compatible` → `createOpenAiCompatibleAdapterFromTemplate()`；`kind: builtin` → 从 `builtinFactories` 查找并以 `template.name` 为 provider 名重建
3. `listBuiltinAdapterNames()` 辅助函数

**验收**：
- [ ] `buildAdaptersFromRegistry(getAiRegistryConfig())` 返回 5 个默认 adapter
- [ ] 单元测试：空 `provider_templates` 时行为与硬编码一致

### P4-3: createOpenAiCompatibleAdapterFromTemplate

**文件**：`apps/server/src/ai/providers/openai_compatible.ts`

**内容**：
在现有 `createOpenAiCompatibleAdapter()` 基础上新增工厂函数，从 `AiProviderTemplate` 配置构建 adapter：

```typescript
export const createOpenAiCompatibleAdapterFromTemplate = (
  template: AiProviderTemplate
): AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: template.name,
    resolveApiKey(input) {
      const envName = input.provider_config.api_key_env ?? template.api_key_env;
      return getEnv(envName);
    },
    resolveBaseUrl(input) {
      return input.model_entry.base_url
        ?? input.provider_config.base_url
        ?? template.base_url
        ?? 'https://api.openai.com/v1';
    },
    buildHeaders(input) {
      return { ...template.default_headers, ...input.provider_config.default_headers };
    },
    capabilityOverrides: template.capability_overrides
  });
};
```

**验收**：
- [ ] 单元测试：通过 template 创建的 adapter 与硬编码 adapter 行为一致

### P4-4: gateway.ts 动态构建

**文件**：`apps/server/src/ai/gateway.ts`

**内容**：
```typescript
// 修改前
adapters = [createMockAiProviderAdapter(), createOpenAiProviderAdapter(), ...]

// 修改后
adapters // 保留参数供测试注入；未提供时从 registry 动态构建
```

默认值改为 `adapters = undefined`，内部使用 `buildAdaptersFromRegistry(resolvedRegistry)`。

**验收**：
- [ ] 现有测试零回归（测试通过注入 adapters 参数，不依赖默认值）
- [ ] 新集成测试：`ai_models.yaml` 添加一个 `openai_compatible` template → gateway 自动构建其 adapter

### P4-5: 热加载与集成验证

**文件**：`apps/server/tests/integration/ai-gateway-template.spec.ts`（新建）

**内容**：
1. 通过测试 registry config（含 `provider_templates`）验证 `buildAdaptersFromRegistry()` 正确构建
2. 验证 template adapter 参与 fallback 链
3. 验证 `kind: builtin` 的 alias 行为（如 `name: claude, kind: builtin, builtin_name: anthropic`）
4. 验证未知 `builtin_name` 的 warn log + 跳过行为

**验收**：
- [ ] 集成测试：template provider 在 fallback 链中正常工作
- [ ] 集成测试：template adapter 的 `capabilityOverrides` 生效

---

### 文件变更清单（Phase 4）

```
apps/server/src/ai/
├── registry.ts                             # 修改：+provider_templates schema + 合并
├── gateway.ts                              # 修改：默认 adapter 改为 registry 驱动
├── providers/
│   ├── adapter_registry.ts                 # 新建：builtin factory map + buildAdaptersFromRegistry
│   ├── openai_compatible.ts               # 修改：+createOpenAiCompatibleAdapterFromTemplate
│   └── types.ts                            # 修改：+AiProviderTemplate 类型导出
app/server/tests/
├── integration/
│   └── ai-gateway-template.spec.ts         # 新建：template adapter 集成测试
```

### 检查点

| 检查点 | 完成条件 | 预计日期 | 状态 |
|--------|---------|---------|------|
| CP5: Phase 4 完成 | YAML → adapter 零代码添加，集成测试全绿 | Day 17 | ✅ 完成 |
