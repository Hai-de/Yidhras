export const resolvePackTick = (
  _context: unknown,
  packRuntime?: { getCurrentTick(): bigint } | null
): bigint => {
  if (packRuntime) return packRuntime.getCurrentTick();
  return 0n;
};
