## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] P0-1：稳定参考文档术语降噪与可读性重写 — 将 docs/ARCH.md、LOGIC.md、API.md 中过度技术化/内部路由表式的表述改为人类可读的分层说明，降低新贡献者理解门槛  `#doc-clean-p0-1`
- [x] P0-2：稳定参考文档状态信息剥离 — 从 ARCH.md / API.md / LOGIC.md 中剥离迁移期状态、Phase 标记、"已完成/已删除/已移除"等临时跟踪信息，只保留稳定结论  `#doc-clean-p0-2`
- [x] P0-3：根目录噪声文件处理 — 处理 "Yidhras核心链路结构性问题清单 (Issue Inventory).md"，评估归档或更新后移入 docs/history/  `#doc-clean-p0-3`
- [x] P1-1：.limcode 活跃层清理 — 将已完成计划/设计/评审从活跃层迁入 archive，明确活跃/归档边界  `#doc-clean-p1-1`
- [x] P1-2：.limcode 文档标题与命名规范化 — 统一活跃层文档的命名风格，消除中英混杂/过长/过于技术化的文件名  `#doc-clean-p1-2`
- [x] P1-3：capabilities/ 专题文档可读性改善 — 为 PROMPT_WORKFLOW.md、AI_GATEWAY.md、PLUGIN_RUNTIME.md 增加面向概念理解的"先懂再深"结构  `#doc-clean-p1-3`
- [x] P2-1：INDEX.md 与 README.md 导航简化 — 将 INDEX.md 变更事实源规则为隐性约束，前端突出"人要走哪"，减少规则噪音  `#doc-clean-p2-1`
- [x] P2-2：guides/ 操作手册可操作性审查 — 确认 COMMANDS.md、DB_OPERATIONS.md、PLUGIN_OPERATIONS.md 等以操作为核心的文档确实可操作而非架构论述  `#doc-clean-p2-2`
- [x] P2-3：TODO.md 与 progress.md 信息新鲜度同步 — 确保 TODO.md 只保留当前焦点，progress.md 中过时内容归档  `#doc-clean-p2-3`
<!-- LIMCODE_TODO_LIST_END -->

# 文档清理计划

## 1. 问题诊断

当前文档体系存在三个系统性问题：

### 1.1 术语过载（Terminology Overload）

稳定参考文档（`docs/ARCH.md` 427 行、`LOGIC.md` 243 行、`API.md` 405 行）大量使用内部实现术语，而非面向概念理解的表述：

- `WorldEngineSidecarClient`、`PackRuntimeLookupPort`、`PackScopeResolver`、`ContextOverlayEntry`、`MemoryBlockRuntimeState` 等内部类名直接出现在稳定文档中
- `Host-managed persistence`、`tainted session recovery`、`objective enforcement`、`admission probability gate` 等实现概念未给出人可理解的释义
- `PROMPT_WORKFLOW.md`(439 行) 面向流水线节点命名而非概念层次：读者需要先知道 `PromptSectionDraft`、`PromptFragment` 等内部类型才能理解系统在做什么

**后果**：新贡献者无法从稳定参考文档快速理解"系统做了什么"，必须先在实践中逆推术语含义。

### 1.2 状态信息污染（State Pollution）

稳定参考文档中混入了大量临时状态信息：

- `ARCH.md` 第 3.3.2 节（Rust world engine Phase 1 边界）花约 60 行描述"当前已完成 sidecar-only 收口"、"Phase 1B 已完成"、"legacy adapter 已物理删除"等属于 `.limcode/` 过程记录的内容
- `API.md` 第 0 节和第 7.0 节反复强调"experimental / default off / operator test-only"，同一约束在 ARCH.md 也重复
- `ARCH.md` 第 3.3.3 节的 Rust 迁移状态矩阵本身是过程跟踪表，不应长期存在于架构文档中

**后果**：稳定文档变成半个 changelog，读者需要区分"这是永远成立的架构事实"还是"这是当前阶段的状态快照"。

