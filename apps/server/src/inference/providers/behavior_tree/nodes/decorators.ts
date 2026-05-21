import type { BTDecoratorDef, BTNodeDef, BTEvalContext, BTCooldownState, BTStatus } from '../types.js';

async function getTick(): Promise<(node: BTNodeDef, ctx: BTEvalContext) => Promise<BTStatus>> {
  const { tick } = await import('../evaluator.js');
  return tick;
}

function getCooldownStore(ctx: BTEvalContext): Map<string, BTCooldownState> {
  if (!ctx.blackboard['__cooldown_store']) {
    ctx.blackboard['__cooldown_store'] = new Map<string, BTCooldownState>();
  }
  return ctx.blackboard['__cooldown_store'] as Map<string, BTCooldownState>;
}

export async function tickDecorated(
  decorators: BTDecoratorDef[],
  child: BTNodeDef,
  ctx: BTEvalContext
): Promise<BTStatus> {
  const tick = await getTick();
  if (decorators.length === 0) return tick(child, ctx);

  const [outermost, ...rest] = decorators;
  const innerNode: BTNodeDef = rest.length > 0
    ? { decorators: rest, child }
    : child;

  switch (outermost.type) {
    case 'inverter': {
      const status = await tick(innerNode, ctx);
      if (status === 'success') return 'failure';
      if (status === 'failure') return 'success';
      return status;
    }
    case 'cooldown':
      return applyCooldown(outermost, innerNode, ctx, getCooldownStore(ctx));
    case 'probability':
      return applyProbability(outermost, innerNode, ctx);
    default:
      return tick(innerNode, ctx);
  }
}

async function applyCooldown(
  decorator: BTDecoratorDef,
  child: BTNodeDef,
  ctx: BTEvalContext,
  cooldownStore: Map<string, BTCooldownState>
): Promise<BTStatus> {
  const key = buildCooldownKey(ctx);
  const state = cooldownStore.get(key);
  const currentTick = ctx.inferenceContext.tick;
  const cooldownTicks = decorator.cooldown_ticks ?? 0;

  if (state) {
    const elapsed = currentTick - state.lastSuccessTick;
    if (elapsed < BigInt(cooldownTicks)) return 'failure';
  }

  const tick = await getTick();
  const status = await tick(child, ctx);
  if (status === 'success') {
    cooldownStore.set(key, { lastSuccessTick: currentTick });
  }
  return status;
}

function buildCooldownKey(ctx: BTEvalContext): string {
  const agentId = (ctx.blackboard['__agent_id'] as string) ?? 'unknown';
  const treeName = (ctx.blackboard['__tree_name'] as string) ?? 'unknown';
  return `${agentId}::${treeName}`;
}

async function applyProbability(
  decorator: BTDecoratorDef,
  child: BTNodeDef,
  ctx: BTEvalContext
): Promise<BTStatus> {
  const weight = decorator.weight ?? 0;
  const seed = `${ctx.inferenceContext.actor_ref?.agent_id ?? 'unknown'}_${ctx.inferenceContext.tick}`;
  const hash = simpleHash(seed);
  const roll = (hash % 10000) / 10000;

  if (roll >= weight) return 'failure';
  const tick = await getTick();
  return tick(child, ctx);
}

function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}
