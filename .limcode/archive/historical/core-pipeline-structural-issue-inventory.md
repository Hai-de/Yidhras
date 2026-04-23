# Yidhras 核心链路结构性问题清单 (Issue Inventory)

> **文档来源**：原仓库根目录同名文件，为早期问题发现快照。
> **归档日期**：2026-04-23
> **归档原因**：该文件属于历史问题清单，部分问题已解决或已有专项跟踪，不再适合作为根目录文件驻留。
> **后续跟踪**：仍开放的问题已归入 `TODO.md` 与 `.limcode/review/`。

## 状态总览（归档时评估）

| # | 问题 | 归档时状态 | 跟踪去向 |
|---|------|------------|----------|
| 1 | Pack Actor 无法直接作为 Inference 主体进入推理 | 仍开放（系统性设计缺口） | `.limcode/review/public-opinion-crisis-runtime-actor-binding-review.md` |
| 2 | Pack Identities 未进入宿主 Identity 体系 | 仍开放（与 #1 同根因） | 同上 |
| 3 | Inference Runtime 无法自然继承 Actor State | 仍开放（与 #1 同根因） | 同上 |
| 4 | 缺乏针对 Pack Actor 的桥接面与调试入口 | 仍开放（与 #1 同根因） | 同上 |
| 5 | `invocation_type` 写入链路与 Rule 匹配项不一致 | **已解决** | Schema 已强制 `invoke.` 前缀；代码链路已对齐 |
| 6 | Prompt Workflow 对 Context Run 结构存在强隐式依赖 | 架构设计选择，已文档化 | `docs/capabilities/PROMPT_WORKFLOW.md` |
| 7 | `include_sections` 并非强控制面 | 架构设计选择，已文档化为 hint 语义 | `docs/capabilities/PROMPT_WORKFLOW.md` |
| 8 | 复杂数值区间不能交由模板运行时执行 | 架构设计选择，受控模板引擎不支持任意 JS 表达式 | `docs/capabilities/PROMPT_WORKFLOW.md` |
| 9 | 启动包与真实推理执行包的"幽灵切换"漏洞 | 大幅改善：active pack runtime 已重构为 facade + registry | 代码中仍有 silent fallback 警告，需持续关注 |

---

以下是原始问题清单全文，不再更新。

---

## 模块一：主体与运行时绑定系统性断裂（最高优先级 / 结构性缺陷）
当前项目存在两套平行的主体系统（宿主 Inference 主体体系 vs World Pack 主体体系），且两者之间缺乏自动桥接，导致世界状态可被容纳，但**玩家主体状态无法稳定生效**。

### 1. Pack Actor 无法直接作为 Inference 主体进入推理
*   **现象 / 触发点**：在 API 调用 `POST /api/inference/preview` 时，传入 `agent_id: "actor-player"` 直接返回 `AGENT_NOT_FOUND`。
*   **根本原因**：`apps/server/src/inference/context_builder.ts` 中的 `resolveActor()` 方法，目前只接受宿主的 `runtime agent` 或 Prisma `identity/binding` 作为入口，完全不认 World Pack 中声明的 `entities.actors`。
*   **影响**：Pack 作者极其痛苦，他们声明了 Actor 却不知道 inference API 该喂什么 ID。

### 2. Pack Identities 未进入宿主 Identity 体系
*   **现象 / 触发点**：Pack 作者在配置中声明了 `identities:`，但这些 Identity 无法被系统当做真实用户或 Agent 身份使用。
*   **根本原因**：`apps/server/src/packs/runtime/materializer.ts` 仅仅把 `pack.identities` 物化成了 Pack Runtime 里的 `abstract_authority` World Entity。它**没有**同步创建 Prisma identity、runtime agent 或 identityNodeBinding。同时，`seed_identity.ts` 只预置了固定的宿主身份（如 system, user-001 等）。
*   **影响**：Pack 作者写出来的 identity 本质上只是"包内自嗨的内部治理对象"，无法与宿主权限及调度系统打通。

### 3. Inference Runtime 无法自然继承 Actor State
*   **现象 / 触发点**：使用 `identity_id=system` 成功跑通 inference 后，Role Prompt 里的 `runtime.pack_state.actor_state.*` 全部回落到默认值，甚至提示 missing path。
*   **根本原因**：`buildPackStateSnapshot()` 的逻辑限定了**只有当 `resolvedAgentId === pack entity state 的 entity_id` 时**，才把该 state 视作 `actor_state`。因为宿主 Agent ID（如 system）与 Pack Entity ID（如 actor-player）永远对不上，导致主体状态组装链彻底断裂。

### 4. 缺乏针对 Pack Actor 的桥接面与调试入口
*   **现象 / 触发点**：Operator contracts 和调试入口目前仅支持宿主的 `subjectEntityId` 或 `agent_id`。
*   **根本原因**：例如 `getOperatorAdvancedContracts()` 以及 `active_pack_runtime_facade.resolvePackVariables()` 都隐式或显式地以宿主 Subject 作为前提。
*   **建议修复方向**：必须建立一层正式的 **Actor Bridge (映射层)**，明确回答："Pack Actor 映射到哪个宿主 Identity？"，并打通 `buildInferenceContext` 与此映射的关联。

