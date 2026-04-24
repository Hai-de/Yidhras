# Operator-Subject 统一权限与多用户世界包治理设计

## 1. 背景与问题诊断

### 1.1 当前系统已有的事实（代码层面已成立）

项目已经拥有了一套以 **capability / authority / mediator** 为中心的 world-pack unified governance framework：

- `AuthorityGrant`：声明某实体将某 capability 授予某目标（含 `target_selector_json`、`conditions_json`、`mediated_by_entity_id`）
- `MediatorBinding`：声明某 mediator（如死亡笔记）与某 subject 的绑定关系
- `RuleExecutionRecord`：记录每一条 objective rule 的执行证据链
- `Identity` + `IdentityNodeBinding`：支持 `user` / `agent` / `system` 类型，支持 `active` / `atmosphere` 角色绑定
- `Policy`（kernel-side ABAC）：字段级 allow/deny，面向 API / projection 过滤
- `EnforcementEngine`：统一执行 invocation / objective effect，拒绝或允许由规则决定，而非硬编码
- Pack-local runtime DB：`data/world_packs/<pack_id>/runtime.sqlite`，已承载 world governance core
- Multi-pack runtime：实验性支持，已有 `pack_id` 隔离语义
- Actor Bridge：`materializeActorBridges()` 将 pack actor 自动桥接为 `${packId}:${actor.id}` 的 Agent + Identity + Binding

### 1.2 旧方案（Linux DAC）的核心矛盾

旧方案试图在已有 governance framework 外再叠加一层 Linux rwx DAC，产生以下结构性矛盾：

| 矛盾                             | 说明                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **主体模型断裂**           | 旧方案只有 `User`，但世界内的行为主体是 `Agent`。当 Alice 操作 Agent-X 时，DAC 无法表达 "Alice 是 Agent-X 的控制者"  |
| **与 capability 体系竞争** | 已有 `AuthorityGrant` 表达 "谁能做什么"，新叠加的 `ResourcePermission` 表达 "谁能碰什么"，两者在语义上重叠且无法互通 |
| **Pack 隔离缺失**          | `ResourcePermission` 无 `pack_id`，多 pack 运行时必然冲突                                                            |
| **动态资源困境**           | 白名单模式（无记录即拒绝）与每 tick 产生的 Post / Event / ActionIntent 根本冲突                                          |
| **Agent 自主行为真空**     | Agent 自主决策时 `req.user` 为空，旧方案将其等同于 root，意味着所有 Agent 行为绕过权限检查                             |
| **DAC/ABAC 割裂**          | 两个独立系统，同一语义需配置两次，维护成本翻倍                                                                           |

### 1.3 本设计的前提假设

- **项目未上线**，允许大范围重构
- **核心原则**：不叠加新权限层，而是**将人类 Operator 作为一等 subject 融入现有 capability / authority / identity 体系**
- **目标场景**：多用户共享世界包，人类 Operator 与 Agent 混合，类似游戏服务器

---

## 2. 目标

### 2.1 核心目标

建立 **Operator-Subject 统一权限模型**：

1. 人类 Operator 通过标准 JWT 认证，获得 `OperatorContext`
2. Operator 通过 `IdentityNodeBinding` 与 Agent / WorldEntity 绑定，成为 pack 内的正式 subject
3. Operator 对资源的访问权限，统一由**已有的** `AuthorityResolver` + `EnforcementEngine` + `Policy` 三层判定
4. 新增概念仅用于表达 "Operator 与 Pack/Agent 的绑定关系" 和 "Operator 间的临时能力委托"
5. 所有权限变更都有审计证据（`RuleExecutionRecord` / `Policy` / 新增 `OperatorAuditLog`）

### 2.2 具体目标

1. **认证基础设施**：Operator 登录 → bcrypt + JWT → Bearer Token → `req.operator`
2. **Operator-Pack 绑定**：Operator 被显式邀请/加入某个 Pack，才能看到该 Pack 的资源
3. **Operator-Agent 扮演**：Operator 可绑定一个或多个 Agent，绑定期间操作该 Agent 的 API 视同 Agent 自身行为
4. **能力委托**：Operator A 可临时将某 capability 委托给 Operator B（含 TTL 和不可转授约束）
5. **审计全覆盖**：登录、绑定、委托、解绑、权限拒绝全部记录
6. **向后兼容**：保留 `x-m2-identity` 头作为 system / agent 机器间调用通道，但 Agent 类型请求不再自动视为 root

### 2.3 非目标

1. **不替换现有 capability / authority / mediator 体系** — 本设计是融入而非替代
2. **不实现 OAuth / OIDC / SSO** — 仅用户名+密码
3. **不实现 RBAC 角色继承树** — 用 capability + 委托替代角色层级
4. **不一次性实现前端所有管理界面** — 后端 API 和认证层优先
5. **不改变 Circle / CircleMember 模型** — Circle 保持面向仿真世界内部用途

---

## 3. 设计原则

### 3.1 Operator 是世界包内的一等 Subject

Operator 不是 "系统管理员"，而是世界包内的正式参与者：

