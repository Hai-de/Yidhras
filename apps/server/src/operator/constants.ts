// ── Operator 状态 ──

export const OPERATOR_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  SUSPENDED: 'suspended'
} as const

export type OperatorStatus = (typeof OPERATOR_STATUS)[keyof typeof OPERATOR_STATUS]

export const OPERATOR_STATUS_VALUES: readonly string[] =
  Object.values(OPERATOR_STATUS)

// ── Pack Binding 类型 ──

export const PACK_BINDING_TYPE = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  SPECTATOR: 'spectator'
} as const

export type PackBindingType =
  (typeof PACK_BINDING_TYPE)[keyof typeof PACK_BINDING_TYPE]

export const PACK_BINDING_TYPE_VALUES: readonly string[] =
  Object.values(PACK_BINDING_TYPE)

/**
 * binding_type 等级映射（用于权限比较）。
 * 数字越大权限越高。owner(3) > admin(2) > member(1) > spectator(0)
 */
export const PACK_BINDING_TYPE_LEVEL: Record<PackBindingType, number> = {
  [PACK_BINDING_TYPE.OWNER]: 3,
  [PACK_BINDING_TYPE.ADMIN]: 2,
  [PACK_BINDING_TYPE.MEMBER]: 1,
  [PACK_BINDING_TYPE.SPECTATOR]: 0
}

// ── Audit 操作类型 ──

export const AUDIT_ACTION = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  BIND_PACK: 'bind_pack',
  UNBIND_PACK: 'unbind_pack',
  GRANT_CAPABILITY: 'grant_capability',
  REVOKE_GRANT: 'revoke_grant',
  CAPABILITY_DENIED: 'capability_denied',
  PACK_ACCESS_DENIED: 'pack_access_denied',
  CREATE_OPERATOR: 'create_operator',
  UPDATE_OPERATOR: 'update_operator',
  DELETE_OPERATOR: 'delete_operator',
  BIND_AGENT: 'bind_agent',
  UNBIND_AGENT: 'unbind_agent'
} as const

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION]

export const AUDIT_ACTION_VALUES: readonly string[] =
  Object.values(AUDIT_ACTION)

// ── Capability Keys（基础预声明） ──
// 这些 key 用于 Operator 层和 guard 中间件的类型安全。
// 世界包的 constitution 中可以声明更多 capability 并动态扩展。

export const OPERATOR_CAPABILITY = {
  // Agent 感知类
  PERCEIVE_AGENT_CONTEXT: 'perceive.agent.context',
  PERCEIVE_AGENT_OVERVIEW: 'perceive.agent.overview',
  PERCEIVE_AGENT_SCHEDULER: 'perceive.agent.scheduler',
  PERCEIVE_AGENT_LOGS: 'perceive.agent.logs',
  PERCEIVE_AGENT_MEMORY: 'perceive.agent.memory',

  // Entity 感知类
  PERCEIVE_ENTITY_OVERVIEW: 'perceive.entity.overview',
  PERCEIVE_ENTITY_STATE: 'perceive.entity.state',

  // Scheduler 观测类
  PERCEIVE_SCHEDULER_OBSERVABILITY: 'perceive.scheduler.observability',

  // Agent 操作类
  MUTATE_AGENT_SNR: 'mutate.agent.snr',
  MUTATE_AGENT_STATE: 'mutate.agent.state',
  MUTATE_AGENT_RELATIONSHIP: 'mutate.agent.relationship',

  // 调用类
  INVOKE_AGENT_DECIDE: 'invoke.agent.decide',
  INVOKE_SCHEDULER_CONTROL: 'invoke.scheduler.control',

  // 绑定类
  BIND_AGENT: 'bind.agent',
  BIND_ENTITY: 'bind.entity',

  // 治理类
  GOVERN_PACK_OWNER: 'govern.pack.owner',
  GOVERN_PACK_ADMIN: 'govern.pack.admin',
  GOVERN_PACK_MEMBER: 'govern.pack.member',
  MANAGE_PLUGINS: 'manage.plugins',

  // Operator 管理类（root 限定）
  GOVERN_OPERATORS: 'govern.operators',
  GOVERN_AUDIT_LOGS: 'govern.audit_logs'
} as const

export type OperatorCapabilityKey =
  (typeof OPERATOR_CAPABILITY)[keyof typeof OPERATOR_CAPABILITY]

export const OPERATOR_CAPABILITY_VALUES: readonly string[] =
  Object.values(OPERATOR_CAPABILITY)

// ── JWT / 认证配置常量 ──

export const DEFAULT_JWT_EXPIRES_IN = '24h'
export const DEFAULT_BCRYPT_ROUNDS = 12

// ── 默认 Operator 名称 ──

export const ROOT_OPERATOR_USERNAME = 'root'

// ── API 错误码 ──

export const OPERATOR_ERROR_CODE = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  OPERATOR_DISABLED: 'OPERATOR_DISABLED',
  OPERATOR_NOT_FOUND: 'OPERATOR_NOT_FOUND',
  OPERATOR_REQUIRED: 'OPERATOR_REQUIRED',
  PACK_ACCESS_DENIED: 'PACK_ACCESS_DENIED',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  BINDING_NOT_FOUND: 'BINDING_NOT_FOUND',
  BINDING_ALREADY_EXISTS: 'BINDING_ALREADY_EXISTS',
  GRANT_NOT_FOUND: 'GRANT_NOT_FOUND',
  GRANT_INVALID: 'GRANT_INVALID',
  ROOT_REQUIRED: 'ROOT_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  USERNAME_TAKEN: 'USERNAME_TAKEN'
} as const

export type OperatorErrorCode =
  (typeof OPERATOR_ERROR_CODE)[keyof typeof OPERATOR_ERROR_CODE]
