import type { BTEvalContext, BTNodeDef, BTStatus } from '../types.js';

async function getTick(): Promise<(node: BTNodeDef, ctx: BTEvalContext) => Promise<BTStatus>> {
  const { tick } = await import('../evaluator.js');
  return tick;
}

export async function tickSelector(children: BTNodeDef[], ctx: BTEvalContext): Promise<BTStatus> {
  const tick = await getTick();
  for (const child of children) {
    const status = await tick(child, ctx);
    if (status !== 'failure') return status;
  }
  return 'failure';
}

export async function tickSequence(children: BTNodeDef[], ctx: BTEvalContext): Promise<BTStatus> {
  if (children.length === 0) return 'failure';
  const tick = await getTick();
  for (const child of children) {
    const status = await tick(child, ctx);
    if (status !== 'success') return status;
  }
  return 'success';
}