- Operator 拥有 `Identity`（type='user'），与 Agent 拥有 `Identity`（type='agent'）地位平等
- Operator 通过 `IdentityNodeBinding` 绑定 Agent，获得 "代管/扮演" 该 Agent 的能力
- 在 `AuthorityResolver` 看来，绑定了 Agent-X 的 Operator-Alice 就是 Agent-X 的 subject

### 3.2 权限的统一入口是 Capability，不是 rwx

- "能否读取 Agent-X 的日志" = `AuthorityResolver` 检查 Operator-Alice 是否具备 `perceive.agent.logs` capability
- "能否修改 Agent-X 的 SNR" = `AuthorityResolver` 检查是否具备 `mutate.agent.snr` capability
- "能否触发 Agent-X 的决策" = `AuthorityResolver` 检查是否具备 `invoke.agent.decide` capability
- 拒绝时返回 capability key + provenance chain，而不是 "Permission denied"

### 3.3 Pack 是权限边界的第一道闸

- 即使 Operator 是 root，若未被绑定到 Pack-X，则无法访问 Pack-X 的任何资源
- Pack 内的权限由 pack 的 `constitution` 声明，平台只负责执行
- 跨 pack 操作必须先通过 `OperatorPackBinding` 获得准入资格

### 3.4 Agent 自主行为不再自动 root

- Agent 类型的 `x-m2-identity` 请求，需通过 `IdentityNodeBinding` 解析到控制 Operator
- 若该 Agent 无控制 Operator（纯 NPC），则走 pack 的 `__world__` 默认 authority
- Scheduler 驱动 Agent 产生的 ActionIntent，其 invocation 仍需通过 `EnforcementEngine` 校验 capability

### 3.5 审计与 provenance 优先

- 每一次权限判定必须能回答：谁？在什么上下文？通过什么 mediator？基于什么 grant？
- 已有 `RuleExecutionRecord` 记录 pack 内执行，新增 `OperatorAuditLog` 记录 operator 层操作

---

## 4. 权限模型总览

### 4.1 请求流

```
HTTP Request
  → CORS / JSON parse
  → IdentityInjector：x-m2-identity → req.identity
  → OperatorAuthMiddleware：Authorization: Bearer <jwt> → 验证 → req.operator
    (若缺失 Bearer 但有 x-m2-identity → 进入 Agent/System 路径)
  → PackAccessGuard：检查 req.operator 是否有该 pack 的访问资格
    → 拒绝：403 PACK_ACCESS_DENIED
  → CapabilityGuard：提取 (pack_id, subject_entity_id, capability_key) → AuthorityResolver
    → 拒绝：403 CAPABILITY_DENIED (含 provenance)
  → EnforcementEngine：执行 mutation / invocation
    → 记录 RuleExecutionRecord
  → PolicyFilter：字段级 allow/deny（ABAC）
  → 响应
```

### 4.2 三层权限协作

| 层级                        | 负责                       | 已有/新增                                       | 判定依据                             |
| --------------------------- | -------------------------- | ----------------------------------------------- | ------------------------------------ |
| **L1: Pack Access**   | "Operator 能否进入该 Pack" | 新增 `OperatorPackBinding`                    | 显式绑定关系                         |
| **L2: Capability**    | "Subject 能否执行该操作"   | 已有 `AuthorityGrant` + `AuthorityResolver` | pack constitution + grant + mediator |
| **L3: Policy (ABAC)** | "能看/改哪些字段"          | 已有 `Policy` + `AccessPolicyService`       | 字段级 allow/deny                    |

三层是**递进过滤**关系：

- L1 拒绝 → 直接 403，不查 L2/L3
- L2 拒绝 → 直接 403，不执行 mutation，不查 L3
- L3 过滤 → 对返回/写入的字段做裁剪

---

## 5. 数据模型 (Prisma Schema)

### 5.1 新增模型

```prisma
// --- Operator Layer ---

model Operator {
  id            String   @id @default(uuid())
  identity_id   String   @unique
  username      String   @unique
  password_hash String
  is_root       Boolean  @default(false)
  status        String   @default("active") // active | disabled | suspended
  display_name  String?
  created_at    BigInt
  updated_at    BigInt

  identity      Identity            @relation(fields: [identity_id], references: [id])
  sessions      OperatorSession[]
  pack_bindings OperatorPackBinding[]
  grants_given  OperatorGrant[]     @relation("GrantGiver")
  audit_logs    OperatorAuditLog[]
}

model OperatorSession {
  id          String  @id @default(uuid())
  operator_id String
  token_hash  String  // SHA-256(JWT)，用于注销时定位
  pack_id     String? // nullable = global session；有值 = pack-scoped session
  expires_at  BigInt
  created_at  BigInt

  operator    Operator @relation(fields: [operator_id], references: [id])

  @@index([operator_id, expires_at])
  @@index([token_hash])
}

model OperatorPackBinding {
  id            String  @id @default(uuid())
  operator_id   String
  pack_id       String
  binding_type  String  @default("member") // owner | admin | member | spectator
  bound_at      BigInt
  bound_by      String? // 邀请者 operator_id
  created_at    BigInt

  operator      Operator @relation(fields: [operator_id], references: [id])

  @@unique([operator_id, pack_id])
  @@index([pack_id, binding_type])
}

model OperatorGrant {
  id                   String  @id @default(uuid())
  giver_operator_id    String
  receiver_identity_id String  // Identity.id（可以是另一个 Operator，也可以是 Agent）
  pack_id              String
  capability_key       String
  scope_json           Json?   // 约束：如 { "target_entity_ids": ["e1", "e2"] }
  revocable            Boolean @default(true)
  expires_at           BigInt?
  created_at           BigInt

  giver                Operator @relation("GrantGiver", fields: [giver_operator_id], references: [id])

  @@index([receiver_identity_id, pack_id])
  @@index([giver_operator_id, pack_id])
}

model OperatorAuditLog {
  id            String  @id @default(uuid())
  operator_id   String?
  pack_id       String?
  action        String  // login | logout | bind_pack | unbind_pack | grant_capability | revoke_grant | capability_denied | pack_access_denied
  target_id     String? // 被操作对象 id
  detail_json   Json?   // 上下文快照
  client_ip     String?
  created_at    BigInt

  operator      Operator? @relation(fields: [operator_id], references: [id])

  @@index([operator_id, created_at])
  @@index([pack_id, action, created_at])
}
```

