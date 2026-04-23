<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"review","path":".limcode/review/文档体系与权责边界审查.md","contentHash":"sha256:19424d4f87c96f45e484ac07d8347bab31e634044a13188430e72b2fc1b49843"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 创建 .limcode/archive 目录结构，并冻结 active/reference/completed/historical 四类资产清单  `#p1`
- [x] 迁移 completed 类 design 资产到 .limcode/archive/design/  `#p2`
- [x] 迁移 historical 类 design 草案到 .limcode/archive/historical/design/  `#p3`
- [x] 迁移 completed 类 plans/review 资产到 .limcode/archive/plans/ 与 .limcode/archive/review/  `#p4`
- [x] 核对 world-pack-post-governance-closure.plan.md 与 tmp/rust-migration-status-matrix-and-exit-criteria.md 的处理结论  `#p5`
- [x] 更新文档治理说明，使 README/docs/INDEX/必要说明反映新的归档分层规则  `#p6`
- [x] 验证 activeArtifacts、文档引用与 .limcode 目录可发现性未被破坏  `#p7`
<!-- LIMCODE_TODO_LIST_END -->

# .limcode 过程资产归档与治理整理实施计划

## 1. 背景

当前仓库的代码主线与稳定文档整体对齐，但 `.limcode/` 内的过程资产已经出现典型的“活跃资产、已完成资产、历史草案混放”问题：

- 当前真正仍在活跃使用的文档数量较少；
- 多数 design / plan 已完成其实施使命；
- 少数早期设计草案已经被 `docs/*`、后续设计或实际实现吸收；
- `tmp/` 下还存在疑似重复文件，不应长期作为正式资产区。

因此，本轮工作的目标不是重写 `.limcode` 全部内容，而是：

> 在尽量不破坏现有引用关系的前提下，为 `.limcode` 建立最小但清晰的分层，把“当前活跃工作台”与“历史/已完成资产”区分开。

---

## 2. 目标

1. 为 `.limcode` 建立清晰的归档结构：`archive/` + `historical/`。
2. 将已完成实施的 design / plan / review 迁出当前活跃层。
3. 将明显属于历史草案的 design 单独归入 historical 层。
4. 保留当前仍在使用、仍被 `progress.md` 或稳定文档引用的 active/reference 资产在原位。
5. 清理 `tmp/` 中的疑似重复文档。
6. 补齐最小文档治理说明，避免后续再次堆积。

---

## 3. 非目标

本轮不做以下事情：

- 不重写各设计文档正文；
- 不改动当前 `progress.md` 的 activeArtifacts 指向，除非发现错误；
- 不把所有参考型文档都迁走；
- 不把 `.limcode` 重构成复杂系统（例如单独引入数据库、索引器或自动归档器）；
- 不顺带改动代码实现或测试逻辑。

---

## 4. 实施原则

### 4.1 最小破坏原则

优先新增 `.limcode/archive/**`，而不是直接把根层 `design/ plans/ review/` 改名为 `active/`。这样可以：

- 保持现有大部分文档引用不失效；
- 保留当前 `.limcode/design/`、`.limcode/plans/`、`.limcode/review/` 作为“活跃/参考层”；
- 只迁出确认完成或确认历史化的资产。

### 4.2 活跃与参考分开看待

并不是所有“不应归档”的文件都属于当前活跃主线。实施时应区分：

- **活跃 active**：当前 `progress.md` 仍在使用，或本轮仍在推进；
- **参考 reference**：不属当前主线，但仍可能被 `docs/*` 或后续工作直接引用；
- **已完成 completed**：实施已完成，迁入 `archive/`；
- **历史草案 historical**：被后续方案或稳定文档吸收，迁入 `archive/historical/`。

### 4.3 先分类，再移动

实施顺序必须是：

1. 先冻结分类清单；
2. 再批量移动 completed / historical；
3. 最后处理待确认项与文档说明更新。

---

