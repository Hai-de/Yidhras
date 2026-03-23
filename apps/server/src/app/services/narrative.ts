import type { AppContext } from '../context.js';

export const listNarrativeTimeline = async (context: AppContext) => {
  return context.sim.prisma.event.findMany({
    orderBy: { tick: 'desc' }
  });
};
