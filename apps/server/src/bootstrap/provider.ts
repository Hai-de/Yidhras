export type ServiceToken = string;

export interface ServiceProvider<T = unknown> {
  /** 此 Provider 提供的服务标识 */
  provide: ServiceToken;
  /** 依赖的其他服务标识（可选） */
  deps?: ServiceToken[];
  /** 工厂函数：接收已解析的依赖，返回服务实例 */
  useFactory: (deps: Record<string, unknown>) => T | Promise<T>;
  /** 生命周期：singleton（默认，只构造一次）| transient（每次解析都重新构造） */
  lifecycle?: 'singleton' | 'transient';
}

export class ServiceContainer {
  private providers = new Map<ServiceToken, ServiceProvider>();
  private instances = new Map<ServiceToken, unknown>();
  private resolving = new Set<ServiceToken>();

  register(provider: ServiceProvider): this {
    if (this.providers.has(provider.provide)) {
      throw new Error(`Duplicate provider: ${provider.provide}`);
    }
    this.providers.set(provider.provide, provider);
    return this;
  }

   
  async resolve<T>(token: ServiceToken): Promise<T> {
    const cached = this.instances.get(token);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- container boundary: cached value matches T
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

    const instance = await provider.useFactory(deps);

    if (provider.lifecycle !== 'transient') {
      this.instances.set(token, instance);
    }

    this.resolving.delete(token);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- container boundary: factory result matches T
    return instance as T;
  }

  listTokens(): ServiceToken[] {
    return [...this.providers.keys()];
  }
}