### 1.3 历史噪声（Historical Noise）

- 仓库根目录存在 `Yidhras核心链路结构性问题清单 (Issue Inventory).md`——这是一份早期问题发现文档，其中部分问题已被修复，但文件本身没有标注状态、也没有归档路径
- `.limcode/archive/progress.md` 有 1035 行历史里程碑，与活跃层混在一起
- `.limcode/plans/` 中 `fake-unimplemented-cleanup` 计划所有 TODO 已打勾但仍驻留在活跃层
- `.limcode/` 活跃层有 20+ 文件，命名风格不统一：有全英文有中英混杂，有超长技术化命名如 `rust-ts-host-runtime-kernel-boundary-and-clock-projection-implementation.plan.md`

**后果**：活跃层无法反映"当前正在做什么"，新读者难以区分哪些是当前工作、哪些是历史记录。

---

## 2. 目标

> 让文档体系从"内部路由表"变为"可理解的稳定参考"，同时让 `.limcode/` 活跃层真正反映当前工作焦点。

具体目标：

1. 稳定参考文档（`docs/`）中的架构事实与业务规则能被新贡献者在 10 分钟内理解
2. 状态跟踪信息从稳定文档剥离，归入 `.limcode/` 或确认稳定后简化为结论
3. 历史噪声从根目录和活跃层清理，让 `.limcode/plans|design|review/` 只包含真正活跃的资产

---

## 3. 非目标

本轮不做以下事情：

1. **不重写所有 `.limcode/archive/` 中的历史文档**——已完成的历史文档只做归档处理，不逐一改写内容
2. **不改变代码实现或 API contract**——本轮纯文档治理，不动代码
3. **不引入新的文档分层体系**——`INDEX.md` 的四层结构本身没问题，问题在内容质量
4. **不删除任何历史信息本身**——只是搬迁和重组织，确保信息不丢失

---

## 4. 优先级与范围

### P0：稳定文档可读性（核心问题）

#### P0-1：稳定参考文档术语降噪与可读性重写

**对象**：`docs/ARCH.md`、`docs/LOGIC.md`、`docs/API.md`

**做法**：

1. **术语释义先行**：在 ARCH.md 和 LOGIC.md 开头增加一节"核心术语表"，用人类可读的一句话解释关键内部术语（如 `WorldEnginePort` = "TS 宿主持有的世界引擎控制面合约"而非直接使用类名）
2. **概念分层替代实现路由**：将"变量/类型级"描述改为"做什么-为什么"描述。例如把 `SimulationManager` 的 200 行类名列举改为"系统提供以下核心能力：……"
3. **减少交叉引用噪声**：当前 ARCH.md 每个小节都重复"不在这里展开：公共 HTTP contract 看 API.md"，改为文档顶部一次性声明职责边界，各节不再重复

**验收标准**：
- 新贡献者能在不查看代码的情况下理解 ARCH.md 的分层逻辑
- ARCH.md 总行数降低 30%+（通过状态信息剥离和冗余引用消除实现）
- LOGIC.md 的业务语义能被非项目核心成员理解

#### P0-2：稳定参考文档状态信息剥离

**对象**：`docs/ARCH.md`、`docs/API.md`

**做法**：

1. **ARCH.md 3.3.2 节（Rust world engine Phase 1）**：剥离所有"Phase 1A 已完成"、"1B 已完成"、"legacy adapter 已物理删除"等迁移期跟踪信息，只保留稳定结论："世界推进主路径通过 Rust sidecar，TS host 持有编排权"
2. **ARCH.md 3.3.3 节（Rust 迁移状态矩阵）**：整体从 ARCH.md 迁出。这是过程跟踪表，不是架构事实。应归入 `.limcode/` 过程资产或转为简要的一句话结论（如"当前默认执行路径为 Rust sidecar，具体模块状态见 `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`"）
3. **API.md 第 0 节与第 7.0 节**：将 experimental multi-pack runtime 的反复约束声明合并到一处，不再分散重复
4. **API.md 中 "当前稳定约束" 重复段落**：第 7.3 节与第 8.4 节的"当前稳定约束"几近重复，合并到一处

