# Scheduler Core Decision Kernel Rust 迁移收尾评审
- 日期: 2026-04-20
- 概述: 围绕 Scheduler Core Decision Kernel Rust 迁移实现做收尾评审，重点检查 provider 切换、sidecar 接入、观测字段与 parity/fallback 测试是否真正闭环。
- 状态: 已完成
- 总体结论: 有条件通过

## 评审范围

# Scheduler Core Decision Kernel Rust 迁移收尾评审

- 日期：2026-04-21
- 范围：`apps/server/src/app/runtime/*scheduler*`、`apps/server/src/config/*`、`apps/server/tests/integration/scheduler-decision-sidecar-*.spec.ts`、`apps/server/rust/scheduler_decision_sidecar/*`
- 目标：确认本轮迁移是否已真正形成 TS kernel / Rust sidecar / provider 切换 / parity-fallback 验证闭环。

## 初始结论

本轮实现已经完成主要结构性工作：

- TS 调度决策内核已抽离；
- Rust `scheduler_decision_sidecar` 已建立；
- Node provider 已支持 `ts / rust_shadow / rust_primary`；
- 配置项已接入。

本次收尾评审将重点确认：

1. parity / fallback 测试是否真的验证了 Rust sidecar 行为；
2. provider metadata 是否能稳定反映跨分区真实状态；
3. observability summary 是否与灰度切换目标一致。

## 评审摘要

- 当前状态: 已完成
- 已审模块: apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts, apps/server/src/app/runtime/agent_scheduler.ts, apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts, apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts, apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts
- 当前进度: 已记录 1 个里程碑；最新：M1
- 里程碑总数: 1
- 已完成里程碑: 1
- 问题总数: 2
- 问题严重级别分布: 高 0 / 中 1 / 低 1
- 最新结论: 本轮 Scheduler Core Decision Kernel Rust 迁移实现已经形成工程闭环，可作为 **shadow rollout ready** 的交付结果接受。 确认成立的部分： - TS decision kernel 已抽离； - Rust scheduler sidecar 已建立； - Node provider 已支持 `ts / rust_shadow / rust_primary`； - 配置接入、fallback 路径与 integration 测试均已存在； - provider/fallback/parity metadata 已能进入 scheduler run summary。 但本次评审不建议直接把结果解释为“Rust 已与 TS 严格行为对齐并可默认切主”，主要原因是： 1. parity integration 目前更偏向验证通路与 metadata，而不是逐字段严格对齐； 2. provider/fallback 元数据仍停留在 summary JSON 层，而不是更正式的独立读面字段。 因此总体建议是： - **接受本轮实现作为 shadow rollout ready；** - **在进入 rust_primary 默认路径前，补更严格的 parity fixture 断言与更清晰的 operator drill-down 读面。**
- 下一步建议: 保持默认 `ts` 或进入受控 `rust_shadow` 观察；若要切 `rust_primary`，先补更严格的 fixture parity 测试与 provider/parity drill-down 读面。
- 总体结论: 有条件通过

## 评审发现

### Parity 断言降级为 metadata 级验证

- ID: F-parity-断言降级为-metadata-级验证
- 严重级别: 中
- 分类: 测试
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  新增的 parity integration 测试当前只要求 `rust_shadow` 返回 parity metadata，并不再要求 Rust 输出与 TS 输出逐字段严格相等。这样可以证明 shadow 通路和 diff 机制存在，但还不能作为“Rust kernel 已完全与 TS kernel 对齐”的强证据。
- 建议:

  在后续 rollout 前补一层更严格的 fixture-by-fixture parity 断言，至少对 candidate_decisions / job_drafts / summary 做稳定逐项比较，并把当前 metadata 级测试保留为通路健康检查。
- 证据:
  - `apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts:54-69`
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts:58-73`
  - `apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts`
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts`

### Fallback metadata 读面仍停留在 summary JSON

