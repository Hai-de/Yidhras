# AI 网关弹性工程

## 现状

`gateway.ts` 的 retry loop（L319）:
- 重试间**零延迟**
- 无 circuit breaker（一个 provider 反复失败也持续尝试）
- 无 rate limiter（可能同时发出大量并发请求触发 429）
- `openai.ts` 的 `performRequest` 不处理 `Retry-After` 头

---

## 接口契约（接口先行）

### 1. CircuitBreaker

```
CircuitBreakerState = 'closed' | 'open' | 'half_open'

interface CircuitBreakerConfig {
  failureThreshold: number     // 连续失败多少次进入 open（默认 5）
  recoveryTimeoutMs: number    // open 后多久进入 half_open（默认 30000）
  halfOpenMaxRequests: number  // half_open 时允许几个探测请求（默认 1）
  monitorWindowMs: number      // 失败计数窗口，避免慢泄漏（默认 60000）
}

interface CircuitBreaker {
  readonly provider: string
  readonly state: CircuitBreakerState

  // 调用前检查。open → 立即拒绝返回 false；closed/half_open → true
  allowRequest(): boolean

  // 调用后上报结果。success → 失败计数器重置，open→half_open 时 → closed
  recordSuccess(): void

  // 调用后上报结果。failure → 计数器递增，达到阈值 → open
  recordFailure(): void

  // 当前状态快照（供观测/日志）
  snapshot(): CircuitBreakerSnapshot
}

interface CircuitBreakerSnapshot {
  provider: string
  state: CircuitBreakerState
  failureCount: number
  lastFailureAt: number | null
  openedAt: number | null
}
```

### 2. RateLimiter

```
interface RateLimiterConfig {
  maxConcurrent: number    // 每个 provider 最大在途请求数（默认 10）
  queueMaxSize: number     // 等待队列最大长度（默认 50）
  queueTimeoutMs: number   // 排队超时，超时后 reject（默认 30000）
}

interface RateLimiter {
  readonly provider: string

  // 获取执行许可。resolve → 可以执行；reject → 队列满或超时
  acquire(): Promise<void>

  // 释放许可（请求完成后调用，无论成功失败）
  release(): void

  // 当前状态快照
  snapshot(): RateLimiterSnapshot
}

interface RateLimiterSnapshot {
  provider: string
  active: number
  queued: number
  maxConcurrent: number
}
```

### 3. BackoffStrategy

```
interface BackoffConfig {
  baseDelayMs: number       // 基础延迟（默认 1000）
  maxDelayMs: number        // 最大延迟上限（默认 30000）
  jitterRatio: number       // 抖动比例 0~1（默认 0.25 = ±25%）
}

interface BackoffStrategy {
  // 计算第 attempt 次重试应等待的毫秒数（attempt 从 1 开始）
  getDelay(attempt: number): number

  // 返回实际 sleep 的 Promise
  wait(attempt: number): Promise<void>
}
```

### 4. 类型扩展

`ai/types.ts` 中 `AiRouteDefaults` 增加可选字段（暂不暴露 YAML）:

```ts
// AiRouteDefaults 扩展（预留，不实装到 YAML schema）
interface AiRouteDefaults {
  // ... existing ...
  circuit_breaker?: {
    failure_threshold?: number
    recovery_timeout_ms?: number
  }
  rate_limit?: {
    max_concurrent?: number
  }
  backoff?: {
    base_delay_ms?: number
    max_delay_ms?: number
  }
}
```

---

## 组件挂载架构

```
gateway.execute(input)
  │
  ├─ resolveAiRoute(...)  → candidates[]
  │
  └─ for each candidate:
       │
       ├─ circuitBreaker.allowRequest()  →  open? skip candidate
       │
       ├─ rateLimiter.acquire()  →  resolve / reject(队列满/超时)
       │     │
       │     └─ for attempt 0..retryLimit:
       │          │
       │          ├─ withTimeout(adapter.execute(...), timeoutMs)
       │          │     │
       │          │     └─ (adapter 内部可上报 Retry-After 到 result)
       │          │
       │          ├─ success → circuitBreaker.recordSuccess()
       │          │            rateLimiter.release()
       │          │            return finalized
       │          │
       │          └─ failure → circuitBreaker.recordFailure()
       │                       if retryable:
       │                         backoff.wait(attempt + 1)
       │
       └─ all candidates exhausted → rateLimiter.release() (on final skip)
                                     return lastFailure
```

---

## 关键实现细节

### CircuitBreaker 状态机