**验收标准**：
- ARCH.md 不再包含"Phase X 完成"、"已物理删除"、"已迁移"等迁移跟踪措辞
- API.md 中 experimental 约束描述只出现一次
- 状态矩阵从 ARCH.md 移除，改为链接指向 `.limcode/`

#### P0-3：根目录噪声文件处理

**对象**：`Yidhras核心链路结构性问题清单 (Issue Inventory).md`

**做法**：

1. 审查其中每个问题的当前状态（已修复 / 部分修复 / 仍开放）
2. 如已全部修复或归入 `.limcode/` 过程资产：整体迁入 `docs/history/` 或 `.limcode/archive/`
3. 如仍有开放问题：在文件顶部标注状态，并将开放问题归入 `TODO.md` 或 `.limcode/`
4. 处理完毕后从根目录移除

**验收标准**：
- 根目录不再有非常规命名的中文问题清单文件
- 所有未关闭问题有明确去向（TODO.md 或 .limcode/）

---

### P1：活跃层治理

#### P1-1：.limcode 活跃层清理

**对象**：`.limcode/plans/`、`.limcode/design/`、`.limcode/review/`

**做法**：

1. 扫描活跃层所有文件，对照 `progress.md` 的 activeArtifacts 和代码实际状态：
   - `fake-unimplemented-cleanup-and-boundary-alignment.plan.md`：所有 TODO 已完成 → 归档
   - 逐一检查其他已完成设计/计划
2. 将不符合"仍被直接引用"或"仍在活跃讨论"的文件迁入 `.limcode/archive/`
3. 更新 `.limcode/README.md` 和 `progress.md` 反映清理结果

**验收标准**：
- `.limcode/plans|design|review/` 中每个文件都属于当前活跃工作项
- 已完成项已迁入 `archive/`
- `progress.md` 的 activeArtifacts 与实际活跃文件对齐

#### P1-2：.limcode 文档标题与命名规范化

**对象**：`.limcode/` 活跃层文件名

**做法**：

1. 制定简洁命名约定：
   - 格式：`{简短主题}-{类型}.md`，其中类型为 `design|plan|review`
   - 例：`rust-ts-host-runtime-kernel-boundary-and-clock-projection-implementation.plan.md` → `host-runtime-kernel-boundary.plan.md`
2. 重命名后更新所有指向旧名称的引用

**验收标准**：
- 所有活跃层文件名 ≤ 60 字符
- 文件名能反映主题而非完整技术路径
- 无断链

#### P1-3：capabilities/ 专题文档可读性改善

**对象**：`docs/capabilities/PROMPT_WORKFLOW.md`、`AI_GATEWAY.md`、`PLUGIN_RUNTIME.md`

**做法**：

1. 为每个专题文档增加"概念先导"节：用 2-3 段自然语言解释"这个子系统在做什么、为什么存在"，然后再进入实现细节
2. 将内部类型名（如 `PromptSectionDraft`、`AiInvocationRecord`）在首次出现时给出一句人可读释义
3. 降低流水线式枚举密度：把 439 行的 PROMPT_WORKFLOW 中的节点枚举压缩为概念图 + 详细参考的结构

**验收标准**：
- 每个专题文档的前 10 行能让新贡献者理解子系统目的
- 内部类型在首次出现时有释义

---

### P2：导航与日常维护

#### P2-1：INDEX.md 与 README.md 导航简化

**对象**：`docs/INDEX.md`

**做法**：

1. INDEX.md 第 123-200 行的"事实源规则"和"文档更新指引"是内部治理规则，不是导航信息。将治理规则移入 `.limcode/README.md` 或 `AGENTS.md`，INDEX.md 只保留导航 + 简要分层说明
2. 减少重复：INDEX.md 中的"不该写什么"已在各文档自身头部声明，不需要在 INDEX 再次列出

