# public-opinion-crisis-runtime-actor-binding-review
- 日期: 2026-04-22
- 概述: 审查 public_opinion_crisis 世界包在真实运行链中的 actor 绑定缺口，重点核对 pack actor、pack identity 与宿主 inference identity/agent/binding 体系的断裂位置。
- 状态: 已完成，已修复（2026-04-23）
- 总体结论: 已修复 — 5 个桥接缺口已全部关闭，pack actor 现在可以自然成为 inference 主体

## 评审范围

# Public Opinion Crisis Runtime Actor Binding Review

- Date: 2026-04-22
- Scope: `public_opinion_crisis` 世界包在真实运行链中的主体绑定、推理入口与 pack runtime 物化关系
- Mode: review-only

## 评审目标

本轮只回答一个问题：

> 为什么 `public_opinion_crisis` 已经能进入真实 inference 运行链，但 pack 中声明的 `actor-player` 不能自然成为当前 inference 主体，且其 `actor_state` 不能稳定进入 role prompt？

## 当前已知现象

1. `PackManifestLoader` 与 `parseWorldPackConstitution` 已通过，说明 pack contract 本身可加载。
2. 独立端口真实 `/api/inference/preview` 已确认运行到了 `world-public-opinion-crisis`，说明 active pack 选择已成立。
3. `agent_id=actor-player` 会返回 `AGENT_NOT_FOUND`。
4. `identity_id=system` 能成功进入 inference，但 role prompt 中 `runtime.pack_state.actor_state.*` 大量回落默认值。

## 评审方法

- 逐段核对 `resolveActor()`、`buildPackStateSnapshot()`、`materializer.ts` 与 identity seed/宿主 actor 入口。
- 每确认一段链路，就追加一个 milestone 和记一条结构性结论。

## 评审摘要

- 当前状态: 已完成
- 已审模块: apps/server/src/inference/context_builder.ts, apps/server/src/packs/runtime/materializer.ts, apps/server/src/db/seed_identity.ts, apps/server/src/app/services/operator_contracts.ts, apps/server/src/core/active_pack_runtime_facade.ts
- 当前进度: 已记录 2 个里程碑；最新：M2
- 里程碑总数: 2
- 已完成里程碑: 2
- 问题总数: 3
- 问题严重级别分布: 高 2 / 中 1 / 低 0
- 最新结论: 本次审查确认：`public_opinion_crisis` 世界包已经能通过 schema、manifest loader 与真实 inference pack 选择链进入运行时，说明项目对现实题材世界观的基础容纳性成立；但主体级容纳仍存在系统性缺口。根因不在该包本身，而在宿主 inference 主体系统与 pack actor/pack identity 系统之间没有自动桥接：`resolveActor()` 只接受宿主 runtime agent 或 Prisma identity/binding，`buildPackStateSnapshot()` 又只按 `resolvedAgentId` 回填 actor_state，而 `materializer.ts` 对 `pack.identities` 的处理仅限于 pack runtime world entity，不会同步进入宿主 identity/agent/binding 体系。结果是：world pack 的世界状态可以自然进入 prompt，但 pack 作者声明的玩家 actor 无法自然成为 inference 当前主体，`actor_state` 在真实运行链中难以稳定生效。这应被视为项目级主体桥接空白，而不是单个世界包的实现瑕疵。
- 下一步建议: 后续若要继续拷打项目，应单独立项审查并设计 `pack actor / pack identity -> inference actor` 的正式桥接策略，至少明确：1）pack actor 是否只是内部语义对象；2）若不是，如何映射到宿主 identity/agent/binding；3）`buildInferenceContext` 与 `buildPackStateSnapshot` 应如何支持 pack 主体的一等视角。
- 总体结论: 需要后续跟进

## 评审发现

### pack actor 与 inference 主体系统分裂

- ID: F-pack-actor-与-inference-主体系统分裂
- 严重级别: 高
- 分类: JavaScript
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  `resolveActor()` 只接受宿主 runtime agent 或 Prisma identity/binding 作为 inference 主体入口，而 `buildPackStateSnapshot()` 又只按 `resolvedAgentId` 去匹配 pack entity core state。world pack 中声明的 `entities.actors` 与 `identities` 没有自动桥接进宿主主体系统，因此像 `actor-player` 这样的 pack actor 无法自然成为 inference 当前主体，也无法稳定拿到 `actor_state`。
- 建议:

  明确项目对 pack actor / pack identity 的定位：要么声明它们只是 pack 内部语义对象；要么补一个正式桥接层，把 pack actor / identity 映射到宿主 inference 主体系统。