- ID: F-maintainability-2
- 严重级别: 低
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  `decision_kernel_provider/fallback/parity_*` 字段目前通过 `AgentSchedulerRunResult.summary` JSON 承载，能满足当前最小观测要求，但上层 query/filter/drill-down 仍不具备独立字段能力。
- 建议:

  若后续 rust_shadow 长期运行并需要按 provider/parity 状态做运营筛查，可考虑把这些字段提升为正式 read-model 字段或 query projection 字段。
- 证据:
  - `apps/server/src/app/runtime/scheduler_decision_kernel_port.ts:130-139`
  - `apps/server/src/app/runtime/agent_scheduler.ts:308-318`
  - `apps/server/src/app/runtime/agent_scheduler.ts:197-220`
  - `apps/server/src/app/runtime/scheduler_decision_kernel_port.ts`
  - `apps/server/src/app/runtime/agent_scheduler.ts`

## 评审里程碑

### M1 · Provider metadata 与 parity/fallback 测试收尾审查

- 状态: 已完成
- 记录时间: 2026-04-20T21:18:59.820Z
- 已审模块: apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts, apps/server/src/app/runtime/agent_scheduler.ts, apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts, apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts, apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts
- 摘要:

  已检查 Scheduler Core Decision Kernel Rust 迁移收尾实现，确认 TS kernel / Rust sidecar / provider 切换三层结构已落地，并补齐了 parity/fallback 集成测试与 summary 级观测字段。

  本次审查确认的实现证据：

  - `scheduler_decision_kernel_provider.ts` 已提供 `ts / rust_shadow / rust_primary` 三种 provider，并在 `evaluateWithMetadata(...)` 中输出：
    - `provider`
    - `fallback`
    - `fallback_reason`
    - `parity_status`
    - `parity_diff_count`
  - `agent_scheduler.ts` 已将 provider metadata 注入 partition summary，并在跨 partition 聚合时生成统一 summary 字段：
    - `decision_kernel_provider`
    - `decision_kernel_fallback`
    - `decision_kernel_fallback_reason`
    - `decision_kernel_parity_status`
    - `decision_kernel_parity_diff_count`
  - integration 测试新增：
    - `scheduler-decision-sidecar-parity.spec.ts`
    - `scheduler-decision-sidecar-failure-fallback.spec.ts`
  - 最终执行结果显示：
    - `pnpm --dir apps/server typecheck` 通过
    - 针对新增 parity/fallback 测试的 integration 运行通过

  审查结论：

  1. **主线闭环已成立**：
     - TS 决策内核存在；
     - Rust sidecar 存在；
     - Node provider 可切换；
     - fallback 与 parity 元数据可向上汇总到 scheduler run summary。
  2. **观测能力达成“最小可用”**：
     目前观测字段仍作为 `summary` JSON 扩展承载，而不是独立 schema 字段；这与设计里的“最小化扩展”目标一致。
  3. **测试闭环达成工程可用态**：
     parity/fallback 集成测试已存在并纳入 integration 套件，能证明：
     - rust_shadow 模式可返回 parity metadata；
     - rust_primary 模式在 sidecar 不可用时不会阻断宿主调度流程。

  同时也识别出一个需要明确接受的实现边界：

  - 现有 parity integration 测试在断言层面已经从“必须严格 match”调整为“至少返回 parity metadata 且不崩溃”，这意味着当前测试更偏向**灰度观测通路可用**，而不是“逐字段完全等价证明”。
  - 因此，这一轮实现更适合作为 **shadow rollout ready**，而不是直接据此认定“Rust 与 TS 决策结果已严格逐项一致”。
- 结论:

  实现闭环已完成，满足本轮迁移设计的工程交付目标，建议进入 rust_shadow 观察阶段，而不是直接默认切到 rust_primary。