## 5. 目标目录结构

本轮建议采用最小调整后的目录结构：

```text
.limcode/
  design/
  plans/
  review/
  archive/
    design/
    plans/
    review/
    historical/
      design/
  tmp/
  progress.md
```

如后续需要，再评估是否把根层 `design/plans/review` 明确重命名或语义升级为 `active/`。

---

## 6. 资产分类清单

## 6.1 保留活跃（原位保留）

### 顶层
- `.limcode/progress.md`

### design
- `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`
- `.limcode/design/rust-ts-host-runtime-kernel-boundary-and-clock-projection-design.md`

### plans
- `.limcode/plans/rust-ts-host-runtime-kernel-boundary-and-clock-projection-implementation.plan.md`

### review
- `.limcode/review/rust-module-migration-gap-review.md`

### 保留理由
- 当前 `progress.md` 的 activeArtifacts 仍直接引用；
- 属于当前最新一轮收口工作的事实基础；
- 短期内仍可能被继续推进或复核。

---

## 6.2 保留参考（原位保留，但不视为当前主线）

### design
- `.limcode/design/pack-local-plugin-unified-management-design.md`
- `.limcode/design/world-pack-unified-governance-framework-design.md`

### plans
- `.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`

### review
- `.limcode/review/multi-pack-runtime-experimental-assessment.md`
- `.limcode/review/rust-migration-compatibility-debt-assessment.md`

### 保留理由
- 仍被 `docs/capabilities/*` 或后续治理主题直接引用；
- 不是当前 activeArtifacts，但短期内仍有现实参考价值；
- 直接迁走会增加查找成本或造成文档跳转断裂。

---

## 6.3 迁移到 `.limcode/archive/design/` 的 completed 设计资产

- `.limcode/design/第二批通用测试与命名技术债审计.md`
- `.limcode/design/database-boundary-governance-phase1-design.md`
- `.limcode/design/death-note-world-pack-content-expansion-design.md`
- `.limcode/design/e2e-active-pack-assumption-cleanup-and-test-runtime-decentralization-design.md`
- `.limcode/design/experimental-multi-pack-runtime-registry-design.md`
- `.limcode/design/memory-block-context-trigger-engine-rust-migration-design.md`
- `.limcode/design/rust-world-engine-pack-runtime-core-ownership-deepening-design.md`
- `.limcode/design/rust-world-engine-phase1-boundary-and-sidecar-design.md`
- `.limcode/design/scheduler-core-decision-kernel-rust-migration-design.md`
- `.limcode/design/single-pack-multi-entity-concurrent-request-design.md`
- `.limcode/design/world-pack-boundary-convergence-and-death-note-doc-migration-design.md`
- `.limcode/design/world-pack-prompt-macro-variable-formalization-design.md`

### 迁移理由
- 相关里程碑已在 `progress.md` 中标记完成；
- 对应实现已进入代码与稳定文档；
- 当前继续留在根层会增加“误判为活跃主设计”的风险。

---

## 6.4 迁移到 `.limcode/archive/historical/design/` 的 historical 设计资产

- `.limcode/design/agent-context-module-prompt-workflow-orchestrator-design.md`
- `.limcode/design/agent-scheduler-design.md`
- `.limcode/design/context-module-policy-overlay-deepening-design.md`
- `.limcode/design/death-note-intent-grounder-design.md`
- `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md`
- `.limcode/design/multi-model-gateway-and-unified-ai-task-contract-design.md`
- `.limcode/design/prompt-workflow-formalization-design.md`
- `.limcode/design/scheduler-replay-aware-scheduling-design.md`
- `.limcode/design/server-runtime-modularization-first-boundary-design.md`

### 迁移理由
- 其中多份是早期大草案；
- 其主题已被后续设计、`docs/capabilities/*` 或当前实现吸收；
- `memory-block-triggered-long-memory-and-prompt-workflow-design.md` 本身已明确标注“历史设计草案”。

