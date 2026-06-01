import { z } from 'zod';

// ── 通知码枚举 ──

export const NotificationCode = {
  // 权限类
  PERMISSION_SLOT_DENIED: 'PERMISSION_SLOT_DENIED',
  PERMISSION_CAPABILITY_DENIED: 'PERMISSION_CAPABILITY_DENIED',
  PERMISSION_PACK_ACCESS_DENIED: 'PERMISSION_PACK_ACCESS_DENIED',

  // 插件类
  PLUGIN_ACTIVATION_FAILED: 'PLUGIN_ACTIVATION_FAILED',
  PLUGIN_WORKER_CRASHED: 'PLUGIN_WORKER_CRASHED',
  PLUGIN_WORKER_TIMEOUT: 'PLUGIN_WORKER_TIMEOUT',
  PLUGIN_HOST_API_INCOMPATIBLE: 'PLUGIN_HOST_API_INCOMPATIBLE',
  PLUGIN_CAPABILITY_MISMATCH: 'PLUGIN_CAPABILITY_MISMATCH',
  PLUGIN_MANIFEST_MISALIGNED: 'PLUGIN_MANIFEST_MISALIGNED',

  // 系统类
  SYS_PRECHECK_FAIL: 'SYS_PRECHECK_FAIL',
  SYS_INIT_FAIL: 'SYS_INIT_FAIL',
  SYS_INIT_OK: 'SYS_INIT_OK',
  WORLD_PACK_EMPTY: 'WORLD_PACK_EMPTY',
  DEV_RUNTIME_RESET: 'DEV_RUNTIME_RESET',

  // HTTP API 类（由 error_handler 中间件推送）
  API_INTERNAL_ERROR: 'API_INTERNAL_ERROR',
  API_REQUEST_ERROR: 'API_REQUEST_ERROR'
} as const;

export type NotificationCodeValue = (typeof NotificationCode)[keyof typeof NotificationCode];

// ── 插件错误阶段枚举 ──

export const PluginErrorPhase = {
  ACTIVATION: 'activation',
  INVOCATION: 'invocation',
  DEACTIVATION: 'deactivation',
  HOST_CALL: 'host_call',
  CRASH: 'crash',
  HOST_API_CHECK: 'host_api_check'
} as const;

export type PluginErrorPhaseValue = (typeof PluginErrorPhase)[keyof typeof PluginErrorPhase];

// ── 源位置 ──

const SourceLocationSchema = z.object({
  file: z.string(),
  line: z.number().int().optional(),
  column: z.number().int().optional()
});

// ── 基础 details ──

const NotificationDetailsBaseSchema = z.object({
  module: z.string(),
  timestamp: z.number()
});

// ── 权限类 details ──

export const PermissionSlotDeniedDetailsSchema = NotificationDetailsBaseSchema.extend({
  kind: z.literal('slot_denied'),
  denied_read_count: z.number().int().nonnegative(),
  denied_visibility_count: z.number().int().nonnegative(),
  affected_slot_ids: z.array(z.string()),
  actor_identity_id: z.string(),
  actor_agent_id: z.string()
});

export const PermissionCapabilityDeniedDetailsSchema = NotificationDetailsBaseSchema.extend({
  kind: z.literal('capability_denied'),
  plugin_id: z.string(),
  installation_id: z.string(),
  capability_key: z.string(),
  method: z.string()
});

export const PermissionPackAccessDeniedDetailsSchema = NotificationDetailsBaseSchema.extend({
  kind: z.literal('pack_access_denied'),
  pack_id: z.string(),
  reason: z.string()
});

// ── 插件类 details ──

export const PluginErrorDetailsSchema = NotificationDetailsBaseSchema.extend({
  pack_id: z.string(),
  plugin_id: z.string(),
  installation_id: z.string(),
  phase: z.enum([
    PluginErrorPhase.ACTIVATION,
    PluginErrorPhase.INVOCATION,
    PluginErrorPhase.DEACTIVATION,
    PluginErrorPhase.HOST_CALL,
    PluginErrorPhase.CRASH,
    PluginErrorPhase.HOST_API_CHECK
  ]),
  source_location: SourceLocationSchema.optional(),
  contribution_type: z.string().optional(),
  contribution_invoke: z.string().optional(),
  raw_message: z.string().optional()
});

// ── 系统类 / HTTP API 类 details（base 足够） ──

export const SystemDetailsSchema = NotificationDetailsBaseSchema;

// ── API 错误 details（由 error_handler 中间件使用） ──

export const ApiErrorDetailsSchema = NotificationDetailsBaseSchema.extend({
  request_id: z.string().optional(),
  source_location: SourceLocationSchema.optional()
});

// ── code → schema 映射 ──

 
export const NotificationCodeDetailsMap = {
  // 权限类
  [NotificationCode.PERMISSION_SLOT_DENIED]: PermissionSlotDeniedDetailsSchema,
  [NotificationCode.PERMISSION_CAPABILITY_DENIED]: PermissionCapabilityDeniedDetailsSchema,
  [NotificationCode.PERMISSION_PACK_ACCESS_DENIED]: PermissionPackAccessDeniedDetailsSchema,
  // 插件类
  [NotificationCode.PLUGIN_ACTIVATION_FAILED]: PluginErrorDetailsSchema,
  [NotificationCode.PLUGIN_WORKER_CRASHED]: PluginErrorDetailsSchema,
  [NotificationCode.PLUGIN_WORKER_TIMEOUT]: PluginErrorDetailsSchema,
  [NotificationCode.PLUGIN_HOST_API_INCOMPATIBLE]: PluginErrorDetailsSchema,
  [NotificationCode.PLUGIN_CAPABILITY_MISMATCH]: PluginErrorDetailsSchema,
  [NotificationCode.PLUGIN_MANIFEST_MISALIGNED]: PluginErrorDetailsSchema,
  // 系统类
  [NotificationCode.SYS_PRECHECK_FAIL]: SystemDetailsSchema,
  [NotificationCode.SYS_INIT_FAIL]: SystemDetailsSchema,
  [NotificationCode.SYS_INIT_OK]: SystemDetailsSchema,
  [NotificationCode.WORLD_PACK_EMPTY]: SystemDetailsSchema,
  [NotificationCode.DEV_RUNTIME_RESET]: SystemDetailsSchema,
  // HTTP API 类
  [NotificationCode.API_INTERNAL_ERROR]: ApiErrorDetailsSchema,
  [NotificationCode.API_REQUEST_ERROR]: ApiErrorDetailsSchema
};
