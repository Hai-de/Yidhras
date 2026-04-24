# Operator-Subject 统一权限 — Contract-First 契约层交付

## 概述

本次按 Contract-First 模式完成 P0+P1 阶段的**接口/模型/类型定义**，不包含业务逻辑实现。

## 交付清单

### 1. Prisma 数据模型 (`apps/server/prisma/schema.prisma`)

新增 5 个模型 + 1 个反向关系：

| 模型 | 用途 |
|------|------|
| `Operator` | 人类操作员（id/identity_id/username/password_hash/is_root/status/display_name） |
| `OperatorSession` | JWT session（token_hash/pack_id/expires_at） |
| `OperatorPackBinding` | Operator↔Pack 绑定（binding_type: owner/admin/member/spectator） |
| `OperatorGrant` | 能力委托（giver/receiver/capability_key/scope/expires_at） |
| `OperatorAuditLog` | 审计日志（action/target_id/detail_json/client_ip） |
| `Identity.operator` | Identity → Operator 反向关系（不改动表结构） |

### 2. Contracts 包 (`packages/contracts/src/operator.ts`)

所有 zod schema 已定义：

- `loginRequestSchema` — 登录请求
- `createOperatorRequestSchema` — 创建 Operator
- `updateOperatorRequestSchema` — 更新 Operator
- `createPackBindingRequestSchema` — Pack 绑定
- `updatePackBindingRequestSchema` — 修改绑定角色
- `createAgentBindingRequestSchema` — Agent 绑定
- `createOperatorGrantRequestSchema` — 能力委托
- `operatorAuditLogQuerySchema` — 审计查询

辅助枚举：
- `operatorStatusSchema` (active/disabled/suspended)
- `operatorPackBindingTypeSchema` (owner/admin/member/spectator)
- `operatorAuditActionSchema` (13 种操作类型)

### 3. Auth 类型 (`apps/server/src/operator/auth/types.ts`)

- `OperatorContext` — req.operator 注入类型
- `JwtPayload` — JWT token 结构
- `OperatorRequest` — 扩展 Express Request（operator + identity 双路径）
- `LoginResponse` / `SessionResponse` — API 响应类型

### 4. Guard 类型 (`apps/server/src/operator/guard/types.ts`)

- `PackAccessResult` — L1 准入结果（root 也需显式绑定）
- `PackAccessGuardOptions` — Guard 中间件选项
- `SubjectResolutionResult` — Operator→Subject 解析结果（7 种 provenance 路径）
- `CapabilityCheckResult` — L2 能力检查结果
- `CapabilityGuardOptions` — Capability Guard 选项
- `OperatorPolicyContext` — L3 Policy 过滤扩展

### 5. 常量文件 (`apps/server/src/operator/constants.ts`)

- `OPERATOR_STATUS` — 状态枚举
- `PACK_BINDING_TYPE` + `PACK_BINDING_TYPE_LEVEL` — 绑定类型 + 等级映射
- `AUDIT_ACTION` — 13 种审计操作
- `OPERATOR_CAPABILITY` — 26 个预声明 capability key（perceive/mutate/invoke/bind/govern/manage）
- `OPERATOR_ERROR_CODE` — 13 种 API 错误码
- 认证配置常量（DEFAULT_JWT_EXPIRES_IN / DEFAULT_BCRYPT_ROUNDS / ROOT_OPERATOR_USERNAME）

### 6. 配置扩展 (`apps/server/src/config/schema.ts` + `runtime_config.ts`)

新增 `operator` 配置段：

```yaml
operator:
  auth:
    jwt_secret: <min 16 chars>
    jwt_expires_in: 24h
    bcrypt_rounds: 12
  root:
    default_password: <min 8 chars>
```

环境变量覆盖：
- `OPERATOR_JWT_SECRET`
- `OPERATOR_JWT_EXPIRES_IN`
- `OPERATOR_BCRYPT_ROUNDS`
- `OPERATOR_ROOT_DEFAULT_PASSWORD`

新增 getter：
- `getOperatorAuthConfig()`
- `getOperatorRootConfig()`

## 关键设计决策

### root 权限策略（审计优先）

```
root 无 OperatorPackBinding → PackAccessResult { allowed: false, reason: 'NOT_BOUND' }
root 有 OperatorPackBinding → PackAccessResult { allowed: true, bindingType: 'owner' }
```

root 可以为自己创建任意 Pack 的 binding（在创建时不受限制），但没有 binding 记录就无法访问 — 确保所有访问均可审计。

### 三层权限协作

| 层级 | 文件 | 职责 |
|------|------|------|
| L1: Pack Access | `guard/types.ts` → `PackAccessGuardOptions` | Operator↔Pack 准入 |
| L2: Capability | `guard/types.ts` → `CapabilityCheckResult` | Subject↔Capability 判定 |
| L3: Policy | `guard/types.ts` → `OperatorPolicyContext` | 字段级 ABAC |

### Capability Keys 策略

预声明的 26 个 key 作为基础类型安全锚点 + 前端引用常量，世界包的 `constitution.capabilities` 可以动态扩展更多 key。

## 待实现（下一阶段）

以下是 Contract-First 之后的服务层实现任务：

- P0-2 实现：`operator/auth/password.ts`（bcrypt hash/compare）、`operator/auth/token.ts`（JWT 签发/验证）
- P0-3 实现：`operator/guard/pack_access.ts`、`operator/guard/subject_resolver.ts`、`operator/audit/logger.ts`
- P1-1~P1-6：路由 + Service 层实现
- P0-2：`create_app.ts` 中间件链插入 `operatorAuthMiddleware`
