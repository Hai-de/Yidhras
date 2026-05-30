import { createLogger } from '../utils/logger.js';
import { ServiceContainer } from './provider.js';

export type LifecyclePhase =
  | 'constructed'
  | 'booting'
  | 'booted'
  | 'starting'
  | 'running'
  | 'shutting_down'
  | 'stopped';

export class Application {
  readonly services = new ServiceContainer();
  private phase: LifecyclePhase = 'constructed';
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private logger = createLogger('application');

  register(provider: Parameters<ServiceContainer['register']>[0]): this {
    this.services.register(provider);
    return this;
  }

  /**
   * boot 阶段：解析所有 singleton 服务，完成对象构造和依赖注入。
   * 此时所有服务对象已存在、已互联，但无副作用操作（无 DB preflight、无 pack 加载、无 HTTP 监听）。
   */
  async boot(): Promise<void> {
    if (this.phase !== 'constructed') {
      throw new Error(`Cannot boot: already ${this.phase}`);
    }
    this.phase = 'booting';

    const tokens = this.services.listTokens();
    for (const token of tokens) {
      await this.services.resolve(token);
    }

    this.phase = 'booted';
    this.logger.info(`booted: ${String(tokens.length)} services resolved`);
  }

  /**
   * start 阶段：执行启动序列（DB preflight、pack 加载、loop 启动、HTTP 监听）。
   * onStart 回调承载所有需要在一切就绪后才执行的操作。
   */
  async start(onStart: (app: Application) => Promise<void>): Promise<void> {
    if (this.phase !== 'booted') {
      throw new Error(`Cannot start: currently ${this.phase}, expected booted`);
    }
    this.phase = 'starting';
    await onStart(this);
    this.phase = 'running';
  }

  /** 优雅关闭，逆序执行注册的 shutdown handler */
  async shutdown(signal: string): Promise<void> {
    if (this.phase === 'stopped' || this.phase === 'shutting_down') return;
    this.phase = 'shutting_down';
    this.logger.info(`shutting down (signal=${signal})`);

    const forceExit = setTimeout(() => {
      this.logger.error('shutdown timeout (10s), force exit');
      process.exit(1);
    }, 10_000);

    try {
      for (const handler of this.shutdownHandlers.reverse()) {
        await handler();
      }
      clearTimeout(forceExit);
      this.phase = 'stopped';
      this.logger.info('shutdown complete');
    } catch (err) {
      this.logger.error('shutdown error', { data: { error: err instanceof Error ? err : new Error(String(err)) } });
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  onShutdown(handler: () => Promise<void>): this {
    this.shutdownHandlers.push(handler);
    return this;
  }
}
