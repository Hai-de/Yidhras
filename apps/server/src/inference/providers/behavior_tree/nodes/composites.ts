import type { BTEvalContext, BTNodeDef, BTStatus } from '../types.js';

export type TickFn = (node: BTNodeDef, ctx: BTEvalContext) => Promise<BTStatus>;

export async function tickSelector(
  children: BTNodeDef[],
  ctx: BTEvalContext,
  tick: TickFn
): Promise<BTStatus> {
  for (const child of children) {
    const status = await tick(child, ctx);
    if (status !== 'failure') return status;
  }
  return 'failure';
}

export async function tickSequence(
  children: BTNodeDef[],
  ctx: BTEvalContext,
  tick: TickFn
): Promise<BTStatus> {
  if (children.length === 0) return 'failure';
  for (const child of children) {
    const status = await tick(child, ctx);
    if (status !== 'success') return status;
  }
  return 'success';
}