### 5.2 Identity / IdentityNodeBinding 扩展语义

不需要改动模型，但扩展使用方式：

```prisma
// Identity 已有字段完全保留
model Identity {
  // ... existing fields ...
  
  // 新增反向关系（通过 Prisma 关系，不改动表结构）
  operator      Operator?
}

model IdentityNodeBinding {
  // ... existing fields ...
  
  // 扩展语义：
  // - role='active' + identity.type='user' + agent_id='xxx' 
  //   → Operator 正在扮演/代管 Agent-X
  // - role='atmosphere' + identity.type='user' + atmosphere_node_id='xxx'
  //   → Operator 正在使用 atmosphere node
}
```

### 5.3 不创建 ResourcePermission 表

**关键决策**：不创建任何与 Linux rwx 对等的独立权限表。

原因：

- Pack 准入 → `OperatorPackBinding`
- 操作授权 → `AuthorityGrant`（pack runtime DB）
- 字段过滤 → `Policy`（kernel-side Prisma）
- 临时委托 → `OperatorGrant`
- 绑定关系 → `IdentityNodeBinding`

已有四层覆盖全部场景，无需第五层。

---

## 6. 核心算法

### 6.1 Pack Access 检查 (L1)

```typescript
const checkPackAccess = async (
  context: AppContext,
  operator: OperatorContext,
  packId: string
): Promise<{ allowed: boolean; bindingType: string | null }> => {
  // Root 仍需显式绑定（root 可以在所有 pack 中创建 binding，但不代表自动拥有所有 pack 访问权）
  if (operator.is_root) {
    return { allowed: true, bindingType: 'root' };
  }

  const binding = await context.prisma.operatorPackBinding.findUnique({
    where: { operator_id_pack_id: { operator_id: operator.id, pack_id: packId } }
  });

  if (!binding) {
    return { allowed: false, bindingType: null };
  }

  return { allowed: true, bindingType: binding.binding_type };
};
```

**设计要点**：root 不自动拥有所有 pack 访问权。root 可以在任何 pack 中创建 binding（包括为自己创建），这保证了 root 的审计痕迹仍然存在。

### 6.2 Subject 解析 (Operator → Agent/Entity)

```typescript
const resolveSubjectForOperator = async (
  context: AppContext,
  operator: OperatorContext,
  packId: string,
  targetAgentId?: string
): Promise<{
  subject_entity_id: string | null;
  acting_as_agent_id: string | null;
  provenance: string;
}> => {
  // 1. 如果请求显式指定了 targetAgentId，检查 Operator 是否绑定了该 Agent
  if (targetAgentId) {
    const binding = await context.prisma.identityNodeBinding.findFirst({
      where: {
        identity_id: operator.identity_id,
        agent_id: targetAgentId,
        status: 'active'
      }
    });
    if (binding) {
      return {
        subject_entity_id: targetAgentId,
        acting_as_agent_id: targetAgentId,
        provenance: `operator_bound_as_agent:${targetAgentId}`
      };
    }
    // 未绑定 → 仍然尝试用 Operator 自己的 identity 作为 subject
  }

  // 2. 检查 Operator 在该 pack 中是否有默认绑定的 Agent
  const defaultBinding = await context.prisma.identityNodeBinding.findFirst({
    where: {
      identity_id: operator.identity_id,
      status: 'active',
      // agent_id 非空，且该 agent 属于该 pack（通过 bridged agent ID 前缀匹配）
    },
    orderBy: { created_at: 'asc' }
  });

  if (defaultBinding?.agent_id) {
    return {
      subject_entity_id: defaultBinding.agent_id,
      acting_as_agent_id: defaultBinding.agent_id,
      provenance: `operator_default_binding:${defaultBinding.agent_id}`
    };
  }

  // 3. Operator 以自己的 identity 作为 subject（适用于 world-level 操作）
  return {
    subject_entity_id: operator.identity_id,
    acting_as_agent_id: null,
    provenance: 'operator_direct_identity'
  };
};
```

### 6.3 Capability 检查 (L2)

复用已有 `resolveAuthorityForSubject`，只需确保传入正确的 `subjectEntityId`：

