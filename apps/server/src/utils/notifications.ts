export type NotificationLevel = 'info' | 'warning' | 'error';

export interface SystemMessage {
  id: string;
  level: NotificationLevel;
  content: string;
  timestamp: number;
  code?: string;
  details?: Record<string, unknown>;
}

class NotificationManager {
  private messages: SystemMessage[] = [];
  private readonly MAX_MESSAGES = 50;

  /**
   * 推送一条系统消息
   */
  public push(
    level: NotificationLevel,
    content: string,
    code?: string,
    details?: Record<string, unknown>
  ): SystemMessage {
    const msg: SystemMessage = {
      id: Math.random().toString(36).substring(2, 9),
      level,
      content,
      timestamp: Date.now(),
      code,
      ...(details === undefined ? {} : { details })
    };

    this.messages.unshift(msg);
    
    // 限制队列长度
    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages.pop();
    }

    console.log(`[SystemNotification] [${level.toUpperCase()}] ${content}`);
    return msg;
  }

  /**
   * 获取所有未读/最近消息
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
}

export const notifications = new NotificationManager();
