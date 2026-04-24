## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->

- [ ] P0-1：Prisma 数据模型迁移 — 新增 Operator/OperatorSession/OperatorPackBinding/OperatorGrant/OperatorAuditLog 五表，Identity 增加反向关系，生成 migration `#operator-plan-p0-1`
- [ ] P0-2：认证基础设施 — bcrypt + JWT 签发/验证 + OperatorContext 类型 + OperatorAuthMiddleware，插入 create_app.ts 中间件链 `#operator-plan-p0-2`
- [ ] P0-3：Pack Access 层 — checkPackAccess() + packAccessGuard 中间件 + resolveSubjectForOperator() + 审计日志底层 `#operator-plan-p0-3`
- [ ] P0-4：Contracts 新增 — packages/contracts/src/operator.ts：login/createOperator/createPackBinding/createAgentBinding/createOperatorGrant/auditQuery schemas `#operator-plan-p0-4`
- [ ] P1-1：认证 API — POST /api/auth/login/logout/refresh, GET /api/auth/session `#operator-plan-p1-1`
- [ ] P1-2：Operator CRUD API — /api/operators (root 限定) `#operator-plan-p1-2`
- [ ] P1-3：Pack 绑定 API — /api/packs/:packId/bindings 邀请/列表/修改/移除 + /api/me/bindings `#operator-plan-p1-3`
- [ ] P1-4：Agent 绑定 API — /api/agents/:agentId/bindings 绑定/解绑 + /api/agents/:agentId/operators `#operator-plan-p1-4`
- [ ] P1-5：能力委托 API — /api/packs/:packId/grants 委托/撤销/列表 `#operator-plan-p1-5`
- [ ] P1-6：审计 API — /api/audit/logs 分页查询 (root 可见全部) `#operator-plan-p1-6`
- [ ] P2-1：Pack 路由接入 PackAccessGuard — /api/packs/:packId/* 统一接入 `#operator-plan-p2-1`
- [ ] P2-2：Agent 路由接入 CapabilityGuard — /api/agent/:id/* 和 /api/entities/:id/* 接入 capability 检查 `#operator-plan-p2-2`
- [ ] P2-3：Scheduler 路由接入 — 控制类 + 观测类路由接入 capabilityGuard `#operator-plan-p2-3`
- [ ] P2-4：Plugin 路由接入 — /api/packs/:packId/plugins/* 接入 packAccessGuard + capabilityGuard `#operator-plan-p2-4`
- [ ] P2-5：System 路由接入 — /api/system/* 接入 root 或特定 capability 检查 `#operator-plan-p2-5`
- [ ] P3-1：Agent 自主行为权限 — 修改 invocation_dispatcher.ts resolveSubjectEntityId，Agent 有控制 Operator 时以 Operator identity 校验 capability `#operator-plan-p3-1`
- [ ] P3-2：Scheduler 决策权限 — Scheduler 驱动 ActionIntent 时注入正确 actor_ref，EnforcementEngine 执行前 capability 校验走正常流程 `#operator-plan-p3-2`
- [ ] P4-1：Seed 脚本 — 创建 root Operator + Identity + 默认 pack OperatorPackBinding(owner) + 示例 Agent IdentityNodeBinding `#operator-plan-p4-1`
- [ ] P4-2：单元测试 — operator_auth / pack_access / subject_resolver / operator_grant `#operator-plan-p4-2`
- [ ] P4-3：集成测试 — operator_auth / pack_access / agent_binding / capability_enforcement / operator_grant `#operator-plan-p4-3`
- [ ] P4-4：E2E 测试 — 登录→绑定Pack→操作Agent→验证Capability拒绝→登出 `#operator-plan-p4-4`
- [ ] P5-1：前端认证层 — Pinia operator store + login.vue + useOperatorGuard + HTTP client Bearer 自动附带 `#operator-plan-p5-1`
- [ ] P5-2：Pack 选择界面 — 登录后显示已绑定 Pack 列表，支持 pack-scoped session `#operator-plan-p5-2`
- [ ] P5-3：管理界面 — /admin/operators.vue (root) + /admin/audit.vue `#operator-plan-p5-3`
- [ ] P6-1：文档更新 — API.md / ARCH.md / LOGIC.md / PROMPT_WORKFLOW.md / contracts index.ts / enhancements-backlog.md `#operator-plan-p6-1`
- [ ] P6-2：最终验证 — pnpm lint + pnpm typecheck + 全量测试通过 `#operator-plan-p6-2`

<!-- LIMCODE_TODO_LIST_END -->

# Operator-Subject 统一权限与多用户世界包治理实施计划

## 1. 背景

旧方案（Linux DAC）已被否定，其结构性矛盾在于：与现有 capability/authority/mediator governance framework 竞争、主体模型断裂（只有 User 没有 Agent 控制者）、无 pack 隔离、动态资源困境（白名单 vs 每 tick 产生的 Post/Event）、Agent 自主行为自动 root。

本计划基于 `.limcode/design/operator-subject-unified-authority-design.md`，将人类 Operator 作为一等 subject 融入现有 capability / authority / identity 体系，而非叠加新权限层。

## 2. 目标

1. Operator 通过 JWT 认证，获得 `OperatorContext`
2. Operator 通过 `IdentityNodeBinding` 与 Agent/WorldEntity 绑定，成为 pack 内正式 subject
3. Operator 对资源的访问权限，统一由已有的 `AuthorityResolver` + `EnforcementEngine` + `Policy` 三层判定
4. 新增概念仅用于表达 "Operator 与 Pack/Agent 的绑定关系" 和 "Operator 间的临时能力委托"
5. 所有权限变更都有审计证据
6. 向后兼容：保留 `x-m2-identity` 头作为 system/agent 机器间调用通道，但 Agent 类型请求不再自动视为 root

## 3. 非目标

1. 不替换现有 capability / authority / mediator 体系 — 融入而非替代
2. 不实现 OAuth / OIDC / SSO — 仅用户名+密码
3. 不实现 RBAC 角色继承树 — 用 capability + 委托替代角色层级
4. 不一次性实现前端所有管理界面 — 后端 API 和认证层优先
5. 不改变 Circle / CircleMember 模型 — Circle 保持面向仿真世界内部用途

## 4. 权限模型三层协作

| 层级 | 负责 | 已有/新增 | 判定依据 |
|------|------|-----------|----------|
| L1: Pack Access | "Operator 能否进入该 Pack" | 新增 `OperatorPackBinding` | 显式绑定关系 |
| L2: Capability | "Subject 能否执行该操作" | 已有 `AuthorityGrant` + `AuthorityResolver` | pack constitution + grant + mediator |
| L3: Policy (ABAC) | "能看/改哪些字段" | 已有 `Policy` + `AccessPolicyService` | 字段级 allow/deny |

三层是**递进过滤**关系：L1 拒绝 → 直接 403，不查 L2/L3；L2 拒绝 → 直接 403，不执行 mutation；L3 过滤 → 对返回/写入字段做裁剪。

## 5. 实施阶段

### Phase 0：基础设施

#### P0-1：数据模型迁移

1. 在 `apps/server/prisma/schema.prisma` 中新增：
   - `Operator`（id/identity_id/username/password_hash/is_root/status/display_name/created_at/updated_at）
   - `OperatorSession`（id/operator_id/token_hash/pack_id/expires_at/created_at）
   - `OperatorPackBinding`（id/operator_id/pack_id/binding_type/bound_at/bound_by/created_at）
   - `OperatorGrant`（id/giver_operator_id/receiver_identity_id/pack_id/capability_key/scope_json/revocable/expires_at/created_at）
   - `OperatorAuditLog`（id/operator_id/pack_id/action/target_id/detail_json/client_ip/created_at）
2. `Identity` 增加 `operator` 反向关系（不改动表结构）
3. 运行 `pnpm exec prisma migrate dev --name add_operator_governance`
4. 验证 `prisma generate` 成功

#### P0-2：认证基础设施

1. 安装 `bcrypt` + `jsonwebtoken` + `@types/bcrypt` + `@types/jsonwebtoken`
2. 创建 `src/operator/auth/password.ts`：bcrypt hash/compare
3. 创建 `src/operator/auth/token.ts`：JWT 签发/验证，token_hash 存 session
4. 创建 `src/operator/auth/types.ts`：`OperatorContext`
5. 创建 `src/app/middleware/operator_auth.ts`：认证中间件
   - 有 Bearer → 验证 JWT → 查 OperatorSession 未注销 → 查 Operator status == active → 注入 req.operator + req.identity
   - 无 Bearer → 保留 x-m2-identity 路径
6. 在 `src/app/create_app.ts` 中间件链中 `identityInjector()` 之后插入 `operatorAuthMiddleware()`
7. 环境变量：`JWT_SECRET`（必需）、`JWT_EXPIRES_IN`（默认 24h）

#### P0-3：Pack Access 层

1. 创建 `src/operator/guard/pack_access.ts`：
   - `checkPackAccess()`：root 仍需显式 binding（但不自动拥有所有 pack 访问权）
   - `packAccessGuard` 中间件：从 req.params/req.query 提取 packId → 检查 binding → 403 PACK_ACCESS_DENIED
2. 创建 `src/operator/guard/subject_resolver.ts`：
   - `resolveSubjectForOperator()`：优先显式 targetAgentId → 默认 binding → 回退到 operator 自身 identity
   - `resolveSubjectForAgentAction()`：Agent 自主行为时查找控制 Operator，无则走 agent 自身
3. 创建 `src/operator/audit/logger.ts`：`logOperatorAudit()` 通用写入函数

#### P0-4：Contracts 新增

1. 新增 `packages/contracts/src/operator.ts`：
   - `loginRequestSchema` / `createOperatorRequestSchema`
   - `createPackBindingRequestSchema` / `updatePackBindingRequestSchema`
   - `createAgentBindingRequestSchema`
   - `createOperatorGrantRequestSchema`
   - `operatorAuditLogQuerySchema`
2. `packages/contracts/src/index.ts` 添加 `export * from './operator.js'`

### Phase 1：API 与管理

#### P1-1：认证 API

- `POST /api/auth/login` → `src/app/services/operator_auth.ts` login
- `POST /api/auth/logout` → 计算 token_hash → 删除 OperatorSession → 写 audit
- `GET /api/auth/session` → 返回当前 operator 信息
- `POST /api/auth/refresh` → 延长 session

#### P1-2：Operator CRUD API

- `POST /api/operators` — 创建（root 限定）
- `GET /api/operators` — 列表（root 限定）
- `GET /api/operators/:id` — 详情（root 限定）
- `PATCH /api/operators/:id` — 修改状态/密码（root 限定）
- `DELETE /api/operators/:id` — 软删除 status='disabled'（root 限定）

创建 Operator 时同步创建 Identity { type: 'user', name: username }

#### P1-3：Pack 绑定 API

- `POST /api/packs/:packId/bindings` — 邀请 Operator 加入 Pack（owner/admin）
- `GET /api/packs/:packId/bindings` — 列出 Pack 成员（member 以上）
- `PATCH /api/packs/:packId/bindings/:operatorId` — 修改角色（owner）
- `DELETE /api/packs/:packId/bindings/:operatorId` — 移除成员（owner 或自己退出）
- `GET /api/me/bindings` — 当前 Operator 的 Pack 列表

#### P1-4：Agent 绑定 API

- `POST /api/agents/:agentId/bindings` — Operator 绑定到 Agent（需 capability `bind.agent`）
- `DELETE /api/agents/:agentId/bindings/me` — 当前 Operator 解绑
- `GET /api/agents/:agentId/operators` — 列出控制该 Agent 的 Operators

底层复用 `IdentityNodeBinding`（role='active', status='active'）

#### P1-5：能力委托 API

- `POST /api/packs/:packId/grants` — 委托 capability 给某 identity（需自身拥有该 capability）
- `GET /api/packs/:packId/grants` — 列出当前 Operator 发出的 grants
- `DELETE /api/packs/:packId/grants/:grantId` — 撤销委托（grant owner）

支持 TTL（expires_at）和不可转授（默认 revocable=true）

#### P1-6：审计 API

- `GET /api/audit/logs` — Operator 审计日志（root 可见全部，普通用户可见自己）
- `GET /api/audit/logs/me` — 当前 Operator 的审计日志

支持分页（limit/cursor）和过滤（operator_id/pack_id/action/from_date/to_date）

### Phase 2：现有路由接入

#### P2-1：Pack 路由接入 PackAccessGuard

- `/api/packs/:packId/*` 统一接入 `packAccessGuard({ packIdParam: 'packId' })`
- 所有 pack 级读/写路由先过 L1

#### P2-2：Agent 路由接入 CapabilityGuard

- `/api/agent/:id/context` → `capabilityGuard('perceive.agent.context', { targetAgentIdParam: 'id' })`
- `/api/entities/:id/overview` → `capabilityGuard('perceive.entity.overview', { targetAgentIdParam: 'id' })`
- `/api/agent/:id/scheduler/projection` → `capabilityGuard('perceive.agent.scheduler', { targetAgentIdParam: 'id' })`
- 写操作路由接入对应的 `mutate.*` / `invoke.*` capability

#### P2-3：Scheduler 路由接入

- 控制类路由：`capabilityGuard('invoke.scheduler.control')`
- 观测类路由：`capabilityGuard('perceive.scheduler.observability')`

#### P2-4：Plugin 路由接入

- `/api/packs/:packId/plugins/*` → `packAccessGuard` + `capabilityGuard('manage.plugins')`

#### P2-5：System 路由接入

- `/api/system/*`：需要 root 或特定 system capability

### Phase 3：Agent 自主行为权限

#### P3-1：Agent ActionIntent 权限校验

1. 修改 `invocation_dispatcher.ts` 中的 `resolveSubjectEntityId`
2. 当 actor_ref 是 agent 时，调用 `resolveSubjectForAgentAction()`
3. 若 Agent 有控制 Operator（IdentityNodeBinding.identity.type === 'user'），则以该 Operator 的 identity 作为 subject 校验 capability
4. 若无控制 Operator，以 agent 自身为 subject（纯 NPC 走 pack 默认规则）
5. Capability 拒绝时 ActionIntent 状态变为 `dropped`，记录 `drop_reason='CAPABILITY_DENIED'`

#### P3-2：Scheduler 决策权限

1. Scheduler 驱动 Agent 产生 ActionIntent 时，注入正确的 actor_ref
2. EnforcementEngine 执行前，capability 校验走正常 L2 流程
3. 同一 tick 内同一 agent 的 subject 解析结果可缓存（避免重复查询 IdentityNodeBinding）

### Phase 4：Seed 与测试

#### P4-1：Seed 脚本

1. 创建 root Operator（用户名 `root`，密码从 `ROOT_PASSWORD` 环境变量读取）
2. 为 root 创建 Identity + Operator 记录
3. 为默认 pack 创建 root 的 `OperatorPackBinding`（binding_type='owner'）
4. 为示例 Agent 创建 root 的 `IdentityNodeBinding`（role='active'）

#### P4-2：单元测试

1. `tests/unit/operator_auth.spec.ts`：密码哈希、JWT 签发验证、token_hash 注销
2. `tests/unit/pack_access.spec.ts`：PackAccessGuard 逻辑（root 仍需 binding、普通用户拒绝）
3. `tests/unit/subject_resolver.spec.ts`：Operator → Agent 解析、默认 binding 回退、Agent 自主行为解析
4. `tests/unit/operator_grant.spec.ts`：委托/过期自动失效/撤销/不可转授

#### P4-3：集成测试

1. `tests/integration/operator_auth.spec.ts`：登录→请求→登出完整流程
2. `tests/integration/pack_access.spec.ts`：Pack 绑定/拒绝/角色变更场景
3. `tests/integration/agent_binding.spec.ts`：Agent 扮演/解绑/Capability 代管
4. `tests/integration/capability_enforcement.spec.ts`：Capability 拒绝/通过/provenance 返回
5. `tests/integration/operator_grant.spec.ts`：委托链验证、TTL 过期

#### P4-4：E2E 测试

1. 登录 → 绑定 Pack → 操作 Agent → 验证 Capability 拒绝 → 登出
2. 验证 `x-m2-identity` (type='system') 仍可用
3. 验证 `x-m2-identity` (type='agent') 走 Agent 自主行为路径

### Phase 5：前端

#### P5-1：前端认证层

1. `apps/web/stores/operator.ts`：Pinia operator store（login/logout/session/refresh）
2. `apps/web/pages/login.vue`：登录页面
3. `apps/web/composables/useOperatorGuard.ts`：路由守卫（未登录 redirect /login）
4. `apps/web/lib/http/client.ts`：请求自动附带 Bearer token

#### P5-2：Pack 选择界面

1. 登录后显示 Operator 已绑定的 Pack 列表（调用 `/api/me/bindings`）
2. 选择 Pack 后，session 变为 pack-scoped（可选：刷新 token 嵌入 pack_id）
3. 未绑定 Pack 时提示申请加入

#### P5-3：管理界面

1. `apps/web/pages/admin/operators.vue`：Operator 管理（root 可见）
2. `apps/web/pages/admin/audit.vue`：审计日志查看

### Phase 6：文档与验证

#### P6-1：文档更新

- `docs/API.md` — 新增 operator/auth/pack-binding/grant/audit 端点
- `docs/ARCH.md` — 更新中间件链、权限层架构、Operator 层定位
- `docs/LOGIC.md` — 新增 Pack Access / Subject 解析 / OperatorGrant 业务语义
- `docs/capabilities/PROMPT_WORKFLOW.md` — 更新 invocation 中 agent 自主行为的权限校验说明
- `packages/contracts/src/index.ts` — 导出 `operator.js`
- `.limcode/enhancements-backlog.md` — 标记本设计对应的 backlog 项

#### P6-2：最终验证

- `pnpm lint` 通过
- `pnpm typecheck` 通过
- `pnpm test` 全量通过（unit + integration + e2e）

## 6. 从旧方案（Linux DAC）吸取的价值

旧方案 `.limcode/plans/multi-user-linux-dac-implementation.plan.md` 虽已被否定，但以下技术细节可直接复用或借鉴：

1. **认证技术栈**：bcrypt + jsonwebtoken + @types/* 的选型已验证可行，本计划直接复用。
2. **中间件注入位置**：旧方案明确在 `identityInjector()` 之后插入认证中间件，本计划沿用此位置。
3. **环境变量管理**：`JWT_SECRET`（必需）、`JWT_EXPIRES_IN`（默认 24h）、`ROOT_PASSWORD`（seed 用）的环境变量模式直接复用。
4. **Token 注销机制**：旧方案提出 token_hash 存储 + 删除 session 的注销方式，本计划中的 `OperatorSession.token_hash` 与之完全一致。
5. **前端认证层架构**：旧方案中 Pinia store + login 页面 + 路由守卫 + HTTP client Bearer 自动附带的四层前端架构，本计划 P5 阶段直接沿用。
6. **测试组织方式**：旧方案的单元/集成/E2E 测试目录结构和命名约定（`tests/unit/*.spec.ts`、`tests/integration/*.spec.ts`）保持一致。
7. **Seed 脚本 root 用户**：旧方案从环境变量读取 root 密码的方式，本计划 P4-1 直接复用。
8. **请求生命周期缓存**：旧方案中的请求级 Map 缓存思路，可用于本计划 P3-2 中同一 tick 内 Agent subject 解析结果的缓存（减少 IdentityNodeBinding 重复查询）。

## 7. 验收标准

- [ ] 未登录请求访问 Pack 路由返回 401/403
- [ ] Operator-Alice 未绑定 Pack-X 时，访问 Pack-X 返回 403 PACK_ACCESS_DENIED
- [ ] Operator-Alice 绑定 Pack-X 后，可正常访问 Pack-X 的读接口
- [ ] Operator-Alice 绑定 Agent-01 后，操作 Agent-01 API 视同 Agent-01 自身行为
- [ ] Operator-Bob 未绑定 Agent-01 时，无法操作 Agent-01（Capability 拒绝）
- [ ] root Operator 可以在任意 Pack 中创建 binding，但不自动拥有未绑定 Pack 的访问权
- [ ] Operator-Alice 可将 `perceive.agent.logs` 委托给 Operator-Carol（含 TTL）
- [ ] 委托过期后，Operator-Carol 自动失去该 capability
- [ ] Agent 自主产生的 ActionIntent 需通过 capability 校验（不再自动 root）
- [ ] Capability 拒绝时返回 capability_key + subject_entity_id + provenance
- [ ] 所有权限相关操作记录到 OperatorAuditLog
- [ ] `x-m2-identity` (type='system') 仍保留为机器调用通道
- [ ] `x-m2-identity` (type='agent') 请求通过 IdentityNodeBinding 解析到控制 Operator
- [ ] `pnpm lint` + `pnpm typecheck` + 全量测试通过

## 8. 风险与规避

| 风险 | 影响 | 规避措施 |
|------|------|----------|
| 已有路由全部需接入 guard，工作量大 | P2 阶段耗时长 | 提供工厂函数减少样板；优先接入写操作/管理操作路由 |
| Agent 自主行为加权限校验影响性能 | Scheduler 延迟增加 | 缓存 subject 解析结果（同一 tick 内同一 agent 只查一次 binding） |
| Capability 粒度设计过粗或过细 | 权限失控或过度复杂 | 先按 "资源类型+操作类型" 定 capability_key，后续按需拆分 |
| Multi-pack 下 Operator 身份跨 pack 混淆 | 权限泄漏 | PackAccessGuard 强制 pack 边界；session 支持 pack-scoped |
| 旧 x-m2-identity 调用方未适配 | 外部集成破坏 | 保留 x-m2-identity 兼容路径，但标记为 deprecated |
| Operator 绑定频繁变更导致 capability 缓存失效 | 查询性能下降 | AuthorityGrant 查询在 pack-local SQLite，已有索引；OperatorGrant 查 kernel-side Prisma，数据量小 |

## 9. 相关文档

- 设计文档：`.limcode/design/operator-subject-unified-authority-design.md`
- API 契约：`docs/API.md`
- 架构边界：`docs/ARCH.md`
- 业务语义：`docs/LOGIC.md`
- 旧计划（已否定）：`.limcode/plans/multi-user-linux-dac-implementation.plan.md`（本计划完成后删除）

---

*文档状态：执行计划*
*最后更新：2026-04-24*
