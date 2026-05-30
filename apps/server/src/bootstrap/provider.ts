import type { TokenTypes } from './token_types.js';

export type ServiceToken = keyof TokenTypes;

/**
 * 从 token 数组中推导 deps record 的类型。
 * e.g. deps: ['prisma', 'sim'] → { prisma: PrismaClient; sim: SimulationManager }
 */
export type DepsFromTokens<Tokens extends readonly ServiceToken[]> = {
  [K in Tokens[number]]: TokenTypes[K];
};

export interface ServiceProvider<
  T = unknown,
  TTokens extends readonly ServiceToken[] = readonly ServiceToken[]
> {
  provide: ServiceToken;
  deps?: TTokens;
  useFactory: (deps: DepsFromTokens<TTokens>) => T | Promise<T>;
  lifecycle?: 'singleton' | 'transient';
}

export class ServiceContainer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- container stores heterogeneous providers
  private providers = new Map<ServiceToken, ServiceProvider<any, any>>();
  private instances = new Map<ServiceToken, unknown>();
  private resolving = new Set<ServiceToken>();

  register<T, TTokens extends readonly ServiceToken[]>(
    provider: ServiceProvider<T, TTokens>
  ): this {
    if (this.providers.has(provider.provide)) {
      throw new Error(`Duplicate provider: ${provider.provide}`);
    }
    this.providers.set(provider.provide, provider);
    return this;
  }

  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access -- container internal boundary: runtime deps assembly cannot be statically typed */
  async resolve<T>(token: ServiceToken): Promise<T> {
    const cached = this.instances.get(token);
    if (cached !== undefined) return cached as T;

    const provider = this.providers.get(token);
    if (!provider) throw new Error(`Unknown service: ${token}`);

    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency: ${[...this.resolving, token].join(' → ')}`);
    }
    this.resolving.add(token);

    const deps: Record<string, unknown> = {};
    for (const dep of provider.deps ?? []) {
      deps[dep] = await this.resolve(dep);
    }

    // 容器运行时动态构建 deps map，TypeScript 无法验证动态拼装的
    // Record<string, unknown> 确实满足 DepsFromTokens<TTokens>。
    // 此 any 是容器内部的必要妥协，仅限于此一处。
    // provider 的 useFactory 签名已由 register() 的泛型约束保证类型安全。
    const instance = await provider.useFactory(deps as any);

    if (provider.lifecycle !== 'transient') {
      this.instances.set(token, instance);
    }

    this.resolving.delete(token);
    return instance as T;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */

  listTokens(): ServiceToken[] {
    return [...this.providers.keys()];
  }
}
