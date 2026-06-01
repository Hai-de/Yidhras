import { createLogger } from './logger.js';
import type { NotificationCodeValue } from './notification_details.js';
import { NotificationCodeDetailsMap } from './notification_details.js';

const logger = createLogger('notifications');

export type NotificationLevel = 'info' | 'warning' | 'error';

export interface SystemMessage {
  id: string;
  level: NotificationLevel;
  content: string;
  timestamp: number;
  code?: string;
  details?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<NotificationLevel, number> = {
  error: 3,
  warning: 2,
  info: 1
};

class NotificationManager {
  private messages: SystemMessage[] = [];
  private readonly MAX_MESSAGES = 200;

  /**
   * 推送一条系统消息。如果 code 在 NotificationCodeDetailsMap 中注册，
   * 用对应的 Zod schema 校验 details；校验失败时 log warning 并降级为无 details。
   */
  public push(
    level: NotificationLevel,
    content: string,
    code?: string,
    details?: Record<string, unknown>
  ): SystemMessage {
    const validatedDetails = this.validateDetails(code, details);

    // @ts-expect-error -- EOPT strict mode
    const msg: SystemMessage = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      content,
      timestamp: Date.now(),
      code,
      ...(validatedDetails === undefined ? {} : { details: validatedDetails })
    };

    this.messages.unshift(msg);
    this.evictIfNeeded();

    switch (level) {
      case 'error':
        logger.error(content);
        break;
      case 'warning':
        logger.warn(content);
        break;
      default:
        logger.info(content);
        break;
    }
    return msg;
  }

  /**
   * 推送或替换通知。按 replaceKey 查找已存在的消息：
   * - 找到同 key 消息 → 原地替换 content、level、details、timestamp
   * - 未找到 → 等同于 push()，新建一条
   * 替换不计入驱逐容量触发。
   */
  public pushOrReplace(
    level: NotificationLevel,
    content: string,
    code: NotificationCodeValue,
    details: Record<string, unknown>,
    replaceKey: string
  ): SystemMessage {
    const validatedDetails = this.validateDetails(code, details);

    // 查找同 key 的已有消息
    const existingIndex = this.messages.findIndex(
      m => m.details && typeof m.details['_replaceKey'] === 'string' && m.details['_replaceKey'] === replaceKey
    );

    if (existingIndex >= 0) {
      const existing = this.messages[existingIndex];
      if (!existing) {
        const fallback = this.push(level, content, code, details);
        return fallback;
      }
      const updated: SystemMessage = {
        id: existing.id,
        level,
        content,
        timestamp: Date.now(),
        code,
        details: { ...validatedDetails, _replaceKey: replaceKey }
      };
      this.messages[existingIndex] = updated;
      return updated;
    }

    const msg: SystemMessage = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      content,
      timestamp: Date.now(),
      code,
      details: { ...validatedDetails, _replaceKey: replaceKey }
    };

    this.messages.unshift(msg);
    this.evictIfNeeded();
    return msg;
  }

  /**
   * 获取所有消息
   */
  public getMessages(): SystemMessage[] {
    return this.messages;
  }

  /**
   * 清空消息
   */
  public clear(): void {
    this.messages = [];
  }

  /**
   * 按 level 优先级驱逐旧消息。
   * 策略：当队列超过 MAX_MESSAGES 时，从最低优先级（info）中最旧的开始移除。
   */
  private evictIfNeeded(): void {
    while (this.messages.length > this.MAX_MESSAGES) {
      // 找到最低优先级的最后一条（最旧的）
      let targetIndex = -1;
      let targetPriority = Infinity;

      for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if (!message) continue;
        const priority = LEVEL_PRIORITY[message.level];
        if (priority < targetPriority) {
          targetPriority = priority;
          targetIndex = i;
        }
        // 如果已经是最低优先级(info=1)，尽早退出
        if (priority === 1) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex >= 0) {
        this.messages.splice(targetIndex, 1);
      } else {
        // 回退：移除最旧的一条
        this.messages.pop();
      }
    }
  }

  /**
   * 校验 details 是否符合 code 对应的 Zod schema。
   * 校验成功返回 details，失败返回 undefined（不阻断业务）。
   * 使用 structural typing 避免直接依赖 Zod v4 泛型（泛型与 TS strict 模式存在兼容问题）。
   */
  private validateDetails(
    code: string | undefined,
    details: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    if (!code || details === undefined) {
      return details;
    }

    // eslint-disable-next-line security/detect-object-injection -- dynamic lookup with structural fallback for unknown codes
    const entry = (NotificationCodeDetailsMap as Record<string, unknown>)[code];
    if (!entry || typeof entry !== 'object') {
      return details;
    }

    // 用 structural typing 访问 safeParse，避免 Zod 泛型类型问题
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrow { success, error?, data? } from Zod output, verified at runtime
    const schema = entry as { safeParse: (v: unknown) => { success: boolean; error?: { message: string }; data?: unknown } };
    if (typeof schema.safeParse !== 'function') {
      return details;
    }

    const result = schema.safeParse(details);
    if (!result.success) {
      logger.warn(`Notification details validation failed for code ${code}`, {
        error: new Error(result.error?.message ?? 'unknown validation error'),
        data: { code, invalid_keys: Object.keys(details) }
      });
      return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Zod safeParse 已验证数据形状
    return result.data as Record<string, unknown>;
  }
}

export const createNotificationManager = (): NotificationManager => new NotificationManager();