```typescript
const checkCapability = async (
  context: AppContext,
  operator: OperatorContext,
  packId: string,
  capabilityKey: string,
  targetAgentId?: string
): Promise<{
  allowed: boolean;
  matchedGrant: ResolvedCapabilityItem | null;
  provenance: AuthorityResolutionResult;
}> => {
  const subject = await resolveSubjectForOperator(context, operator, packId, targetAgentId);

  const authorityResult = await resolveAuthorityForSubject(context, {
    packId,
    subjectEntityId: subject.subject_entity_id
  });

  const matchedGrant = authorityResult.resolved_capabilities.find(
    cap => cap.capability_key === capabilityKey
  ) ?? null;

  return {
    allowed: matchedGrant !== null,
    matchedGrant,
    provenance: authorityResult
  };
};
```

### 6.4 OperatorGrant 委托检查

```typescript
const checkOperatorGrant = async (
  context: AppContext,
  receiverIdentityId: string,
  packId: string,
  capabilityKey: string
): Promise<{
  allowed: boolean;
  grant: OperatorGrant | null;
}> => {
  const now = context.sim.getCurrentTick();

  const grant = await context.prisma.operatorGrant.findFirst({
    where: {
      receiver_identity_id: receiverIdentityId,
      pack_id: packId,
      capability_key: capabilityKey,
      OR: [{ expires_at: null }, { expires_at: { gt: now } }]
    },
    orderBy: { created_at: 'desc' }
  });

  return { allowed: grant !== null, grant };
};
```

### 6.5 Agent 自主行为的权限校验

当 Agent 自主产生 ActionIntent 时：

```typescript
const resolveSubjectForAgentAction = async (
  context: AppContext,
  agentId: string,
  packId: string
): Promise<string | null> => {
  // 1. 查找控制该 Agent 的 Operator
  const binding = await context.prisma.identityNodeBinding.findFirst({
    where: {
      agent_id: agentId,
      role: 'active',
      status: 'active'
    },
    include: { identity: true }
  });

  if (binding?.identity?.type === 'user') {
    // 该 Agent 由 Operator 控制，以 Operator 的 identity 作为权限校验主体
    // 但实际执行仍保留 agentId 作为 actor_ref
    return binding.identity.id;
  }

  // 2. 纯 NPC，以 agent 自身为 subject
  return agentId;
};
```

---

## 7. 认证流程

### 7.1 登录

```
POST /api/auth/login
  { username, password }
  
  1. Operator.findUnique({ username })
  2. bcrypt.compare(password, operator.password_hash)
  3. 若 operator.status != 'active' → 403 OPERATOR_DISABLED
  4. 签发 JWT: { sub: operator.id, identity_id, username, is_root, iat, exp }
  5. 存储 token_hash 到 OperatorSession（支持 pack-scoped session）
  6. 写 OperatorAuditLog { action: 'login', operator_id, client_ip }
  7. 返回 { token, operator: { id, username, is_root } }
```

### 7.2 请求认证

```
Authorization: Bearer <jwt>

认证中间件：
  1. 验证 JWT 签名 + 过期
  2. 查 OperatorSession 确认 token_hash 未被注销
  3. 查 Operator 确认 status == 'active'
  4. req.operator = { id, identity_id, username, is_root }
  5. 同时设置 req.identity = { id: identity_id, type: 'user', name: username }
```

### 7.3 登出

```
POST /api/auth/logout
  
  1. 从 Authorization header 提取 token
  2. 计算 token_hash
  3. 删除 OperatorSession WHERE token_hash = ?
  4. 写 OperatorAuditLog { action: 'logout' }
```

### 7.4 与 x-m2-identity 的兼容

| 场景                               | 行为                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| 同时有 Bearer + x-m2-identity      | 以 Bearer 为准，x-m2-identity 被忽略                                  |
| 仅有 Bearer                        | 标准 Operator 认证                                                    |
| 仅有 x-m2-identity (type='system') | 创建 system OperatorContext（等同于旧 SYSTEM_IDENTITY，但需显式声明） |
| 仅有 x-m2-identity (type='agent')  | 进入 Agent 自主行为路径，解析控制 Operator 或按 pack 默认规则处理     |
| 两者皆无                           | 匿名访问，Pack Access 直接拒绝（除非 route 显式标记 public）          |

---

## 8. API 端点设计

### 8.1 认证

| 方法 | 路径                  | 说明                     | 鉴权   |
| ---- | --------------------- | ------------------------ | ------ |
| POST | `/api/auth/login`   | 用户名+密码 → JWT       | 无     |
| POST | `/api/auth/logout`  | 注销当前 session         | Bearer |
| GET  | `/api/auth/session` | 当前 operator 信息       | Bearer |
| POST | `/api/auth/refresh` | 刷新 JWT（延长 session） | Bearer |

### 8.2 Operator 管理 (root 限定)

| 方法   | 路径                   | 说明                                       |
| ------ | ---------------------- | ------------------------------------------ |
| POST   | `/api/operators`     | 创建 Operator                              |
| GET    | `/api/operators`     | Operator 列表                              |
| GET    | `/api/operators/:id` | Operator 详情                              |
| PATCH  | `/api/operators/:id` | 修改 Operator（状态/密码）                 |
| DELETE | `/api/operators/:id` | 删除 Operator（软删除：status='disabled'） |