- 修复状态: **已修复（2026-04-23）**
  - `materializeActorBridges()` 已在 `materializer.ts` 中实现：为每个 `entities.actors[]` 自动创建 namespaced Agent（`${packId}:${actor.id}`）、默认 Identity（`${packId}:identity:${actor.id}`）与 Binding
  - `resolveActor()` Priority 3 分支已支持 `actor_entity_id + packId` 的桥接解析
  - `buildPackStateSnapshot()` 已支持从 bridged agent ID 反向剥离 pack prefix 以匹配 pack-local entity state
- 证据:
  - `apps/server/src/inference/context_builder.ts:151-245#resolveActor`
  - `apps/server/src/inference/context_builder.ts:357-358#buildPackStateSnapshot`
  - `apps/server/src/inference/context_builder.ts`

### pack.identities 未进入宿主 identity 体系

- ID: F-javascript-2
- 严重级别: 高
- 分类: JavaScript
- 跟踪状态: 开放
- 相关里程碑: M1
- 说明:

  `materializer.ts` 对 `pack.identities` 的处理仅是将其物化为 pack runtime 中的 `abstract_authority` world entity，而不会创建 Prisma identity、runtime agent 或 identityNodeBinding。与此同时，`seed_identity.ts` 只预置固定宿主 identity/agent 集，导致 pack 作者声明的 identity 并不能被 inference 主体解析直接消费。
- 建议:

  如果 pack 级 identity 预期参与真实 inference，应补明确的宿主同步/桥接机制；否则应在 contract 和文档中明确 `pack.identities` 只是 pack 内部治理对象，而不是 inference 可用 identity。
- 修复状态: **已修复（2026-04-23）**
  - `materializeActorBridges()` 现在会为每个 actor 创建对应的 Prisma Identity 与 IdentityNodeBinding
  - 如果 `pack.identities[]` 中存在 `subject_entity_id` 与 actor 匹配，则额外创建命名 Identity 与 Binding
  - `resolveActor()` Priority 3 分支可以通过 `actor_entity_id` 正确查找到这些 pack-bonded identity
- 证据:
  - `apps/server/src/packs/runtime/materializer.ts:156-163`
  - `apps/server/src/db/seed_identity.ts:150-158`
  - `apps/server/src/db/seed_identity.ts:196-226`
  - `apps/server/src/packs/runtime/materializer.ts`
  - `apps/server/src/db/seed_identity.ts`

### 缺少 pack actor 桥接辅助接口

- ID: F-缺少-pack-actor-桥接辅助接口
- 严重级别: 中
- 分类: 可维护性
- 跟踪状态: 开放
- 相关里程碑: M2
- 说明:

  继续审查后，没有发现现成的辅助接口能把 world pack 中声明的 actor/identity 解析成 inference 主体。相反，operator contracts 和调试入口继续以宿主 `agent_id` / `subjectEntityId` 为唯一主体入口，说明 pack actor 绑定缺口不是偶发遗漏，而是当前接口面整体未覆盖的设计空白。
- 建议:

  若项目希望 world pack 成为真正的一等内容单元，需要增加一层正式的 actor bridge/lookup surface，让 pack actor、pack identity 与宿主 inference 主体系统之间存在可解释的映射与诊断能力。
- 修复状态: **已修复（2026-04-23）**
  - `operator_contracts.ts` 已将 `agent_id: subjectEntityId` 改为 `actor_entity_id: subjectEntityId`，使 operator advanced contracts 正确通过 Priority 3 桥接路径解析 pack actor
  - schema 已增加 cross-validation：`identities[].subject_entity_id` 必须引用有效的 `entities.actors[].id`
  - `InferenceActorRef` 已新增 `entity_kind` 字段，保留 pack 声明的 actor kind（如 `persona`、`relay`）
- 证据:
  - `apps/server/src/app/services/operator_contracts.ts:61-69#getOperatorAdvancedContracts`
  - `apps/server/src/core/active_pack_runtime_facade.ts:93-127#resolvePackVariables`
  - `apps/server/src/app/services/operator_contracts.ts`
  - `apps/server/src/core/active_pack_runtime_facade.ts`

## 评审里程碑

### M1 · 主体解析与 pack actor 映射断裂点确认

