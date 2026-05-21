export const resolvePackTick = (
  context: unknown,
  packRuntime?: { getCurrentTick(): bigint } | null
): bigint => {
  if (packRuntime) return packRuntime.getCurrentTick();
  const ctx = context as { packRuntime?: { getCurrentTick(): bigint } | null };
  return ctx.packRuntime?.getCurrentTick() ?? 0n;
};