```
        recordFailure() 连续 N 次
  CLOSED ────────────────────────────► OPEN
    ▲                                    │
    │    recordSuccess()                 │ recoveryTimeoutMs 到期
    │    (half_open 请求成功)             │
    │                                    ▼
    └──────────────────────────────── HALF_OPEN
                                          │
                                          │ allowRequest() 允许 1 个请求
                                          │ recordFailure() → 立即回 OPEN
```

- **monitorWindowMs**：如果 `lastFailureAt` 距离现在超过 window，重置计数器。防止「3 小时前失败 1 次 + 刚失败 4 次」误触发 open。
- **half_open 探测**：`halfOpenMaxRequests` 控制在途探测并发。如果 `activeRequests >= halfOpenMaxRequests`，`allowRequest()` 返回 false。

### RateLimiter 实现

用计数器 + Promise 等待队列（不使用第三方库）:

```ts
class ProviderRateLimiter implements RateLimiter {
  private active = 0;
  private queue: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];

  async acquire(): Promise<void> {
    if (this.active < this.config.maxConcurrent) {
      this.active += 1;
      return;
    }
    if (this.queue.length >= this.config.queueMaxSize) {
      throw new ApiError(503, 'AI_RATE_LIMIT_QUEUE_FULL', ...);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // remove from queue
        reject(new ApiError(503, 'AI_RATE_LIMIT_QUEUE_TIMEOUT', ...));
      }, this.config.queueTimeoutMs);
      this.queue.push({ resolve, reject, timer });
    });
  }

  release(): void {
    const pending = this.queue.shift();
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve();  // resolve 后 acquire 的调用者会增加 active
    } else {
      this.active -= 1;
    }
  }
}
```

### Backoff 公式

```
delay = min(baseDelay * 2^(attempt-1), maxDelay)
jitter = delay * jitterRatio * (random(-1, 1))
finalDelay = delay + jitter
```

第 1 次重试（attempt=1）：~1s
第 2 次重试（attempt=2）：~2s
第 3 次重试（attempt=3）：~4s
第 4 次重试（attempt=4）：~8s（上限 30s 还很远）

### Gateway 集成改动点

现有 `gateway.ts` 的 `execute` 闭包内增加:

1. 初始化阶段（在 `for (const candidate of candidates)` 之前）:
   ```ts
   const circuitBreakers = new Map<string, CircuitBreaker>();
   const rateLimiters = new Map<string, RateLimiter>();
   const backoff = createExponentialBackoff(DEFAULT_BACKOFF_CONFIG);
   ```

2. 对每个 candidate:
   ```ts
   const cb = getOrCreateCircuitBreaker(candidate.provider, circuitBreakers);
   if (!cb.allowRequest()) {
     attempts.push(buildAttemptRecord(candidate, 'failed', 'error', {
       errorCode: 'AI_CIRCUIT_OPEN',
       errorStage: 'route'
     }));
     continue;
   }

   const rl = getOrCreateRateLimiter(candidate.provider, rateLimiters);
   try {
     await rl.acquire();
   } catch (err) {
     // 队列满或排队超时
     attempts.push(...);
     continue;
   }
   ```

3. 成功/失败后:
   ```ts
   // success
   cb.recordSuccess();
   rl.release();

   // failure
   cb.recordFailure();
   rl.release();
   if (retryable) { await backoff.wait(attempt + 1); }
   ```

4. 最终返回前（所有 candidate 都失败）:
   ```ts
   // rl.release() 已在每个 candidate 的 catch/failure 路径调用过
   ```

---

## 文件变更清单

| 文件 | 操作 | 内容 |
|------|------|------|
| `ai/elasticity/types.ts` | **新建** | CircuitBreaker / RateLimiter / BackoffStrategy 接口 + 配置类型 |
| `ai/elasticity/circuit_breaker.ts` | **新建** | `createCircuitBreaker()` 实现 |
| `ai/elasticity/rate_limiter.ts` | **新建** | `createRateLimiter()` 实现 |
| `ai/elasticity/backoff.ts` | **新建** | `createExponentialBackoff()` 实现 |
| `ai/elasticity/index.ts` | **新建** | 统一 re-export |
| `ai/types.ts` | 修改 | `AiRouteDefaults` 增加预留字段 |
| `ai/gateway.ts` | 修改 | 在 execute 中集成 CB + RL + Backoff |
| `TODO.md` | 修改 | 标记弹性工程完成 |

---

## 不做

- 不引入第三方库（opossum / bottleneck 等）
- 不在 adapter 层做 retry（保持 adapter 只负责单次请求）
- 不暴露 YAML 配置（仅类型预留）
- 不支持分布式 circuit breaker（单进程内存状态，重启清零 — 可接受）
- 不区分超时/5xx/4xx 的退避策略（统一退避公式）