**验收标准**：
- INDEX.md 行数减少 40%+，只保留导航和简要分层
- 治理规则仍在仓库中可查（迁移到 AGENTS.md 或 .limcode/README.md）

#### P2-2：guides/ 操作手册可操作性审查

**对象**：`docs/guides/COMMANDS.md`、`DB_OPERATIONS.md`、`PLUGIN_OPERATIONS.md`

**做法**：

1. 逐文件检查：是否存在以操作为核心的文档中混入了架构论述
2. 如有：将架构论述部分迁移到 ARCH.md 或 capabilities/，操作手册只保留操作步骤
3. 确认每个 commands 示例可直接复制执行

**验收标准**：
- guides/ 下每个文档的核心内容都是可操作步骤
- 无架构论述混入操作手册

#### P2-3：TODO.md 与 progress.md 信息新鲜度同步

**对象**：`TODO.md`、`.limcode/archive/progress.md`

**做法**：

1. TODO.md：确认只保留当前焦点事项，已完成的打勾项应归入 `.limcode/` 而非长期驻留
2. progress.md：1035 行已全部归入 archive/，但文件内容巨大。评估是否需要拆为分段摘要而非完整堆叠

**验收标准**：
- TODO.md 无已完成但未清理的条目
- progress.md 的信息新鲜度与当前工作对齐

---

## 5. 实施原则

### 5.1 信息不丢失

所有从稳定文档剥离的内容都必须有明确去向：
- 迁移期状态 → `.limcode/` 过程资产
- 治理规则 → `AGENTS.md` 或 `.limcode/README.md`
- 历史问题清单 → `docs/history/` 或 `.limcode/archive/`

### 5.2 文档版本化跟踪

每份被修改的文档在文末增加一行修改标注：

```
> 本文档于 YYYY-MM-DD 经过文档清理计划 (doc-clean) 重写/清理，变更类型：{术语降噪|状态剥离|导航简化|...}
```

### 5.3 最小破坏

- 不改变 `packages/contracts` 中任何类型或 API
- 不改变代码中的任何注释或实现
- 不改变文档的职责划分（ARCH 仍然讲架构，LOGIC 仍然讲逻辑），只改善表达质量

### 5.4 验证方式

每次修改后执行：
- `pnpm lint`：确保无断链或格式问题
- `pnpm typecheck`：确保无副作用
- 人工通读确认：新贡献者能否在 10 分钟内理解核心文档

---

## 6. 不纳入本轮

1. **代码实现变更**：本轮纯文档治理
2. **`.limcode/archive/` 内容改写**：归档文档只搬迁不改写
3. **新增文档**：不新增目前不存在的文档（如 `docs/guides/TESTING.md`、`docs/guides/RUNTIME_SETUP.md`），除非 INDEX.md 已列出
4. **frontend 文档重写**：`THEME.md` 与 `apps/web/README.md` 当前质量尚可，本轮不做重点治理
5. **世界包文档重写**：`WORLD_PACK.md` 当前定位清晰，本轮不做重点治理

---

## 7. 参考依据

- 稳定参考层现状：`docs/ARCH.md`、`docs/LOGIC.md`、`docs/API.md`、`docs/ARCH_DIAGRAM.md`
- 专题层现状：`docs/capabilities/PROMPT_WORKFLOW.md`、`AI_GATEWAY.md`、`PLUGIN_RUNTIME.md`
- 操作层现状：`docs/guides/COMMANDS.md`、`DB_OPERATIONS.md`、`PLUGIN_OPERATIONS.md`
- 导航层现状：`docs/INDEX.md`
- 根目录噪声：`Yidhras核心链路结构性问题清单 (Issue Inventory).md`
- 活跃过程资产：`.limcode/plans/`、`.limcode/design/`、`.limcode/review/`
- 归档过程资产：`.limcode/archive/`
- 历史进度：`.limcode/archive/progress.md`（1035 行）
- 文档治理规则：`.limcode/README.md`、`docs/INDEX.md` 第 123-200 行