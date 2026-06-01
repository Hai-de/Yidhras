import type { NotificationCodeValue, PluginErrorPhaseValue } from '../../utils/notification_details.js';
import { NotificationCode, PluginErrorPhase } from '../../utils/notification_details.js';

export interface PluginInstallationLastError {
  message: string;
  code: NotificationCodeValue;
  timestamp: string;
  phase: PluginErrorPhaseValue;
  source_location?: {
    file: string;
    line?: number;
    column?: number;
  };
  cause?: {
    message: string;
    source_location?: { file: string; line?: number; column?: number };
  };
}

/**
 * 序列化 last_error 为 JSON 字符串。
 * 不修改 Prisma schema — 应用层在 String 字段中存储结构化 JSON。
 */
export const serializeLastError = (error: PluginInstallationLastError): string => {
  return JSON.stringify(error);
};

/**
 * 提取 source_location（如果形状匹配）。
 */
const parseSourceLoc = (val: unknown): PluginInstallationLastError['source_location'] => {
  if (typeof val !== 'object' || val === null) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural extraction with type guards
  const obj = val as Record<string, unknown>;
  if (typeof obj['file'] !== 'string') return undefined;
  const result: PluginInstallationLastError['source_location'] = { file: obj['file'] };
  if (typeof obj['line'] === 'number') result.line = obj['line'];
  if (typeof obj['column'] === 'number') result.column = obj['column'];
  return result;
};

/**
 * 提取 cause（如果形状匹配）。
 */
const parseCause = (val: unknown): PluginInstallationLastError['cause'] => {
  if (typeof val !== 'object' || val === null) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural extraction with type guards
  const obj = val as Record<string, unknown>;
  if (typeof obj['message'] !== 'string') return undefined;
  const result: PluginInstallationLastError['cause'] = { message: obj['message'] };
  const sl = parseSourceLoc(obj['source_location']);
  if (sl) result.source_location = sl;
  return result;
};

/**
 * 反序列化 last_error。JSON 解析失败时降级为简单格式。
 */
export const deserializeLastError = (raw: string | null | undefined): PluginInstallationLastError | null => {
  if (!raw) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse returns unknown; structural extraction follows
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed['message'] !== 'string') return null;

    const sourceLoc = parseSourceLoc(parsed['source_location']);
    const cause = parseCause(parsed['cause']);
    return {
      message: parsed['message'],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as string above, narrowing to NotificationCodeValue
      code: typeof parsed['code'] === 'string' ? parsed['code'] as NotificationCodeValue : NotificationCode.PLUGIN_ACTIVATION_FAILED,
      timestamp: typeof parsed['timestamp'] === 'string' ? parsed['timestamp'] : new Date(0).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as string above, narrowing to PluginErrorPhaseValue
      phase: typeof parsed['phase'] === 'string' ? parsed['phase'] as PluginErrorPhaseValue : PluginErrorPhase.ACTIVATION,
      ...(sourceLoc ? { source_location: sourceLoc } : {}),
      ...(cause ? { cause } : {})
    };
  } catch {
    return {
      message: raw,
      code: NotificationCode.PLUGIN_ACTIVATION_FAILED,
      timestamp: new Date(0).toISOString(),
      phase: PluginErrorPhase.ACTIVATION
    };
  }
};