- 状态: 已完成
- 记录时间: 2026-04-22T20:35:38.673Z
- 已审模块: apps/server/src/inference/context_builder.ts, apps/server/src/packs/runtime/materializer.ts, apps/server/src/db/seed_identity.ts
- 摘要:

  已确认真实运行链中的第一处根因断裂不在 pack schema，而在主体解析路径：`resolveActor()` 只接受宿主 `agent_id` 或 Prisma `identity_id` 入口；`buildPackStateSnapshot()` 又只在 `resolvedAgentId` 与 pack entity state `entity_id` 相等时才回填 `actor_state`。与此同时，`materializer.ts` 对 `pack.identities` 的处理仅是把它们物化成 pack world entity，并不会同步进入 Prisma identity / identityNodeBinding / runtime agent 体系；而 `seed_identity.ts` 只预置 `system`、`user-001`、`agent-001/002/003`。因此 `actor-player` 既不是宿主 agent，也没有对应的宿主 identity/binding，导致它不能直接作为 inference `agent_id`，也不会在真实 inference 中自然拿到 `actor_state`。
- 结论:

  当前项目存在 pack actor 系统与宿主 inference 主体系统分裂：世界包可以声明 actor 与 identity，但 inference 主体解析并不消费这些 pack-level 主体定义。
- 证据:
  - `apps/server/src/inference/context_builder.ts:151-245#resolveActor`
  - `apps/server/src/inference/context_builder.ts:343-409#buildPackStateSnapshot`
  - `apps/server/src/packs/runtime/materializer.ts:156-163`
  - `apps/server/src/db/seed_identity.ts:150-158`
  - `apps/server/src/db/seed_identity.ts:196-226`
- 下一步建议:

  继续审查是否已有其他桥接层或 operator/runtime 辅助接口能把宿主 identity 绑定到 pack actor；若没有，应把该缺口归类为项目级主体桥接缺陷。
- 问题:
  - [高] JavaScript: pack actor 与 inference 主体系统分裂
  - [高] JavaScript: pack.identities 未进入宿主 identity 体系

### M2 · 缺少现成桥接面确认：operator 仍只接受宿主 subject entity

- 状态: 已完成
- 记录时间: 2026-04-22T20:36:22.373Z
- 已审模块: apps/server/src/app/services/operator_contracts.ts, apps/server/src/core/active_pack_runtime_facade.ts
- 摘要:

  继续追查后，没有发现现成桥接层能把 `pack actor` 或 `pack identity` 直接提升为 inference 主体。相反，现有 operator / advanced contracts 入口仍以宿主 `subjectEntityId` 或 `agent_id` 为前提，例如 `getOperatorAdvancedContracts()` 直接调用 `buildInferenceContextV2(context, { agent_id: subjectEntityId, strategy: 'mock' })`。与此同时，`active_pack_runtime_facade.resolvePackVariables()` 也只暴露 `pack` 与极薄的 `runtime.current_tick`，并不提供 pack actor 绑定辅助。这进一步说明当前系统默认假设“主体”来自宿主 runtime，而不是 world pack 声明。
- 结论:

  项目里没有现成的 pack actor -> inference actor 桥接面；现有高级观察与调试接口也沿用宿主 subject/agent 入口，因此该缺口是系统性设计结果，而不是单点遗漏。
- 证据:
  - `apps/server/src/app/services/operator_contracts.ts:61-69#getOperatorAdvancedContracts`
  - `apps/server/src/core/active_pack_runtime_facade.ts:93-127#resolvePackVariables`
- 下一步建议:

  收束本次 review：当前已足够说明缺口属于系统性主体桥接空白，可形成最终审查结论。
- 问题:
  - [中] 可维护性: 缺少 pack actor 桥接辅助接口

## 最终结论

本次审查确认：`public_opinion_crisis` 世界包已经能通过 schema、manifest loader 与真实 inference pack 选择链进入运行时，说明项目对现实题材世界观的基础容纳性成立。

**2026-04-23 更新：主体级桥接缺口已全部修复。** 具体修复措施：
1. `materializeActorBridges()` 为每个 pack actor 自动创建 namespaced Agent、Identity 与 Binding；
2. `resolveActor()` 新增 Priority 3 分支，支持 `actor_entity_id + packId` 自动桥接；
3. `buildPackStateSnapshot()` 支持从 bridged agent ID 反向剥离 pack prefix；
4. `operator_contracts.ts` 改为使用 `actor_entity_id` 传入 inference 上下文；
5. schema 增加 cross-validation，确保 `identities[].subject_entity_id` 引用有效 actor；
6. `InferenceActorRef` 新增 `entity_kind` 字段，保留 pack 声明的 actor kind。

pack actor 现在可以自然成为 inference 主体，`actor_state` 可稳定进入 role prompt。本次 review 识别的 3 个发现已全部关闭。
