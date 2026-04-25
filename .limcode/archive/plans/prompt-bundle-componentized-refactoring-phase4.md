## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义 PromptTokenizer 接口 + PromptBlock 新增 estimated_tokens/token_encoding 字段  `#P4-T1`
- [x] 实现 TiktokenTokenizerAdapter（encode/count/slice）  `#P4-T2`
- [x] 实现 walkPromptBlocksAsync 异步遍历 + TokenCounter.estimateTree 聚合  `#P4-T3`
- [x] PromptWorkflowProfile.defaults 新增 safety_margin_tokens + 集成到 budget trimming  `#P4-T4`
- [x] token_budget_trimmer 标记 @deprecated + 新增 tree-aware tree_token_budget_trimmer  `#P4-T5`
- [x] 编写单元测试（TiktokenAdapter + TokenCounter + 聚合一致性）  `#P4-T6`
- [x] 全量测试验证 + 编译检查  `#P4-T7`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Bundle 组件化重构 — Phase 4 实施计划

> 来源设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`

## 对齐决策

| 决策 | 结果 |
|------|------|
| Tokenizer 接口 | 纯计数，含 `count` / `encode` / `slice` |
| 实现顺序 | 先 tiktoken，后续扩展 HuggingFace WASM |
| 缓存层 | `PromptBlock.estimated_tokens` + `token_encoding` |
| 聚合 | Fragment 自动聚合子 Block |
| 旧 trimmer | 标记 `@deprecated`，保留回退 |
| safety_margin | `PromptWorkflowProfile.defaults.safety_margin_tokens`（默认 80） |
| async | 新增 `walkPromptBlocksAsync`，同步版本不动 |


---

## 任务清单

### P4-T1: 定义 PromptTokenizer 接口 + 扩展数据模型

**产出**:
- 新增 `apps/server/src/inference/prompt_tokenizer.ts`
- 修改 `apps/server/src/inference/prompt_block.ts`
- 修改 `apps/server/src/inference/prompt_fragment_v2.ts`

- [x] 定义 `PromptTokenizer` 接口：
  ```typescript
  export interface PromptTokenizer {
    readonly encodingName: string;
    encode(text: string): number[];
    count(text: string): number;
    slice(text: string, maxTokens: number): string;
  }
  ```
- [x] 定义 `PromptTokenCounter` 接口（Tree 级别聚合）：
  ```typescript
  export interface PromptTokenCounter {
    estimateTree(tree: PromptTree): Promise<TokenEstimate>;
  }
  export interface TokenEstimate {
    total_tokens: number;
    safety_margin: number;
    by_slot: Record<string, SlotTokenEstimate>;
  }
  export interface SlotTokenEstimate {
    total: number;
    by_fragment: Record<string, number>;
  }
  ```
- [x] `PromptBlock` 新增字段：
  ```typescript
  estimated_tokens?: number;
  token_encoding?: string;
  ```
- [x] `PromptFragmentV2` 新增字段：
  ```typescript
  estimated_tokens?: number;
  ```
- [x] 实现 `aggregateFragmentTokens(fragment)` 递归聚合
- [x] 实现 `aggregateTreeTokens(tree)` 遍历聚合

**验收**: 编译通过。

---

### P4-T2: 实现 TiktokenTokenizerAdapter

**产出**: `apps/server/src/inference/tokenizers/tiktoken_adapter.ts`

- [x] 安装依赖 `tiktoken`
- [x] 实现 `TiktokenTokenizerAdapter`
- [x] `slice` = encode → slice tokens → decode
- [x] 导出 `createTiktokenTokenizer()` 工厂
- [x] 导出 `getDefaultTokenizer()`

**验收**: 单元测试。

---

### P4-T3: 实现异步遍历 + TokenCounter

**产出**: 修改 `inference/prompt_tree.ts` + 续 `prompt_tokenizer.ts`

- [x] 新增 `walkPromptBlocksAsync`
- [x] 实现 `createPromptTokenCounter(tokenizer)`
- [x] `estimateTree` 内校验 `token_encoding` 一致性

**验收**: 单元测试。

---

### P4-T4: safety_margin_tokens 集成

**产出**: 修改 `context/workflow/types.ts` + `profiles.ts`

- [x] `PromptWorkflowProfile.defaults.safety_margin_tokens?: number`
- [x] 3 个内置 profile 默认值：agent-decision: 80，其余: 60

**验收**: 编译通过。

---

### P4-T5: tree-aware token budget trimmer

**产出**: 修改 `inference/processors/token_budget_trimmer.ts`

- [x] 旧函数 `@deprecated`
- [x] 新增 `createTreeTokenBudgetTrimmer(counter)`
- [x] 在 `prompt_processors.ts` 中新增 `PromptTreeProcessor` 接口

**验收**: 旧测试不变，新 trimmer 通过单元测试。

---

### P4-T6: 编写单元测试

**产出**: `tests/unit/prompt_tokenizer.spec.ts`

- [x] T1: `count('Hello world')` 正确
- [x] T2: `slice(..., 3)` 返回前 3 token 文本
- [x] T3: `estimateTree` 所有 Block 有 `estimated_tokens`
- [x] T4: `token_encoding` 一致性校验
- [x] T5: `aggregateFragmentTokens` 递归聚合
- [x] T6: `safety_margin_tokens` 计入 TokenEstimate

**验收**: 6 个测试全部通过。

---

### P4-T7: 全量测试验证

- [x] `pnpm add tiktoken` + `pnpm install`
- [x] 单元测试全部通过
- [x] 无回归

---

## 文件变更汇总

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `inference/prompt_tokenizer.ts` | 接口 + TokenCounter + 工厂 |
| 新增 | `inference/tokenizers/tiktoken_adapter.ts` | Tiktoken 实现 |
| 新增 | `tests/unit/prompt_tokenizer.spec.ts` | 6 个测试 |
| 修改 | `inference/prompt_block.ts` | `estimated_tokens`/`token_encoding` |
| 修改 | `inference/prompt_fragment_v2.ts` | `estimated_tokens` |
| 修改 | `inference/prompt_tree.ts` | `walkPromptBlocksAsync` |
| 修改 | `context/workflow/types.ts` | `safety_margin_tokens` |
| 修改 | `context/workflow/profiles.ts` | 3 profile 默认值 |
| 修改 | `inference/processors/token_budget_trimmer.ts` | @deprecated + tree 版本 |
| 修改 | `inference/prompt_processors.ts` | `PromptTreeProcessor` 接口 |
| 修改 | `package.json` | `tiktoken` 依赖 |

---

## 不在此 Phase 的内容

- ❌ HuggingFace tokenizers WASM 适配器
- ❌ Rust sidecar token 计数
- ❌ 删除旧 `token_budget_trimmer`