---

## 6.5 迁移到 `.limcode/archive/plans/` 的 completed 计划资产

- `.limcode/plans/database-boundary-governance-phase1-implementation.plan.md`
- `.limcode/plans/death-note-world-pack-content-expansion-implementation.plan.md`
- `.limcode/plans/e2e-active-pack-assumption-cleanup-and-test-runtime-decentralization-implementation.plan.md`
- `.limcode/plans/experimental-multi-pack-runtime-registry-implementation.plan.md`
- `.limcode/plans/memory-block-context-trigger-engine-rust-migration-implementation.plan.md`
- `.limcode/plans/rust-migration-compatibility-debt-remediation.plan.md`
- `.limcode/plans/rust-world-engine-pack-runtime-core-ownership-deepening-implementation.plan.md`
- `.limcode/plans/rust-world-engine-phase1-a-completion-sequencing-and-validation.plan.md`
- `.limcode/plans/rust-world-engine-phase1-b-real-session-and-step-implementation.plan.md`
- `.limcode/plans/rust-world-engine-phase1-boundary-and-sidecar-implementation.plan.md`
- `.limcode/plans/rust-world-engine-phase1-c-step-semantics-and-observability.plan.md`
- `.limcode/plans/scheduler-core-decision-kernel-rust-migration-implementation.plan.md`
- `.limcode/plans/second-batch-generic-tests-and-naming-debt-remediation.plan.md`
- `.limcode/plans/second-batch-medium-priority-e2e-and-remaining-naming-debt-remediation.plan.md`
- `.limcode/plans/server-runtime-modularization-first-implementation.plan.md`
- `.limcode/plans/single-pack-multi-entity-concurrent-request-implementation.plan.md`
- `.limcode/plans/world-pack-boundary-convergence-and-death-note-doc-migration-implementation.plan.md`
- `.limcode/plans/world-pack-prompt-macro-variable-formalization-implementation.plan.md`

### 迁移理由
- 所有这些计划对应的实施阶段均已在 `progress.md` 中完成或被后续工作吸收；
- 继续留在根层会让当前计划层噪音过高。

---

## 6.6 迁移到 `.limcode/archive/review/` 的 completed 评审资产

- `.limcode/review/文档体系与权责边界审查.md`
- `.limcode/review/scheduler-core-decision-kernel-rust-migration-review.md`

### 迁移理由
- 两份评审均已完成；
- 当前不再承担 active review 的主职责。

---

## 6.7 待人工确认项

### 1) `.limcode/plans/world-pack-post-governance-closure.plan.md`

问题：
- 文件中的 TODO 仍是未完成状态；
- 但其部分目标疑似已被后续代码与文档吸收。

处理策略：
- 先人工核对该计划中的 5 个条目是否已被后续实施覆盖；
- 若已经覆盖：迁入 `.limcode/archive/plans/`，并可在文件头补“historical closeout plan”说明；
- 若仍想继续以此收尾：原位保留，但需同步 TODO 状态。

### 2) `.limcode/tmp/rust-migration-status-matrix-and-exit-criteria.md`

问题：
- 与 `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md` 疑似重复；
- `tmp/` 不应长期保存正式资产。

处理策略：
- 先比对两份内容；
- 如完全一致：删除 `tmp/` 版本；
- 如存在差异：将差异合并到 design 正式版后删除 `tmp/`；
- 仅在确有保留必要时，改名迁入 `archive/` 并显式标注其性质。

---

## 7. 分阶段实施步骤

## Phase 1：建立归档骨架并冻结分类

### 操作
- 创建：
  - `.limcode/archive/design/`
  - `.limcode/archive/plans/`
  - `.limcode/archive/review/`
  - `.limcode/archive/historical/design/`
- 根据本计划冻结文件分类，避免实施中反复摇摆。

### 完成标准
- 目标目录存在；
- 文件分类清单已固定；
- 迁移顺序明确。

