export enum AccessLevel {
  PUBLIC = 0,   // 公开信息
  PROTECTED = 1, // 组织内成员可见
  INTERNAL = 2,  // 核心圈子可见
  SECRET = 3     // 极高权限/加密信息
}

export interface Circle {
  id: string;
  name: string;
  description?: string;
  level: AccessLevel;
}

export interface InformationMetadata {
  id: string;
  circle_id?: string; // 所属圈子
  min_level: AccessLevel; // 所需最小权限等级
}

/**
 * 权限上下文：代表一个 Agent 的权限状态
 */
export interface PermissionContext {
  agent_id: string;
  circles: Set<string>; // 拥有的 Circle ID 集合
  global_level: AccessLevel; // 自身的基础权限等级
}