### 8.3 Pack 绑定管理

| 方法   | 路径                                        | 说明                                   | 鉴权                            |
| ------ | ------------------------------------------- | -------------------------------------- | ------------------------------- |
| POST   | `/api/packs/:packId/bindings`             | 邀请 Operator 加入 Pack（owner/admin） | Bearer + L1 owner/admin         |
| GET    | `/api/packs/:packId/bindings`             | 列出 Pack 成员                         | Bearer + L1 member              |
| PATCH  | `/api/packs/:packId/bindings/:operatorId` | 修改成员角色                           | Bearer + L1 owner               |
| DELETE | `/api/packs/:packId/bindings/:operatorId` | 移除成员                               | Bearer + L1 owner（或自己退出） |
| GET    | `/api/me/bindings`                        | 当前 Operator 的 Pack 列表             | Bearer                          |

### 8.4 Agent 绑定管理

| 方法   | 路径                                 | 说明                          | 鉴权                                           |
| ------ | ------------------------------------ | ----------------------------- | ---------------------------------------------- |
| POST   | `/api/agents/:agentId/bindings`    | Operator 绑定到 Agent         | Bearer + L1 member + capability `bind.agent` |
| DELETE | `/api/agents/:agentId/bindings/me` | 当前 Operator 解绑            | Bearer                                         |
| GET    | `/api/agents/:agentId/operators`   | 列出控制该 Agent 的 Operators | Bearer + L1 member                             |

### 8.5 能力委托

| 方法   | 路径                                   | 说明                            | 鉴权                                       |
| ------ | -------------------------------------- | ------------------------------- | ------------------------------------------ |
| POST   | `/api/packs/:packId/grants`          | 委托 capability 给某 identity   | Bearer + L1 member + 自身拥有该 capability |
| GET    | `/api/packs/:packId/grants`          | 列出当前 Operator 发出的 grants | Bearer + L1 member                         |
| DELETE | `/api/packs/:packId/grants/:grantId` | 撤销委托                        | Bearer + grant owner                       |

### 8.6 审计

| 方法 | 路径                   | 说明                                                 | 鉴权   |
| ---- | ---------------------- | ---------------------------------------------------- | ------ |
| GET  | `/api/audit/logs`    | Operator 审计日志（root 可见全部，普通用户可见自己） | Bearer |
| GET  | `/api/audit/logs/me` | 当前 Operator 的审计日志                             | Bearer |

---

## 9. Contracts 新增 (packages/contracts)

新增 `packages/contracts/src/operator.ts`：

```typescript
export const loginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128)
}).strict();

export const createOperatorRequestSchema = z.object({
  username: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128),
  display_name: z.string().max(128).optional(),
  is_root: z.boolean().optional()
}).strict();

export const createPackBindingRequestSchema = z.object({
  operator_id: z.string().min(1),
  binding_type: z.enum(['owner', 'admin', 'member', 'spectator'])
}).strict();

export const updatePackBindingRequestSchema = z.object({
  binding_type: z.enum(['owner', 'admin', 'member', 'spectator'])
}).strict();

export const createAgentBindingRequestSchema = z.object({
  operator_id: z.string().min(1),
  role: z.enum(['active', 'atmosphere']).default('active')
}).strict();

export const createOperatorGrantRequestSchema = z.object({
  receiver_identity_id: z.string().min(1),
  capability_key: z.string().min(1),
  scope_json: z.record(z.unknown()).optional(),
  revocable: z.boolean().default(true),
  expires_at: z.string().nullable().optional() // ISO 8601 datetime string
}).strict();

export const operatorAuditLogQuerySchema = z.object({
  operator_id: z.string().optional(),
  pack_id: z.string().optional(),
  action: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional()
}).strict();
```

---

## 10. 中间件设计

### 10.1 OperatorAuthMiddleware (`src/app/middleware/operator_auth.ts`)

```typescript
interface OperatorContext {
  id: string;
  identity_id: string;
  username: string;
  is_root: boolean;
}

interface OperatorRequest extends IdentityRequest {
  operator?: OperatorContext;
}

export const operatorAuthMiddleware = () => {
  return async (req: OperatorRequest, _res: Response, next: NextFunction) => {
    const bearer = req.header('authorization');
    if (bearer?.startsWith('Bearer ')) {
      const token = bearer.slice(7);
      const operator = await verifyOperatorToken(token);
      if (operator) {
        req.operator = operator;
        req.identity = {
          id: operator.identity_id,
          type: 'user',
          name: operator.username
        };
      }
      next();
      return;
    }

    // 无 Bearer，保留 x-m2-identity 路径
    next();
  };
};
```

### 10.2 PackAccessGuard (`src/app/middleware/pack_access.ts`)

