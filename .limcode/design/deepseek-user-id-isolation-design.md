# DeepSeek user_id 隔离方案

## 背景

DeepSeek 开放平台上线了 `user_id` 隔离功能，主要收益：

- **KVCache 隔离**：同一 `user_id` 共享 KVCache，提升缓存命中率，减少推理延迟和费用
- **调度隔离**：高并发账号下每个 `user_id` 有独立并发限制
- **内容安全隔离**：按 `user_id` 粒度处理内容安全

项目当前使用 DeepSeek 作为 fallback model，所有请求走 OpenAI-compatible 协议（`endpoint_kind: chat_completions`），完全没有传递任何用户标识给 DeepSeek API。

## 目标

将 `identity_id`（每个 agent/identity 的唯一标识）作为 `user_id` 传递给 DeepSeek API，实现按 agent 粒度的 KVCache 隔离。同一 agent 的连续推理请求将命中 DeepSeek 侧的 KVCache，减少延迟和 token 消耗。

## 数据流分析

当前请求链路：

```
InferenceContext (含 actor_ref.identity_id)
  → buildAiTaskRequestFromInferenceContextV2()
    → AiTaskRequest.actor_ref (含 identity_id, world_pack_id, inference_id, ...)
      → AiProviderAdapterRequest.task_request.actor_ref  ← 数据在此，但无人消费
        → buildChatCompletionsRequestBody() → HTTP POST body  ← 无 user_id 字段
```

`identity_id` 已经存在于 `AiProviderAdapterRequest.task_request.actor_ref` 中，到达了 adapter 层，只是没有任何 adapter 使用它。

## 方案

### 改动点

**改动范围**：仅 adapter 层，不涉及 gateway、task_service、inference pipeline。

#### 1. `openai_compatible.ts` — 新增 `resolveUserId` 回调

在 `OpenAiCompatibleConfig` 新增可选字段：

```typescript
export interface OpenAiCompatibleConfig {
  // ... existing fields ...

  /** 从 adapter request 中解析 user_id，用于 DeepSeek KVCache 隔离等场景。
   *  返回 null/undefined 时不发送 user_id 字段。 */
  resolveUserId?(input: AiProviderAdapterRequest): string | null;
}
```

在 `buildChatCompletionsRequestBody` 中消费，函数签名需多传 `config`：

```typescript
const buildChatCompletionsRequestBody = (
  input: AiProviderAdapterRequest,
  config: OpenAiCompatibleConfig
) => {
  const body: Record<string, unknown> = {
    model: input.model_entry.model,
    messages: buildChatMessages(input.request.messages)
  };

  // ... existing logic ...

  const userId = config.resolveUserId?.(input);
  if (userId) {
    body.user_id = userId;
  }

  return body;
};
```

调用处同步更新（`performChatCompletionsRequest` 和 `performStreamingRequest` 中 `buildChatCompletionsRequestBody` 的调用）。

#### 2. `deepseek.ts` — 实现 `resolveUserId`

```typescript
export const createDeepSeekProviderAdapter = (): AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: 'deepseek',
    resolveApiKey(input) { /* unchanged */ },
    resolveBaseUrl(input) { /* unchanged */ },
    resolveUserId(input) {
      const actorRef = input.task_request.actor_ref;
      if (actorRef && typeof actorRef.identity_id === 'string') {
        return actorRef.identity_id;
      }
      return null;
    },
    capabilityOverrides: { /* unchanged */ }
  });
};
```

#### 3. `deepseek.ts` — 流式路径同样覆盖

`performStreamingRequest` 已复用 `buildChatCompletionsRequestBody`，改动自动生效。无需额外修改。

#### 4. Provider template 路径

`createOpenAiCompatibleAdapterFromTemplate` 是 YAML provider template 的工厂函数。当前项目未使用 DeepSeek 的 template 方式（builtin adapter 直接写死），暂不处理 template 路径的 `user_id` 透传。后续若有需要，在 `AiProviderTemplate` 的 `capability_overrides` 中加 `supportsUserId: true` 标记即可。

### 不改动的部分

- **Anthropic 适配器**：项目中 DeepSeek 模型配置为 `endpoint_kind: chat_completions`，不走 Anthropic 协议路径。不修改。
- **Gateway / task_service / types.ts**：`actor_ref` 已到达 adapter 层，无需上游改动。
- **非推理 AI 调用**：如果某个 AI 调用的 `AiTaskRequest.actor_ref` 为 null，`resolveUserId` 返回 null，不发送 `user_id`，此时 DeepSeek 将请求归入空 `user_id` 分组。这是合理行为。

### `user_id` 取值选择：`identity_id`

| 候选值 | 粒度 | 评估 |
|--------|------|------|
| `identity_id` | 每个 agent/identity | 同 agent 的 system prompt 和上下文结构高度稳定，KVCache 命中率最优 |
| `world_pack_id` | 每个世界包 | 粒度过粗，不同 agent 的 system prompt 差异大，缓存互相污染 |
| `inference_id` | 每次推理 | 每次都不同，缓存永远不命中，完全无效 |
| 复合 key（`pack:identity`） | 更细 | 无必要，`identity_id` 本身已是全局唯一（UUID） |

### DeepSeek API 字段位置

对于 OpenAI Chat Completions 协议，DeepSeek 指定的 `user_id` 放在 HTTP body 顶层：

```json
{
  "model": "deepseek-chat",
  "messages": [...],
  "user_id": "<identity_id>",
  "max_tokens": 1024
}
```

注意：这不是 OpenAI 标准的 `user` 字段（用于 abuse monitoring），而是 DeepSeek 扩展的 `user_id` 字段。

### 验证方式

1. 单元测试：验证 `buildChatCompletionsRequestBody` 在 `resolveUserId` 有/无返回值时正确设置/不设置 `user_id`
2. 集成测试：发送两次相同 agent 的推理请求，检查第二次请求的 `usage.cached_input_tokens` 是否 > 0（DeepSeek 响应中通过 `usage.prompt_tokens_details.cached_tokens` 返回）
3. 抓包验证：确认 HTTP body 中包含 `"user_id": "<identity_id>"`

## 影响范围

- `apps/server/src/ai/providers/openai_compatible.ts`：新增 `resolveUserId` 配置项，`buildChatCompletionsRequestBody` 签名变更
- `apps/server/src/ai/providers/deepseek.ts`：新增 `resolveUserId` 实现
- 其他 provider adapter 不受影响（`resolveUserId` 为 optional）