---

## Phase 2：迁移 completed 资产

### 操作
- 批量迁移已完成 design / plans / review 到对应 `archive/` 目录。

### 注意事项
- 保证文件名不变；
- 优先迁移无争议文件；
- 每一批迁移后立即检查是否存在被稳定文档直接引用的路径断裂。

### 完成标准
- completed 清单已全部迁出；
- 根层只剩 active/reference/待确认 项。

---

## Phase 3：迁移 historical 设计草案

### 操作
- 把 9 份 historical 设计迁入 `.limcode/archive/historical/design/`。

### 注意事项
- 这批文件的价值是“历史参考”，不应混入 completed 资产层；
- 如有必要，可在文件头加一行简短说明，但本轮不是必须动作。

### 完成标准
- 根层 design 中不再混放明显历史草案。

---

## Phase 4：处理待确认项

### 操作
- 审核 `world-pack-post-governance-closure.plan.md`；
- 对比并处理 `tmp/rust-migration-status-matrix-and-exit-criteria.md`。

### 完成标准
- `.limcode/tmp/` 不再保留疑似正式资产重复文件；
- `world-pack-post-governance-closure.plan.md` 的去留有明确结论。

---

## Phase 5：补齐治理说明

### 建议更新点
- `docs/INDEX.md`
  - 增加 `.limcode/archive/` 的说明；
  - 明确 `.limcode/design|plans|review` 更偏向活跃/参考过程资产。
- `README.md`
  - 若保留 `.limcode/` 简述，可增加“archive 用于历史与已完成资产”说明。
- 如需要，可新增 `.limcode/README.md`
  - 用极短说明定义 active / archive / historical 的边界。

### 完成标准
- 新进入仓库的读者能知道：
  - 当前工作看哪里；
  - 已完成资产看哪里；
  - 历史草案看哪里。

---

## 8. 验证清单

实施完成后，需要至少验证以下内容：

1. `.limcode/progress.md` 中 activeArtifacts 指向的文件路径全部存在；
2. `docs/capabilities/AI_GATEWAY.md`、`PLUGIN_RUNTIME.md`、`PROMPT_WORKFLOW.md` 中仍引用保留在原位的 design；
3. 根层 `.limcode/design/`、`.limcode/plans/`、`.limcode/review/` 的文件数量明显下降，且剩余文件符合 active/reference 语义；
4. `tmp/` 中不存在正式资产重复文件；
5. `README.md` / `docs/INDEX.md` 对 `.limcode` 的说明不再与实际目录结构脱节；
6. 没有因为移动文档而破坏当前人工查找路径。

---

## 9. 风险与缓解

### 风险 1：移动后路径引用失效
- **缓解**：优先保留 active/reference 文件原位；仅迁移 completed/historical；迁移后做一次 repo 内搜索校验。

### 风险 2：把仍有价值的文档过早归档
- **缓解**：单独保留 reference 层；对 `world-pack-post-governance-closure.plan.md`、`tmp/*` 采用人工确认。

### 风险 3：归档后规则仍不清，未来再次堆积
- **缓解**：在 `docs/INDEX.md` 或 `.limcode/README.md` 写最小治理规则，而不是只移动文件不立规矩。

---

## 10. 建议实施顺序

推荐严格按以下顺序执行：

1. 创建 archive 目录；
2. 迁移 completed 资产；
3. 迁移 historical 设计草案；
4. 处理待确认项；
5. 更新文档治理说明；
6. 做一次完整引用验证与目录复查。

这样可以最大程度减少移动过程中反复回滚与讨论成本。

---

## 11. 预期结果

整理完成后，`.limcode` 将形成如下状态：

- 根层只保留当前活跃或仍有直接参考价值的少量过程资产；
- 已完成实施资产被系统归档，降低噪音；
- 历史草案被单独隔离，不再误导读者；
- 未来新增设计/计划/评审时，是否应归档会有明确规则可循。