```typescript
export const packAccessGuard = (options: {
  packIdParam?: string;    // 从 req.params 提取 packId 的参数名
  packIdQuery?: string;    // 或从 req.query
  allowPublic?: boolean;   // 是否允许未绑定用户访问（仅读接口）
}) => {
  return async (req: OperatorRequest, _res: Response, next: NextFunction) => {
    const packId = options.packIdParam
      ? req.params[options.packIdParam]
      : options.packIdQuery
        ? req.query[options.packIdQuery]
        : null;

    if (!packId) {
      next(); // 非 pack 路由，跳过
      return;
    }

    // system / agent 路径的 pack access 检查（略）
    if (!req.operator) {
      if (options.allowPublic) { next(); return; }
      throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required');
    }

    const access = await checkPackAccess(context, req.operator, packId);
    if (!access.allowed) {
      throw new ApiError(403, 'PACK_ACCESS_DENIED', 'Operator not bound to this pack');
    }

    next();
  };
};
```

### 10.3 CapabilityGuard (`src/app/middleware/capability.ts`)

```typescript
export const capabilityGuard = (capabilityKey: string, options?: {
  targetAgentIdParam?: string;
}) => {
  return async (req: OperatorRequest, _res: Response, next: NextFunction) => {
    const packId = req.params.packId ?? req.query.packId;
    if (!packId) {
      throw new ApiError(400, 'PACK_ID_REQUIRED', 'Pack ID is required for capability check');
    }

    const targetAgentId = options?.targetAgentIdParam
      ? req.params[options.targetAgentIdParam]
      : undefined;

    const result = await checkCapability(context, req.operator!, packId, capabilityKey, targetAgentId);
    if (!result.allowed) {
      throw new ApiError(403, 'CAPABILITY_DENIED', `Missing capability: ${capabilityKey}`, {
        capability_key: capabilityKey,
        subject_entity_id: result.provenance.subject_entity_id
      });
    }

    next();
  };
};
```

---

## 11. 与现有系统的协作

### 11.1 与 Identity / IdentityNodeBinding 的协作

```
Operator 创建时：
  1. 创建 Identity { id: uuid, type: 'user', name: username }
  2. 创建 Operator { identity_id: identity.id, ... }

Operator 绑定 Agent 时：
  1. 创建 IdentityNodeBinding { identity_id: operator.identity_id, agent_id: targetAgentId, role: 'active', status: 'active' }
  2. AuthorityResolver 自动将该 Operator 识别为 Agent 的 subject

Agent 自主行为时：
  1. 查找 Agent 的 active IdentityNodeBinding
  2. 若 binding.identity.type == 'user'，则以该 identity 作为 subject 校验 capability
```

### 11.2 与 AuthorityResolver / EnforcementEngine 的协作

```
Operator 操作 Agent-X：
  1. PackAccessGuard 检查 Operator-Pack 绑定
  2. resolveSubjectForOperator → 找到 Operator 绑定的 Agent-X 作为 subject_entity_id
  3. AuthorityResolver 在 Pack-X 的 runtime DB 中查找 AuthorityGrant
     WHERE target_selector matches subject_entity_id
  4. 若 capability 匹配 → EnforcementEngine 执行
  5. RuleExecutionRecord 记录执行证据
```

### 11.3 与 Policy (ABAC) 的协作

```
Operator 读取 Agent 详情：
  1. L1 PackAccessGuard：通过
  2. L2 CapabilityGuard：`perceive.agent.overview` 通过
  3. 路由 handler 读取 Agent 数据
  4. L3 PolicyFilter：filterReadableFieldsByAccessPolicy(context, req.identity, ...)
     - req.identity 是 Operator 的 Identity（type='user'）
     - Policy.subject_type='user' 或 subject_id=identity.id 的规则生效
  5. 返回过滤后的字段
```

### 11.4 与 Circle 的协作

Circle 保持面向仿真世界内部，不与 Operator 层直接交互。

但若 world-pack 的 `constitution` 中声明了基于 Circle membership 的 `AuthorityGrant`：

- `target_selector.kind='circle_member'` + `circle_id='xxx'`
- 则 Agent（被 Operator 绑定后）的 capability 会自动包含 Circle 维度

### 11.5 与 SimulationManager / Multi-Pack Runtime 的协作

```
Multi-pack 场景：
  - Pack-A 的 Operator-Alice 与 Pack-B 的 Operator-Alice 是同一物理 Operator
  - 但 OperatorPackBinding 是 pack-scoped 的
  - OperatorSession 支持 pack-scoped（token 中可声明 pack_id）
  - PackAccessGuard 以 pack 为单位独立检查
```

---

## 12. 实施步骤

### Phase 0：基础设施 (P0)

**P0-1：数据模型迁移**

1. Prisma schema 新增 `Operator`, `OperatorSession`, `OperatorPackBinding`, `OperatorGrant`, `OperatorAuditLog`
2. `Identity` 增加 `operator` 反向关系（不改动表结构）
3. 生成 migration：`pnpm exec prisma migrate dev --name add_operator_governance`
4. 验证 prisma generate 成功

**P0-2：认证基础设施**

1. 安装 `bcrypt` + `jsonwebtoken` + `@types/*`
2. 创建 `src/operator/auth/password.ts`：bcrypt hash/compare
3. 创建 `src/operator/auth/token.ts`：JWT 签发/验证，token_hash 存 session
4. 创建 `src/operator/auth/types.ts`：`OperatorContext`
5. 创建 `src/app/middleware/operator_auth.ts`：认证中间件
6. 在 `create_app.ts` 中间件链中 `identityInjector()` 之后插入 `operatorAuthMiddleware()`
7. 环境变量：`JWT_SECRET`（必需），`JWT_EXPIRES_IN`（默认 24h）

