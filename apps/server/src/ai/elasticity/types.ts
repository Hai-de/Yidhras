export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** 连续失败多少次进入 open 状态 */
  failureThreshold: number;
  /** open 后多久进入 half_open 进行探测（ms） */
  recoveryTimeoutMs: number;
  /** half_open 时最多允许几个在途探测请求 */
  halfOpenMaxRequests: number;
  /** 失败计数窗口，超过此窗口的旧失败不计入 threshold（ms） */
  monitorWindowMs: number;
}

export interface CircuitBreakerSnapshot {
  provider: string;
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

export interface CircuitBreaker {
  readonly provider: string;
  readonly state: CircuitBreakerState;

  /** 调用前检查。open → false；closed/half_open → true */
  allowRequest(): boolean;

  /** 调用成功后上报 */
  recordSuccess(): void;

  /** 调用失败后上报 */
  recordFailure(): void;

  /** 当前状态快照 */
  snapshot(): CircuitBreakerSnapshot;
}

export interface RateLimiterConfig {
  /** 每个 provider 最大在途并发请求数 */
  maxConcurrent: number;
  /** 等待队列最大长度 */
  queueMaxSize: number;
  /** 排队最大等待时间（ms），超时后 reject */
  queueTimeoutMs: number;
}

export interface RateLimiterSnapshot {
  provider: string;
  active: number;
  queued: number;
  maxConcurrent: number;
}

export interface RateLimiter {
  readonly provider: string;

  /** 获取执行许可。resolve → 可执行；reject → 队列满或排队超时 */
  acquire(): Promise<void>;

  /** 释放许可。请求完成后必须调用 */
  release(): void;

  /** 当前状态快照 */
  snapshot(): RateLimiterSnapshot;
}

export interface BackoffConfig {
  /** 基础延迟（ms） */
  baseDelayMs: number;
  /** 最大延迟上限（ms） */
  maxDelayMs: number;
  /** 抖动比例 0~1 */
  jitterRatio: number;
}

export interface BackoffStrategy {
  /** 计算第 attempt 次重试应等待的毫秒数（attempt 从 1 开始） */
  getDelay(attempt: number): number;

  /** 返回实际 sleep 的 Promise */
  wait(attempt: number): Promise<void>;
}

export const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  halfOpenMaxRequests: 1,
  monitorWindowMs: 60_000,
};

export const DEFAULT_RL_CONFIG: RateLimiterConfig = {
  maxConcurrent: 10,
  queueMaxSize: 50,
  queueTimeoutMs: 30_000,
};

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterRatio: 0.25,
};