---

## 模块二：指令意图与执行机制的不一致（高风险 / 链路阻断）
Action Dispatch 与 Enforcement 链路在此次验证中发现了明显的前后阶段字段不对齐问题，会导致看似合法的意图无法触发对应规则。

### 5. `invocation_type` 写入链路与 Rule 匹配项不一致 ✅ 已解决
*   **现象 / 触发点**：Invocation rule 能命中，Grounding 成功，但在 `objective_enforcement` 阶段因 `when.invocation_type` 不一致导致匹配失败。
*   **根本原因**：
    1. `groundDecisionIntent()` 阶段：将 `decision.action_type` 改写成了 **capability key**（例如：`invoke.issue_public_statement`）。
    2. 后续方法（`buildActionIntentDraft`、`buildInvocationRequestFromActionIntent`）依次传递，导致进入 enforcement 的 `invocation_type` 实际上带了 `invoke.*` 前缀。
    3. 而 World Pack 目前按照设计习惯（以及早期的 Schema 样例）填写的是语义风格的无前缀名（如：`coordinate_internal_team`）。
*   **修复方向（立即执行）**：这不是风格问题，而是真实链路约束。需要将 Objective Rules 里的 `when.invocation_type` 统一修改为带 `invoke.` 前缀的形式以对齐底层链路。

---

## 模块三：Prompt Workflow 与上下文组装限制（中优先级 / 开发体验与边界边界）
Prompt Workflow 表现出对宿主环境较强的依赖，限制了开发过程中的轻量级测试与排错。

### 6. Prompt Workflow 对 Context Run 结构存在强隐式依赖
*   **现象 / 触发点**：手工构造一个最小推断上下文传入 `buildPromptBundle()` 试图验证 Prompt 渲染，结果直接在 `apps/server/src/context/workflow/runtime.ts` 报错抛出（`state.selected_nodes.length is undefined`）。
*   **根本原因**：底层的 Prompt Workflow 运行时并不具备"仅输入 Prompt 模板和变量即可独立渲染"的弱依赖特性。它深度绑定了完整的一次推断流程（Inference Context Assembly）的节点装配树。
*   **影响**：Pack 级的 Prompts 无法脱离完整宿主链路做独立/轻量的单元验证（Mock 测试）。

### 7. `include_sections` 并非强控制面
*   **现象 / 触发点**：开发者在配置中指定了 `include_sections`，但在最终实际渲染中，并没有观察到它真正驱动 Prompt Workflow 执行 Section 的精准裁剪与装配。
*   **根本原因**：当前系统只将其作为 Hint（提示性元数据）写进 Developer Message 中，未真正在 AST/渲染层强制执行裁剪。
*   **影响 / 应对**：文档应明确标注此为提示性字段。Pack 作者必须将关键上下文优先移至 `prompts.global_prefix`、`prompts.agent_initial_context` 及 `system_append` 中保障生效。

### 8. 复杂数值区间不能交由模板运行时执行
*   **现象 / 触发点**：尝试在模板里使用原 EJS 风格的复杂条件表达式，执行失败。
*   **根本原因**：目前的 Prompt Workflow 引擎仅支持插值、`default(...)`、`#if`、`#each`，不支持原生 JS 任意表达式求值。
*   **应对策略**：所有状态区间的判定（如判断"公众压力"是高是低），必须在 Pack State Schema 或预处理链路中完成结构化映射（如映射成 `public_opinion_stage` 等状态枚举标签），再将标签喂给模板。

---

## 模块四：运行时状态与调试边界（中风险 / 运维不可靠）

### 9. 启动包与真实推理执行包的"幽灵切换"漏洞
*   **现象 / 触发点**：控制台启动日志显示正在加载 `public_opinion_crisis` 包，但 Inference 返回的结果却是老包 `world-death-note`。
*   **根本原因**：Inference 读取的 Active Pack 受极深层 Runtime 状态控制，即使在入口尝试轻量级指定新包甚至 Manifest 加载无误，运行链仍可能静默退化（Silent Fallback）到已存在的缓存或默认包上。
*   **影响**：严重干扰测试。系统对于 World Pack 切换时的状态一致性、缓存失效保障非常薄弱。测试通过的现象可能是"伪装的成功"（实际在跑老的稳定包）。

---

## 📝 阶段性总结与行动建议

对于接下来的项目推进，建议暂停"在现有的世界包里硬写或修改内容"来规避问题，而是转向：
1. **[工程向] 打补丁 / 修规范**：在 World Pack 层面批量重构所有的 Rule 触发条件（增加 `invoke.` 前缀）；避免在模板里写 JS 逻辑。
2. **[架构向] 攻坚主体桥接问题（Critical）**：单独立项去修改宿主的 `resolveActor` 及相关层代码。需要架构上明确：Pack 里的 Actor 和 Host 里的 Agent/Identity，是一对一映射？还是运行时动态挂载？这一层不断，玩家扮演的世界包永远无法获得真实的状态反馈。