**P0-3：Pack Access 层**

1. 创建 `src/operator/guard/pack_access.ts`：`checkPackAccess()` + `packAccessGuard` 中间件
2. 创建 `src/operator/guard/subject_resolver.ts`：`resolveSubjectForOperator()`
3. 创建 `src/operator/audit/logger.ts`：`logOperatorAudit()`

### Phase 1：API 与管理 (P1)

**P1-1：认证 API**

1. 创建 `src/app/services/operator_auth.ts`：login/logout/session/refresh
2. 创建 `src/app/routes/operator_auth.ts`：认证路由
3. 注册到路由系统

**P1-2：Operator CRUD API**

1. 创建 `src/app/services/operators.ts`：Operator CRUD
2. 创建 `src/app/routes/operators.ts`
3. root 限定

**P1-3：Pack 绑定 API**

1. 创建 `src/app/services/operator_pack_bindings.ts`
2. 创建 `src/app/routes/operator_pack_bindings.ts`
3. 绑定/解绑/列表

**P1-4：Agent 绑定 API**

1. 创建 `src/app/services/operator_agent_bindings.ts`
2. 创建 `src/app/routes/operator_agent_bindings.ts`
3. 复用 `IdentityNodeBinding` 作为底层存储

**P1-5：能力委托 API**

1. 创建 `src/app/services/operator_grants.ts`
2. 创建 `src/app/routes/operator_grants.ts`
3. 委托/撤销/列表

**P1-6：审计 API**

1. 创建 `src/app/services/operator_audit.ts`
2. 创建 `src/app/routes/operator_audit.ts`
3. 分页查询

### Phase 2：现有路由接入 (P2)

**P2-1：Pack 路由接入 PackAccessGuard**

- `/api/packs/:packId/*` 统一接入 `packAccessGuard({ packIdParam: 'packId' })`
- `/api/packs/:packId/overview` → allowPublic: false（需要显式绑定）
- `/api/packs/:packId/projections/timeline` → 同上

**P2-2：Agent 路由接入 CapabilityGuard**

- `/api/agent/:id/context` → `capabilityGuard('perceive.agent.context', { targetAgentIdParam: 'id' })`
- `/api/entities/:id/overview` → `capabilityGuard('perceive.entity.overview', { targetAgentIdParam: 'id' })`
- `/api/agent/:id/scheduler/projection` → `capabilityGuard('perceive.agent.scheduler', { targetAgentIdParam: 'id' })`

**P2-3：Scheduler 路由接入**

- Scheduler 控制类路由：需要 `capabilityGuard('invoke.scheduler.control')`
- Scheduler 观测类路由：需要 `capabilityGuard('perceive.scheduler.observability')`

**P2-4：Plugin 路由接入**

- `/api/packs/:packId/plugins/*` → packAccessGuard + capabilityGuard('manage.plugins')

**P2-5：System 路由**

- `/api/system/*`：需要 root 或特定 capability

### Phase 3：Agent 自主行为权限 (P3)

**P3-1：Agent ActionIntent 权限校验**

1. 修改 `invocation_dispatcher.ts` 中的 `resolveSubjectEntityId`
2. 当 actor_ref 是 agent 时，调用 `resolveSubjectForAgentAction()`
3. 若 Agent 有控制 Operator，则以 Operator identity 校验 capability
4. 若无控制 Operator，以 agent 自身为 subject

**P3-2：Scheduler 决策权限**

1. Scheduler 驱动的 ActionIntent 产生时，注入正确的 actor_ref
2. EnforcementEngine 执行前，capability 校验走正常流程

### Phase 4：Seed 与测试 (P4)

**P4-1：Seed 脚本**

1. 创建 root Operator（用户名 `root`，密码从 `ROOT_PASSWORD` 环境变量读取）
2. 为 root 创建 Identity + Operator 记录
3. 为默认 pack 创建 root 的 `OperatorPackBinding`（binding_type='owner'）
4. 为示例 Agent 创建 root 的 `IdentityNodeBinding`

**P4-2：单元测试**

1. `tests/unit/operator_auth.spec.ts`：密码哈希、JWT 签发验证
2. `tests/unit/pack_access.spec.ts`：PackAccessGuard 逻辑
3. `tests/unit/subject_resolver.spec.ts`：Operator → Agent 解析
4. `tests/unit/operator_grant.spec.ts`：委托/过期/撤销

**P4-3：集成测试**

1. `tests/integration/operator_auth.spec.ts`：登录→请求→登出
2. `tests/integration/pack_access.spec.ts`：Pack 绑定/拒绝场景
3. `tests/integration/agent_binding.spec.ts`：Agent 扮演/解绑
4. `tests/integration/capability_enforcement.spec.ts`：Capability 拒绝/通过
5. `tests/integration/operator_grant.spec.ts`：委托链验证

**P4-4：E2E 测试**

1. 登录 → 绑定 Pack → 操作 Agent → 验证 Capability 拒绝 → 登出

### Phase 5：前端 (P5)

**P5-1：前端认证层**

