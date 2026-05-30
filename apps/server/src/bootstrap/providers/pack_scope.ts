import { PackScopeResolver } from '../../app/runtime/PackScopeResolver.js';
import { TOKENS } from '../tokens.js';

export const packScopeResolverProvider = {
  provide: TOKENS.packScope,
  deps: [TOKENS.sim] as const,
  useFactory: (deps) => new PackScopeResolver(deps.sim.getPackRuntimeRegistry())
} as const satisfies import('../provider.js').ServiceProvider;