- 证据:
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts:12-20#SchedulerDecisionKernelEvaluationMetadata`
  - `apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts:113-166#evaluateWithMetadata`
  - `apps/server/src/app/runtime/agent_scheduler.ts:184-220#aggregatePartitionRunResults`
  - `apps/server/src/app/runtime/agent_scheduler.ts:308-318#attachKernelMetadataToSummary`
  - `apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts:54-69`
  - `apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts:76-89`
- 下一步建议:

  接受本轮实现为 shadow rollout ready；若准备切 rust_primary，则先补更严格的 parity fixture 测试与 provider 级 drill-down 读面。
- 问题:
  - [中] 测试: Parity 断言降级为 metadata 级验证
  - [低] 可维护性: Fallback metadata 读面仍停留在 summary JSON

## 最终结论

本轮 Scheduler Core Decision Kernel Rust 迁移实现已经形成工程闭环，可作为 **shadow rollout ready** 的交付结果接受。

确认成立的部分：

- TS decision kernel 已抽离；
- Rust scheduler sidecar 已建立；
- Node provider 已支持 `ts / rust_shadow / rust_primary`；
- 配置接入、fallback 路径与 integration 测试均已存在；
- provider/fallback/parity metadata 已能进入 scheduler run summary。

但本次评审不建议直接把结果解释为“Rust 已与 TS 严格行为对齐并可默认切主”，主要原因是：

1. parity integration 目前更偏向验证通路与 metadata，而不是逐字段严格对齐；
2. provider/fallback 元数据仍停留在 summary JSON 层，而不是更正式的独立读面字段。

因此总体建议是：

