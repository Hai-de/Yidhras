export const resolvePackTick = (
  context: unknown,
  packRuntime?: { getCurrentTick(): bigint } | null
): bigint => {
  if (packRuntime) return packRuntime.getCurrentTick();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const ctx = context as { packRuntime?: { getCurrentTick(): bigint } | null };
  return ctx.packRuntime?.getCurrentTick() ?? 0n;
};
