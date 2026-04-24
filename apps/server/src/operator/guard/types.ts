import type { ResolvedCapabilityItem } from '../../domain/authority/resolver.js'

// ── L1: Pack Access ──

/**
 * Pack 准入检查结果。
 * root 也必须有显式 OperatorPackBinding 才能访问 pack。
 */
export interface PackAccessResult {
  allowed: boolean
  /** 绑定的角色类型；未匹配时为 null */
  bindingType: 'owner' | 'admin' | 'member' | 'spectator' | null
  /** 拒绝原因码 */
  reason?: 'NOT_BOUND' | 'OPERATOR_DISABLED' | 'PACK_NOT_FOUND'
}

/**
 * PackAccessGuard 中间件选项
 */
export interface PackAccessGuardOptions {
  /** 从 req.params 提取 packId 的参数名 */
  packIdParam?: string
  /** 或从 req.query 提取 */
  packIdQuery?: string
  /** 是否允许匿名/未绑定用户访问（默认 false） */
  allowPublic?: boolean
  /** 允许的最低 bindingType（如 'member' 允许 member/admin/owner） */
  minBindingType?: 'owner' | 'admin' | 'member' | 'spectator'
}

// ── L2: Subject 解析 ──

/**
 * Operator → Subject Entity 解析结果。
 * 决定 Operator 以哪个主体身份参与 capability 判定。
 */
export interface SubjectResolutionResult {
  /** 最终用于 authority 判定的主体 entity_id */
  subjectEntityId: string | null
  /** 如果 Operator 扮演了某个 Agent，这里记录被扮演的 agent_id */
  actingAsAgentId: string | null
  /** 溯源路径标签 */
  provenance:
    | 'operator_bound_as_agent'
    | 'operator_default_binding'
    | 'operator_direct_identity'
    | 'agent_controlled_by_operator'
    | 'agent_npc'
    | 'system_identity'
}

// ── L2: Capability 检查 ──

/**
 * Capability 检查结果，复用已有的 AuthorityResolutionResult
 */
export interface CapabilityCheckResult {
  allowed: boolean
  /** 匹配到的 grant 记录 */
  matchedGrant: ResolvedCapabilityItem | null
  /** 用于判定的 subject_entity_id */
  subjectEntityId: string | null
  /** 是否来自 OperatorGrant 委托 */
  fromOperatorGrant: boolean
  /** OperatorGrant 记录 id（若有） */
  operatorGrantId: string | null
}

/**
 * CapabilityGuard 中间件选项
 */
export interface CapabilityGuardOptions {
  /** 从 req.params 提取 targetAgentId 的参数名 */
  targetAgentIdParam?: string
  /** 从 req.query 提取 packId 的参数名 */
  packIdParam?: string
  packIdQuery?: string
}

// ── L3: Policy 过滤上下文扩展 ──

/**
 * 扩展后的 Policy 匹配输入，包含 operator 信息
 */
export interface OperatorPolicyContext {
  operatorId: string | null
  operatorUsername: string | null
  isRoot: boolean
  bindingType: string | null
}