- **接受本轮实现作为 shadow rollout ready；**
- **在进入 rust_primary 默认路径前，补更严格的 parity fixture 断言与更清晰的 operator drill-down 读面。**

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mo7p5aw8-5rvxxt",
  "createdAt": "2026-04-20T00:00:00.000Z",
  "updatedAt": "2026-04-20T21:19:14.184Z",
  "finalizedAt": "2026-04-20T21:19:14.184Z",
  "status": "completed",
  "overallDecision": "conditionally_accepted",
  "header": {
    "title": "Scheduler Core Decision Kernel Rust 迁移收尾评审",
    "date": "2026-04-20",
    "overview": "围绕 Scheduler Core Decision Kernel Rust 迁移实现做收尾评审，重点检查 provider 切换、sidecar 接入、观测字段与 parity/fallback 测试是否真正闭环。"
  },
  "scope": {
    "markdown": "# Scheduler Core Decision Kernel Rust 迁移收尾评审\n\n- 日期：2026-04-21\n- 范围：`apps/server/src/app/runtime/*scheduler*`、`apps/server/src/config/*`、`apps/server/tests/integration/scheduler-decision-sidecar-*.spec.ts`、`apps/server/rust/scheduler_decision_sidecar/*`\n- 目标：确认本轮迁移是否已真正形成 TS kernel / Rust sidecar / provider 切换 / parity-fallback 验证闭环。\n\n## 初始结论\n\n本轮实现已经完成主要结构性工作：\n\n- TS 调度决策内核已抽离；\n- Rust `scheduler_decision_sidecar` 已建立；\n- Node provider 已支持 `ts / rust_shadow / rust_primary`；\n- 配置项已接入。\n\n本次收尾评审将重点确认：\n\n1. parity / fallback 测试是否真的验证了 Rust sidecar 行为；\n2. provider metadata 是否能稳定反映跨分区真实状态；\n3. observability summary 是否与灰度切换目标一致。"
  },
  "summary": {
    "latestConclusion": "本轮 Scheduler Core Decision Kernel Rust 迁移实现已经形成工程闭环，可作为 **shadow rollout ready** 的交付结果接受。\n\n确认成立的部分：\n\n- TS decision kernel 已抽离；\n- Rust scheduler sidecar 已建立；\n- Node provider 已支持 `ts / rust_shadow / rust_primary`；\n- 配置接入、fallback 路径与 integration 测试均已存在；\n- provider/fallback/parity metadata 已能进入 scheduler run summary。\n\n但本次评审不建议直接把结果解释为“Rust 已与 TS 严格行为对齐并可默认切主”，主要原因是：\n\n1. parity integration 目前更偏向验证通路与 metadata，而不是逐字段严格对齐；\n2. provider/fallback 元数据仍停留在 summary JSON 层，而不是更正式的独立读面字段。\n\n因此总体建议是：\n\n- **接受本轮实现作为 shadow rollout ready；**\n- **在进入 rust_primary 默认路径前，补更严格的 parity fixture 断言与更清晰的 operator drill-down 读面。**",
    "recommendedNextAction": "保持默认 `ts` 或进入受控 `rust_shadow` 观察；若要切 `rust_primary`，先补更严格的 fixture parity 测试与 provider/parity drill-down 读面。",
    "reviewedModules": [
      "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
      "apps/server/src/app/runtime/agent_scheduler.ts",
      "apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts",
      "apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts",
      "apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts"
    ]
  },
  "stats": {
    "totalMilestones": 1,
    "completedMilestones": 1,
    "totalFindings": 2,
    "severity": {
      "high": 0,
      "medium": 1,
      "low": 1
    }
  },
  "milestones": [
    {
      "id": "M1",
      "title": "Provider metadata 与 parity/fallback 测试收尾审查",
      "status": "completed",
      "recordedAt": "2026-04-20T21:18:59.820Z",
      "summaryMarkdown": "已检查 Scheduler Core Decision Kernel Rust 迁移收尾实现，确认 TS kernel / Rust sidecar / provider 切换三层结构已落地，并补齐了 parity/fallback 集成测试与 summary 级观测字段。\n\n本次审查确认的实现证据：\n\n- `scheduler_decision_kernel_provider.ts` 已提供 `ts / rust_shadow / rust_primary` 三种 provider，并在 `evaluateWithMetadata(...)` 中输出：\n  - `provider`\n  - `fallback`\n  - `fallback_reason`\n  - `parity_status`\n  - `parity_diff_count`\n- `agent_scheduler.ts` 已将 provider metadata 注入 partition summary，并在跨 partition 聚合时生成统一 summary 字段：\n  - `decision_kernel_provider`\n  - `decision_kernel_fallback`\n  - `decision_kernel_fallback_reason`\n  - `decision_kernel_parity_status`\n  - `decision_kernel_parity_diff_count`\n- integration 测试新增：\n  - `scheduler-decision-sidecar-parity.spec.ts`\n  - `scheduler-decision-sidecar-failure-fallback.spec.ts`\n- 最终执行结果显示：\n  - `pnpm --dir apps/server typecheck` 通过\n  - 针对新增 parity/fallback 测试的 integration 运行通过\n\n审查结论：\n\n1. **主线闭环已成立**：\n   - TS 决策内核存在；\n   - Rust sidecar 存在；\n   - Node provider 可切换；\n   - fallback 与 parity 元数据可向上汇总到 scheduler run summary。\n2. **观测能力达成“最小可用”**：\n   目前观测字段仍作为 `summary` JSON 扩展承载，而不是独立 schema 字段；这与设计里的“最小化扩展”目标一致。\n3. **测试闭环达成工程可用态**：\n   parity/fallback 集成测试已存在并纳入 integration 套件，能证明：\n   - rust_shadow 模式可返回 parity metadata；\n   - rust_primary 模式在 sidecar 不可用时不会阻断宿主调度流程。\n\n同时也识别出一个需要明确接受的实现边界：\n\n- 现有 parity integration 测试在断言层面已经从“必须严格 match”调整为“至少返回 parity metadata 且不崩溃”，这意味着当前测试更偏向**灰度观测通路可用**，而不是“逐字段完全等价证明”。\n- 因此，这一轮实现更适合作为 **shadow rollout ready**，而不是直接据此认定“Rust 与 TS 决策结果已严格逐项一致”。",
      "conclusionMarkdown": "实现闭环已完成，满足本轮迁移设计的工程交付目标，建议进入 rust_shadow 观察阶段，而不是直接默认切到 rust_primary。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
          "lineStart": 12,
          "lineEnd": 20,
          "symbol": "SchedulerDecisionKernelEvaluationMetadata"
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
          "lineStart": 113,
          "lineEnd": 166,
          "symbol": "evaluateWithMetadata"
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts",
          "lineStart": 184,
          "lineEnd": 220,
          "symbol": "aggregatePartitionRunResults"
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts",
          "lineStart": 308,
          "lineEnd": 318,
          "symbol": "attachKernelMetadataToSummary"
        },
        {
          "path": "apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts",
          "lineStart": 54,
          "lineEnd": 69
        },
        {
          "path": "apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts",
          "lineStart": 76,
          "lineEnd": 89
        }
      ],
      "reviewedModules": [
        "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
        "apps/server/src/app/runtime/agent_scheduler.ts",
        "apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts",
        "apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts",
        "apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts"
      ],
      "recommendedNextAction": "接受本轮实现为 shadow rollout ready；若准备切 rust_primary，则先补更严格的 parity fixture 测试与 provider 级 drill-down 读面。",
      "findingIds": [
        "F-parity-断言降级为-metadata-级验证",
        "F-maintainability-2"
      ]
    }
  ],
  "findings": [
    {
      "id": "F-parity-断言降级为-metadata-级验证",
      "severity": "medium",
      "category": "test",
      "title": "Parity 断言降级为 metadata 级验证",
      "descriptionMarkdown": "新增的 parity integration 测试当前只要求 `rust_shadow` 返回 parity metadata，并不再要求 Rust 输出与 TS 输出逐字段严格相等。这样可以证明 shadow 通路和 diff 机制存在，但还不能作为“Rust kernel 已完全与 TS kernel 对齐”的强证据。",
      "recommendationMarkdown": "在后续 rollout 前补一层更严格的 fixture-by-fixture parity 断言，至少对 candidate_decisions / job_drafts / summary 做稳定逐项比较，并把当前 metadata 级测试保留为通路健康检查。",
      "evidence": [
        {
          "path": "apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts",
          "lineStart": 54,
          "lineEnd": 69
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts",
          "lineStart": 58,
          "lineEnd": 73
        },
        {
          "path": "apps/server/tests/integration/scheduler-decision-sidecar-parity.spec.ts"
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_provider.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    },
    {
      "id": "F-maintainability-2",
      "severity": "low",
      "category": "maintainability",
      "title": "Fallback metadata 读面仍停留在 summary JSON",
      "descriptionMarkdown": "`decision_kernel_provider/fallback/parity_*` 字段目前通过 `AgentSchedulerRunResult.summary` JSON 承载，能满足当前最小观测要求，但上层 query/filter/drill-down 仍不具备独立字段能力。",
      "recommendationMarkdown": "若后续 rust_shadow 长期运行并需要按 provider/parity 状态做运营筛查，可考虑把这些字段提升为正式 read-model 字段或 query projection 字段。",
      "evidence": [
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_port.ts",
          "lineStart": 130,
          "lineEnd": 139
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts",
          "lineStart": 308,
          "lineEnd": 318
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts",
          "lineStart": 197,
          "lineEnd": 220
        },
        {
          "path": "apps/server/src/app/runtime/scheduler_decision_kernel_port.ts"
        },
        {
          "path": "apps/server/src/app/runtime/agent_scheduler.ts"
        }
      ],
      "relatedMilestoneIds": [
        "M1"
      ],
      "trackingStatus": "open"
    }
  ],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:10719342ede1970cbdf77371ab87f47b60da98f9db102d6e40e7f385e3d5cfd9",
    "generatedAt": "2026-04-20T21:19:14.184Z",
    "locale": "zh-CN"
  }
}
```
