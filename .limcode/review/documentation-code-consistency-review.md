# 项目文档与代码一致性审查
- 日期: 2026-04-10
- 概述: 对照当前代码实现，审查项目文档是否中立、客观、直接，并识别未同步或落后的内容。
- 状态: 已完成
- 总体结论: 需要后续跟进

## 评审范围

# 项目文档与代码一致性审查

- 日期：2025-02-14
- 范围：根目录说明、docs 目录文档、应用级说明与当前代码实现的一致性
- 方法：按模块逐步抽样并交叉核对文档与实现，及时记录审查里程碑与发现

## 评审摘要

- 当前状态: 已完成
- 已审模块: README.md, docs/API.md, docs/ARCH.md, docs/LOGIC.md, docs/THEME.md, docs/INDEX.md, docs/ENHANCEMENTS.md, apps/web/README.md, apps/server/src/app/routes, packages/contracts/src, .limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md, .limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md, apps/server/src/memory/blocks/*, apps/server/src/memory/long_term_store.ts, apps/server/src/context/source_registry.ts, apps/server/src/context/service.ts, apps/server/src/inference/prompt_fragments.ts, apps/server/src/packs/schema/constitution_schema.ts
- 当前进度: 已记录 2 个里程碑；最新：M2
- 里程碑总数: 2
- 已完成里程碑: 2
- 问题总数: 6
- 问题严重级别分布: 高 0 / 中 6 / 低 0
- 最新结论: 项目文档并未整体失真，但已经出现了明显的同步滞后，尤其是 API 文档与部分过程性 design/plan 文档。稳定文档（README、docs/*、apps/web/README.md）整体仍然较为中立、客观、直接，主要问题是少量旧说法未清理、少量新增接口未补入，以及共享 contracts 与服务端实际返回字段不同步。过程性文档（特别是 memory block 相关 design/plan）则明显更容易落后：它们仍保留实现前背景、目标态和部分未交付条目，已经不适合作为“当前代码现状”说明。建议后续将“稳定现状文档”和“历史设计/计划资产”明确分层，并优先修正文中自相矛盾与缺失的公开接口说明。
- 下一步建议: 优先更新 docs/API.md、README.md 与 packages/contracts 的 entity overview 契约；同时在 memory block 相关 design/plan 文档顶部补充“当前实现差异/已过时部分”说明，避免继续被误读为现状文档。
- 总体结论: 需要后续跟进

## 评审发现

### AiInvocation API 说明自相矛盾

- ID: F-aiinvocation-api-说明自相矛盾
- 严重级别: 中
- 分类: 文档
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  `docs/API.md` 前文已经把 `GET /api/inference/ai-invocations` 与 `GET /api/inference/ai-invocations/:id` 记为公开接口，但后文仍保留“当前阶段未公开 dedicated public query API”的旧表述。代码中这两个路由已真实注册，因此文档内部已发生自相矛盾，容易误导读者对公开边界的判断。
- 建议:

  删除旧结论，统一为“已公开只读观测接口，但不改变 inference 执行 public contract”。
- 证据:
  - `docs/API.md:216-220`
  - `docs/API.md:283-289`
  - `apps/server/src/app/routes/inference.ts:96-134`
  - `docs/API.md`
  - `apps/server/src/app/routes/inference.ts`

### 系统通知接口未进入稳定文档

- ID: F-系统通知接口未进入稳定文档
- 严重级别: 中
- 分类: 文档
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  服务端已提供系统通知列表与清空接口，且前端 `useSystemApi` 已实际调用它们；但 `docs/API.md` 与根 README 的实现概览尚未同步这组接口。这属于真实可用能力未文档化，降低了文档的完整性与直接性。
- 建议:

  在 `docs/API.md` 的 System 章节补入 `/api/system/notifications` 与 `/api/system/notifications/clear`，并在 README 当前实现概览中补一行系统通知/壳层通知观测说明。
- 证据:
  - `apps/server/src/app/routes/system.ts:18-29`
  - `apps/web/composables/api/useSystemApi.ts:86-98`
  - `README.md:101-108`
  - `apps/server/src/app/routes/system.ts`
  - `apps/web/composables/api/useSystemApi.ts`
  - `README.md`

### Entity overview 文档与共享 contracts 未完全同步

- ID: F-docs-3
- 严重级别: 中
- 分类: 文档
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  文档已经把 `context_governance` 与 `memory.latest_blocks` 视为当前 entity overview 的现状，但共享 `packages/contracts` 中的 `entityOverviewDataSchema` 仍只声明到 `memory.summary`，未覆盖这些新增字段。虽然服务端实际会返回这些字段，但公开契约与文档没有一起演进，说明文档同步链路不完整。
- 建议:

  若这些字段已被视为稳定读面，应补齐 `packages/contracts` 与相应文档；若仍属观察性扩展字段，应在文档中明确其稳定性级别。
- 证据:
  - `docs/API.md:119-150`
  - `packages/contracts/src/projections.ts:116-149`
  - `apps/server/src/app/services/agent.ts:511-585`
  - `docs/API.md`
  - `packages/contracts/src/projections.ts`
  - `apps/server/src/app/services/agent.ts`

### Memory Block 设计稿背景已过时

- ID: F-memory-block-设计稿背景已过时
- 严重级别: 中
- 分类: 文档
- 跟踪状态: 开放
- 相关里程碑: M2
- 说明:

  设计稿仍把 `LongTermMemoryStore` 描述为 noop，并把 `PromptFragment` 说成只具备基础字段；但代码已经引入 Prisma-backed `createPrismaLongTermMemoryStore()`，且 `PromptFragment` 已有 `anchor / placement_mode / depth / order`。因此该设计稿前半段不再客观反映“当前状态”，更接近实现前背景说明。
- 建议:

  将设计稿显式标注为“历史设计意图 / 已部分落地”，并在文首补一段“当前实现差异摘要”。
- 证据:
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md:17-28`
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md:420-442`
  - `apps/server/src/memory/long_term_store.ts:92-123`
  - `apps/server/src/inference/prompt_fragments.ts:20-33`
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md`
  - `apps/server/src/memory/long_term_store.ts`
  - `apps/server/src/inference/prompt_fragments.ts`

### 已完成计划仍保留未交付细项

- ID: F-已完成计划仍保留未交付细项
- 严重级别: 中
- 分类: 文档
- 跟踪状态: 开放
- 相关里程碑: M2
- 说明:

  实施计划的 TODO 已全部完成，但正文仍把 `memory_blocks_deleted`、`permission_filtered` 等更丰富的 trace/debug 细项写作本轮收口内容。当前 `ContextMemoryBlockDiagnostics` 只包含 `evaluated / inserted / delayed / cooling / retained / inactive`，与计划正文不一致，导致计划文档对实际交付范围的表达不够直接。
- 建议:

  在计划文档末尾增加“实际交付结果 / 未纳入交付的剩余项”回写段，或把未实现条目移入 backlog，而不是留在已完成计划正文中。
- 证据:
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md:8-12`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md:293-318`
  - `apps/server/src/context/types.ts:183-197`
  - `apps/server/src/context/source_registry.ts:136-145`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md`
  - `apps/server/src/context/types.ts`
  - `apps/server/src/context/source_registry.ts`

### 世界包声明能力在过程文档中被高估

- ID: F-世界包声明能力在过程文档中被高估
- 严重级别: 中
- 分类: 文档
- 跟踪状态: 开放
- 相关里程碑: M2
- 说明:

  设计稿与计划多处把“世界包开发者可声明 memory block 的触发与放置策略”作为本轮主线，但当前 pack schema/loader 并未暴露 memory block 配置入口；运行时 memory block 仍来自 kernel-side Prisma store。这使过程文档对当前 pack author 能力边界的描述偏乐观。
- 建议:

  若该能力尚未实现，应在 design/plan 中明确它仍是目标而非现状；若未来不做 pack-level 声明，应删除相关表述，避免误导。
- 证据:
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md:53-58`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md:38-40`
  - `apps/server/src/packs/schema/constitution_schema.ts:380-395`
  - `apps/server/src/context/source_registry.ts:101-149`
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md`
  - `apps/server/src/packs/schema/constitution_schema.ts`
  - `apps/server/src/context/source_registry.ts`

## 评审里程碑

### M1 · 稳定文档与公开接口实现交叉核对

- 状态: 已完成
- 记录时间: 2026-04-10T18:10:34.388Z
- 已审模块: README.md, docs/API.md, docs/ARCH.md, docs/LOGIC.md, docs/THEME.md, docs/INDEX.md, docs/ENHANCEMENTS.md, apps/web/README.md, apps/server/src/app/routes, packages/contracts/src
- 摘要:

  已完成对根目录 README、`docs/` 稳定文档、前端应用 README 与当前服务端/前端公开实现的第一轮对照。当前判断：整体文档风格大体保持中立、偏工程事实陈述，但存在少量已经落后或内部自相矛盾的内容，且有新增实现未进入稳定文档。重点发现包括：1）`docs/API.md` 仍保留“当前阶段没有公开 AiInvocationRecord 查询 API”的旧说法，但代码已公开 `GET /api/inference/ai-invocations` 与 `GET /api/inference/ai-invocations/:id`；2）系统通知读写接口 `/api/system/notifications` 与 `/api/system/notifications/clear` 已被前端实际消费，但未进入 `docs/API.md` 与根 README 的实现概览；3）文档已把 entity overview 的 `context_governance` / `memory.latest_blocks` 当作现状描述，但共享 contracts 中对应 projection schema 仍未完整反映这些字段，说明“文档—共享契约—实现”之间存在同步滞后。
- 结论:

  稳定文档总体可读，但并非完全与代码同步；API 文档中至少有一处旧结论未删除，且有新增系统通知接口未同步。
- 证据:
  - `docs/API.md:216-220`
  - `docs/API.md:283-289`
  - `apps/server/src/app/routes/inference.ts:96-134`
  - `apps/server/src/app/routes/system.ts:18-29`
  - `apps/web/composables/api/useSystemApi.ts:86-98`
  - `docs/API.md:119-150`
  - `packages/contracts/src/projections.ts:116-149`
  - `apps/server/src/app/services/agent.ts:511-585`
- 下一步建议:

  继续核对当前活跃的 design/plan 文档，重点检查 memory block / long memory / prompt workflow 相关设计资产是否仍符合现有实现边界。
- 问题:
  - [中] 文档: AiInvocation API 说明自相矛盾
  - [中] 文档: 系统通知接口未进入稳定文档
  - [中] 文档: Entity overview 文档与共享 contracts 未完全同步

### M2 · Memory Block 设计/计划文档与现实现状核对

- 状态: 已完成
- 记录时间: 2026-04-10T18:26:21.894Z
- 已审模块: .limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md, .limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md, apps/server/src/memory/blocks/*, apps/server/src/memory/long_term_store.ts, apps/server/src/context/source_registry.ts, apps/server/src/context/service.ts, apps/server/src/inference/prompt_fragments.ts, apps/server/src/packs/schema/constitution_schema.ts
- 摘要:

  已对当前活跃的 `memory-block-triggered-long-memory-and-prompt-workflow` 设计稿与实施计划进行代码对照。结论是：这两份过程性文档已经明显落后于实现，不再适合作为“当前现状”阅读入口。主要偏差有三类：1）设计稿背景段仍把 `LongTermMemoryStore` 视为 noop、把 `PromptFragment` 视为只有基础字段的旧结构，但代码已经接入 Prisma-backed long-term compatibility store，并把 `anchor / placement_mode / depth / order` 升为一等字段；2）计划文档 TODO 已全部勾选，但正文 Phase E 仍保留一批未真正落地的 trace/debug 细项，例如 `deleted`、`permission_filtered` 等 memory block diagnostics 字段；3）设计/计划多处把“世界包开发者可声明 memory block 行为”写成主线目标，但当前 pack schema 与 loader 并未暴露 memory block 声明入口，运行时仍是 kernel-side Prisma store 主导。这意味着过程文档已经不能中立地描述当前交付边界，更像实现前假设与目标集合。
- 结论:

  Memory Block 相关 design/plan 文档存在明显陈旧化：适合作为历史设计意图参考，不适合作为当前代码现状说明。
- 证据:
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md:17-28`
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md:420-442`
  - `apps/server/src/memory/long_term_store.ts:92-123`
  - `apps/server/src/inference/prompt_fragments.ts:20-33`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md:8-12`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md:293-318`
  - `apps/server/src/context/types.ts:183-197`
  - `apps/server/src/context/source_registry.ts:136-145`
  - `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md:53-58`
  - `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md:38-40`
  - `apps/server/src/packs/schema/constitution_schema.ts:380-395`
  - `apps/server/src/context/source_registry.ts:101-149`
- 下一步建议:

  收束最终结论，按“稳定文档”和“过程文档”两类分别给出可信度判断与建议更新清单。
- 问题:
  - [中] 文档: Memory Block 设计稿背景已过时
  - [中] 文档: 已完成计划仍保留未交付细项
  - [中] 文档: 世界包声明能力在过程文档中被高估

## 最终结论

项目文档并未整体失真，但已经出现了明显的同步滞后，尤其是 API 文档与部分过程性 design/plan 文档。稳定文档（README、docs/*、apps/web/README.md）整体仍然较为中立、客观、直接，主要问题是少量旧说法未清理、少量新增接口未补入，以及共享 contracts 与服务端实际返回字段不同步。过程性文档（特别是 memory block 相关 design/plan）则明显更容易落后：它们仍保留实现前背景、目标态和部分未交付条目，已经不适合作为“当前代码现状”说明。建议后续将“稳定现状文档”和“历史设计/计划资产”明确分层，并优先修正文中自相矛盾与缺失的公开接口说明。

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mnt7i4n3-1uljpf",
  "createdAt": "2026-04-10T00:00:00.000Z",
  "updatedAt": "2026-04-10T18:26:52.843Z",
  "finalizedAt": "2026-04-10T18:26:52.843Z",
  "status": "completed",
  "overallDecision": "needs_follow_up",
  "header": {
    "title": "项目文档与代码一致性审查",
    "date": "2026-04-10",
    "overview": "对照当前代码实现，审查项目文档是否中立、客观、直接，并识别未同步或落后的内容。"
  },
  "scope": {
    "markdown": "# 项目文档与代码一致性审查\n\n- 日期：2025-02-14\n- 范围：根目录说明、docs 目录文档、应用级说明与当前代码实现的一致性\n- 方法：按模块逐步抽样并交叉核对文档与实现，及时记录审查里程碑与发现"
  },
  "summary": {
    "latestConclusion": "项目文档并未整体失真，但已经出现了明显的同步滞后，尤其是 API 文档与部分过程性 design/plan 文档。稳定文档（README、docs/*、apps/web/README.md）整体仍然较为中立、客观、直接，主要问题是少量旧说法未清理、少量新增接口未补入，以及共享 contracts 与服务端实际返回字段不同步。过程性文档（特别是 memory block 相关 design/plan）则明显更容易落后：它们仍保留实现前背景、目标态和部分未交付条目，已经不适合作为“当前代码现状”说明。建议后续将“稳定现状文档”和“历史设计/计划资产”明确分层，并优先修正文中自相矛盾与缺失的公开接口说明。",
    "recommendedNextAction": "优先更新 docs/API.md、README.md 与 packages/contracts 的 entity overview 契约；同时在 memory block 相关 design/plan 文档顶部补充“当前实现差异/已过时部分”说明，避免继续被误读为现状文档。",
    "reviewedModules": [
      "README.md",
      "docs/API.md",
      "docs/ARCH.md",
      "docs/LOGIC.md",
      "docs/THEME.md",
      "docs/INDEX.md",
      "docs/ENHANCEMENTS.md",
      "apps/web/README.md",
      "apps/server/src/app/routes",
      "packages/contracts/src",
      ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
      ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
      "apps/server/src/memory/blocks/*",
      "apps/server/src/memory/long_term_store.ts",
      "apps/server/src/context/source_registry.ts",
      "apps/server/src/context/service.ts",
      "apps/server/src/inference/prompt_fragments.ts",
      "apps/server/src/packs/schema/constitution_schema.ts"
    ]
  },
  "stats": {
    "totalMilestones": 2,
    "completedMilestones": 2,
    "totalFindings": 6,
    "severity": {
      "high": 0,
      "medium": 6,
      "low": 0
    }
  },
  "milestones": [
    {
      "id": "M1",
      "title": "稳定文档与公开接口实现交叉核对",
      "status": "completed",
      "recordedAt": "2026-04-10T18:10:34.388Z",
      "summaryMarkdown": "已完成对根目录 README、`docs/` 稳定文档、前端应用 README 与当前服务端/前端公开实现的第一轮对照。当前判断：整体文档风格大体保持中立、偏工程事实陈述，但存在少量已经落后或内部自相矛盾的内容，且有新增实现未进入稳定文档。重点发现包括：1）`docs/API.md` 仍保留“当前阶段没有公开 AiInvocationRecord 查询 API”的旧说法，但代码已公开 `GET /api/inference/ai-invocations` 与 `GET /api/inference/ai-invocations/:id`；2）系统通知读写接口 `/api/system/notifications` 与 `/api/system/notifications/clear` 已被前端实际消费，但未进入 `docs/API.md` 与根 README 的实现概览；3）文档已把 entity overview 的 `context_governance` / `memory.latest_blocks` 当作现状描述，但共享 contracts 中对应 projection schema 仍未完整反映这些字段，说明“文档—共享契约—实现”之间存在同步滞后。",
      "conclusionMarkdown": "稳定文档总体可读，但并非完全与代码同步；API 文档中至少有一处旧结论未删除，且有新增系统通知接口未同步。",
      "evidence": [
        {
          "path": "docs/API.md",
          "lineStart": 216,
          "lineEnd": 220
        },
        {
          "path": "docs/API.md",
          "lineStart": 283,
          "lineEnd": 289
        },
        {
          "path": "apps/server/src/app/routes/inference.ts",
          "lineStart": 96,
          "lineEnd": 134
        },
        {
          "path": "apps/server/src/app/routes/system.ts",
          "lineStart": 18,
          "lineEnd": 29
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts",
          "lineStart": 86,
          "lineEnd": 98
        },
        {
          "path": "docs/API.md",
          "lineStart": 119,
          "lineEnd": 150
        },
        {
          "path": "packages/contracts/src/projections.ts",
          "lineStart": 116,
          "lineEnd": 149
        },
        {
          "path": "apps/server/src/app/services/agent.ts",
          "lineStart": 511,
          "lineEnd": 585
        }
      ],
      "reviewedModules": [
        "README.md",
        "docs/API.md",
        "docs/ARCH.md",
        "docs/LOGIC.md",
        "docs/THEME.md",
        "docs/INDEX.md",
        "docs/ENHANCEMENTS.md",
        "apps/web/README.md",
        "apps/server/src/app/routes",
        "packages/contracts/src"
      ],
      "recommendedNextAction": "继续核对当前活跃的 design/plan 文档，重点检查 memory block / long memory / prompt workflow 相关设计资产是否仍符合现有实现边界。",
      "findingIds": [
        "F-aiinvocation-api-说明自相矛盾",
        "F-系统通知接口未进入稳定文档",
        "F-docs-3"
      ]
    },
    {
      "id": "M2",
      "title": "Memory Block 设计/计划文档与现实现状核对",
      "status": "completed",
      "recordedAt": "2026-04-10T18:26:21.894Z",
      "summaryMarkdown": "已对当前活跃的 `memory-block-triggered-long-memory-and-prompt-workflow` 设计稿与实施计划进行代码对照。结论是：这两份过程性文档已经明显落后于实现，不再适合作为“当前现状”阅读入口。主要偏差有三类：1）设计稿背景段仍把 `LongTermMemoryStore` 视为 noop、把 `PromptFragment` 视为只有基础字段的旧结构，但代码已经接入 Prisma-backed long-term compatibility store，并把 `anchor / placement_mode / depth / order` 升为一等字段；2）计划文档 TODO 已全部勾选，但正文 Phase E 仍保留一批未真正落地的 trace/debug 细项，例如 `deleted`、`permission_filtered` 等 memory block diagnostics 字段；3）设计/计划多处把“世界包开发者可声明 memory block 行为”写成主线目标，但当前 pack schema 与 loader 并未暴露 memory block 声明入口，运行时仍是 kernel-side Prisma store 主导。这意味着过程文档已经不能中立地描述当前交付边界，更像实现前假设与目标集合。",
      "conclusionMarkdown": "Memory Block 相关 design/plan 文档存在明显陈旧化：适合作为历史设计意图参考，不适合作为当前代码现状说明。",
      "evidence": [
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
          "lineStart": 17,
          "lineEnd": 28
        },
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
          "lineStart": 420,
          "lineEnd": 442
        },
        {
          "path": "apps/server/src/memory/long_term_store.ts",
          "lineStart": 92,
          "lineEnd": 123
        },
        {
          "path": "apps/server/src/inference/prompt_fragments.ts",
          "lineStart": 20,
          "lineEnd": 33
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
          "lineStart": 8,
          "lineEnd": 12
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
          "lineStart": 293,
          "lineEnd": 318
        },
        {
          "path": "apps/server/src/context/types.ts",
          "lineStart": 183,
          "lineEnd": 197
        },
        {
          "path": "apps/server/src/context/source_registry.ts",
          "lineStart": 136,
          "lineEnd": 145
        },
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
          "lineStart": 53,
          "lineEnd": 58
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
          "lineStart": 38,
          "lineEnd": 40
        },
        {
          "path": "apps/server/src/packs/schema/constitution_schema.ts",
          "lineStart": 380,
          "lineEnd": 395
        },
        {
          "path": "apps/server/src/context/source_registry.ts",
          "lineStart": 101,
          "lineEnd": 149
        }
      ],
      "reviewedModules": [
        ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
        ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
        "apps/server/src/memory/blocks/*",
        "apps/server/src/memory/long_term_store.ts",
        "apps/server/src/context/source_registry.ts",
        "apps/server/src/context/service.ts",
        "apps/server/src/inference/prompt_fragments.ts",
        "apps/server/src/packs/schema/constitution_schema.ts"
      ],
      "recommendedNextAction": "收束最终结论，按“稳定文档”和“过程文档”两类分别给出可信度判断与建议更新清单。",
      "findingIds": [
        "F-memory-block-设计稿背景已过时",
        "F-已完成计划仍保留未交付细项",
        "F-世界包声明能力在过程文档中被高估"
      ]
    }
  ],
  "findings": [
    {
      "id": "F-aiinvocation-api-说明自相矛盾",
      "severity": "medium",
      "category": "docs",
      "title": "AiInvocation API 说明自相矛盾",
      "descriptionMarkdown": "`docs/API.md` 前文已经把 `GET /api/inference/ai-invocations` 与 `GET /api/inference/ai-invocations/:id` 记为公开接口，但后文仍保留“当前阶段未公开 dedicated public query API”的旧表述。代码中这两个路由已真实注册，因此文档内部已发生自相矛盾，容易误导读者对公开边界的判断。",
      "recommendationMarkdown": "删除旧结论，统一为“已公开只读观测接口，但不改变 inference 执行 public contract”。",
      "evidence": [
        {
          "path": "docs/API.md",
          "lineStart": 216,
          "lineEnd": 220
        },
        {
          "path": "docs/API.md",
          "lineStart": 283,
          "lineEnd": 289
        },
        {
          "path": "apps/server/src/app/routes/inference.ts",
          "lineStart": 96,
          "lineEnd": 134
        },
        {
          "path": "docs/API.md"
        },
        {
          "path": "apps/server/src/app/routes/inference.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-系统通知接口未进入稳定文档",
      "severity": "medium",
      "category": "docs",
      "title": "系统通知接口未进入稳定文档",
      "descriptionMarkdown": "服务端已提供系统通知列表与清空接口，且前端 `useSystemApi` 已实际调用它们；但 `docs/API.md` 与根 README 的实现概览尚未同步这组接口。这属于真实可用能力未文档化，降低了文档的完整性与直接性。",
      "recommendationMarkdown": "在 `docs/API.md` 的 System 章节补入 `/api/system/notifications` 与 `/api/system/notifications/clear`，并在 README 当前实现概览中补一行系统通知/壳层通知观测说明。",
      "evidence": [
        {
          "path": "apps/server/src/app/routes/system.ts",
          "lineStart": 18,
          "lineEnd": 29
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts",
          "lineStart": 86,
          "lineEnd": 98
        },
        {
          "path": "README.md",
          "lineStart": 101,
          "lineEnd": 108
        },
        {
          "path": "apps/server/src/app/routes/system.ts"
        },
        {
          "path": "apps/web/composables/api/useSystemApi.ts"
        },
        {
          "path": "README.md"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-docs-3",
      "severity": "medium",
      "category": "docs",
      "title": "Entity overview 文档与共享 contracts 未完全同步",
      "descriptionMarkdown": "文档已经把 `context_governance` 与 `memory.latest_blocks` 视为当前 entity overview 的现状，但共享 `packages/contracts` 中的 `entityOverviewDataSchema` 仍只声明到 `memory.summary`，未覆盖这些新增字段。虽然服务端实际会返回这些字段，但公开契约与文档没有一起演进，说明文档同步链路不完整。",
      "recommendationMarkdown": "若这些字段已被视为稳定读面，应补齐 `packages/contracts` 与相应文档；若仍属观察性扩展字段，应在文档中明确其稳定性级别。",
      "evidence": [
        {
          "path": "docs/API.md",
          "lineStart": 119,
          "lineEnd": 150
        },
        {
          "path": "packages/contracts/src/projections.ts",
          "lineStart": 116,
          "lineEnd": 149
        },
        {
          "path": "apps/server/src/app/services/agent.ts",
          "lineStart": 511,
          "lineEnd": 585
        },
        {
          "path": "docs/API.md"
        },
        {
          "path": "packages/contracts/src/projections.ts"
        },
        {
          "path": "apps/server/src/app/services/agent.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-memory-block-设计稿背景已过时",
      "severity": "medium",
      "category": "docs",
      "title": "Memory Block 设计稿背景已过时",
      "descriptionMarkdown": "设计稿仍把 `LongTermMemoryStore` 描述为 noop，并把 `PromptFragment` 说成只具备基础字段；但代码已经引入 Prisma-backed `createPrismaLongTermMemoryStore()`，且 `PromptFragment` 已有 `anchor / placement_mode / depth / order`。因此该设计稿前半段不再客观反映“当前状态”，更接近实现前背景说明。",
      "recommendationMarkdown": "将设计稿显式标注为“历史设计意图 / 已部分落地”，并在文首补一段“当前实现差异摘要”。",
      "evidence": [
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
          "lineStart": 17,
          "lineEnd": 28
        },
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
          "lineStart": 420,
          "lineEnd": 442
        },
        {
          "path": "apps/server/src/memory/long_term_store.ts",
          "lineStart": 92,
          "lineEnd": 123
        },
        {
          "path": "apps/server/src/inference/prompt_fragments.ts",
          "lineStart": 20,
          "lineEnd": 33
        },
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md"
        },
        {
          "path": "apps/server/src/memory/long_term_store.ts"
        },
        {
          "path": "apps/server/src/inference/prompt_fragments.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M2"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-已完成计划仍保留未交付细项",
      "severity": "medium",
      "category": "docs",
      "title": "已完成计划仍保留未交付细项",
      "descriptionMarkdown": "实施计划的 TODO 已全部完成，但正文仍把 `memory_blocks_deleted`、`permission_filtered` 等更丰富的 trace/debug 细项写作本轮收口内容。当前 `ContextMemoryBlockDiagnostics` 只包含 `evaluated / inserted / delayed / cooling / retained / inactive`，与计划正文不一致，导致计划文档对实际交付范围的表达不够直接。",
      "recommendationMarkdown": "在计划文档末尾增加“实际交付结果 / 未纳入交付的剩余项”回写段，或把未实现条目移入 backlog，而不是留在已完成计划正文中。",
      "evidence": [
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
          "lineStart": 8,
          "lineEnd": 12
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
          "lineStart": 293,
          "lineEnd": 318
        },
        {
          "path": "apps/server/src/context/types.ts",
          "lineStart": 183,
          "lineEnd": 197
        },
        {
          "path": "apps/server/src/context/source_registry.ts",
          "lineStart": 136,
          "lineEnd": 145
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md"
        },
        {
          "path": "apps/server/src/context/types.ts"
        },
        {
          "path": "apps/server/src/context/source_registry.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M2"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-世界包声明能力在过程文档中被高估",
      "severity": "medium",
      "category": "docs",
      "title": "世界包声明能力在过程文档中被高估",
      "descriptionMarkdown": "设计稿与计划多处把“世界包开发者可声明 memory block 的触发与放置策略”作为本轮主线，但当前 pack schema/loader 并未暴露 memory block 配置入口；运行时 memory block 仍来自 kernel-side Prisma store。这使过程文档对当前 pack author 能力边界的描述偏乐观。",
      "recommendationMarkdown": "若该能力尚未实现，应在 design/plan 中明确它仍是目标而非现状；若未来不做 pack-level 声明，应删除相关表述，避免误导。",
      "evidence": [
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md",
          "lineStart": 53,
          "lineEnd": 58
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md",
          "lineStart": 38,
          "lineEnd": 40
        },
        {
          "path": "apps/server/src/packs/schema/constitution_schema.ts",
          "lineStart": 380,
          "lineEnd": 395
        },
        {
          "path": "apps/server/src/context/source_registry.ts",
          "lineStart": 101,
          "lineEnd": 149
        },
        {
          "path": ".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md"
        },
        {
          "path": ".limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md"
        },
        {
          "path": "apps/server/src/packs/schema/constitution_schema.ts"
        },
        {
          "path": "apps/server/src/context/source_registry.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M2"
      ],
      "trackingStatus": "open"
    }
  ],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:9021b98900b6e3235d34617df50ee4ed31286c60d68843b24a80a3ea6caf636e",
    "generatedAt": "2026-04-10T18:26:52.843Z",
    "locale": "zh-CN"
  }
}
```