1. `apps/web/stores/operator.ts`：Pinia operator store
2. `apps/web/pages/login.vue`：登录页面
3. `apps/web/composables/useOperatorGuard.ts`：路由守卫
4. `apps/web/lib/http/client.ts`：自动附带 Bearer token

**P5-2：Pack 选择界面**

1. 登录后显示 Operator 已绑定的 Pack 列表
2. 选择 Pack 后，session 变为 pack-scoped
3. 未绑定 Pack 时提示申请加入

**P5-3：管理界面**

1. `apps/web/pages/admin/operators.vue`：Operator 管理（root）
2. `apps/web/pages/admin/audit.vue`：审计日志

---

## 13. 验收标准

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

---

## 14. 风险与规避

| 风险                                          | 影响               | 规避措施                                                                                             |
| --------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| 已有路由全部需接入 guard，工作量大            | P2 阶段耗时长      | 提供工厂函数减少样板；优先接入写操作/管理操作路由                                                    |
| Agent 自主行为加权限校验影响性能              | Scheduler 延迟增加 | 缓存 subject 解析结果（同一 tick 内同一 agent 只查一次 binding）                                     |
| Capability 粒度设计过粗或过细                 | 权限失控或过度复杂 | 先按 "资源类型+操作类型" 定 capability_key（如 `perceive.agent`），后续可按需拆分                  |
| Multi-pack 下 Operator 身份跨 pack 混淆       | 权限泄漏           | PackAccessGuard 强制 pack 边界；session 支持 pack-scoped                                             |
| 旧 x-m2-identity 调用方未适配                 | 外部集成破坏       | 保留 x-m2-identity 兼容路径，但标记为 deprecated                                                     |
| Operator 绑定频繁变更导致 capability 缓存失效 | 查询性能下降       | AuthorityGrant 查询本身在 pack-local SQLite，已有索引；OperatorGrant 查 kernel-side Prisma，数据量小 |

---

## 15. 与旧方案（Linux DAC）的对比

| 维度           | 旧方案 (Linux DAC)                                   | 本方案 (Operator-Subject)                 |
| -------------- | ---------------------------------------------------- | ----------------------------------------- |
| 权限模型       | Linux rwx 位                                         | Capability + AuthorityGrant               |
| 权限主体       | 只有 User                                            | Operator + Agent 统一为 Identity Subject  |
| 与现有框架关系 | 外叠加，竞争                                         | 融入，复用已有 governance framework       |
| Pack 隔离      | 无 pack_id                                           | Pack 是第一道边界                         |
| 动态资源       | 白名单模式导致全部拒绝                               | Capability 规则自动覆盖动态资源           |
| Agent 自主行为 | 自动 root                                            | 正常 capability 校验                      |
| 委托/租赁      | 无                                                   | OperatorGrant 支持 TTL + 不可转授         |
| 审计           | 无                                                   | OperatorAuditLog + RuleExecutionRecord    |
| 数据表         | 新增 4 表 (User/Group/Membership/ResourcePermission) | 新增 5 表，但删除 ResourcePermission 概念 |
| 实现工作量     | 中等（需重写大量路由权限逻辑）                       | 较大（需重写认证层 + 接入 capability 层） |
| 长期可维护性   | 低（两套权限系统并行）                               | 高（统一在 capability 框架内）            |

---

## 16. 相关文档更新

实施本设计时，需同步更新以下文档：

- `docs/API.md` — 新增 operator/auth/pack-binding/grant/audit 端点
- `docs/ARCH.md` — 更新中间件链、权限层架构、Operator 层定位
- `docs/LOGIC.md` — 新增 Pack Access / Subject 解析 / OperatorGrant 业务语义
- `docs/capabilities/PROMPT_WORKFLOW.md` — 更新 invocation 中 agent 自主行为的权限校验说明
- `packages/contracts/src/index.ts` — 导出 `operator.js`
- `.limcode/enhancements-backlog.md` — 标记本设计对应的 backlog 项

---

## 17. 开放问题

1. **Operator 能否同时绑定多个 Agent 并在它们之间切换？**

   - 当前设计支持（IdentityNodeBinding 允许多条）
   - API 层面需要在请求中显式指定 `acting_as_agent_id` 或使用默认绑定
2. **Spectator（旁观者）binding_type 的具体能力范围？**

   - 初步定义为：仅有 `perceive.*` 读权限，无 `mutate/invoke/govern`
   - 具体 capability 白名单需在 pack constitution 中声明
3. **Agent 自主行为的 capability 拒绝如何处理？**

   - 当前设计：拒绝后 ActionIntent 状态变为 `dropped`，记录 `drop_reason='CAPABILITY_DENIED'`
   - 是否需要 scheduler 重试或通知控制 Operator？
4. **Operator 离线期间，其绑定的 Agent 自主行为是否受限？**

   - 初步结论：不受限。Agent 自主行为不依赖 Operator 在线状态，capability 由 pack constitution 和 AuthorityGrant 决定。
5. **是否需要引入 `OperatorRole`（角色模板）减少重复配置？**

   - 当前设计：不需要。用 capability + `binding_type` + pack constitution 组合替代。
   - 若后续 binding_type 扩展过多，可考虑引入 role template。

---

*文档状态：设计草案，已通过*
*最后更新：2026-04-24*
