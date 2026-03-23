import type { AppContext } from '../context.js';

export const expireIdentityBindings = async (context: AppContext): Promise<void> => {
  const now = context.sim.clock.getTicks();
  await context.prisma.identityNodeBinding.updateMany({
    where: {
      AND: [
        { expires_at: { not: null } },
        { expires_at: { lte: now } },
        { status: { not: 'expired' } }
      ]
    },
    data: {
      status: 'expired',
      updated_at: now
    }
  });
};

export interface StartSimulationLoopOptions {
  context: AppContext;
  intervalMs?: number;
  onStepError(err: unknown): void;
}

export const startSimulationLoop = ({
  context,
  intervalMs = 1000,
  onStepError
}: StartSimulationLoopOptions): NodeJS.Timeout => {
  return setInterval(async () => {
    if (context.getPaused()) {
      return;
    }

    try {
      await expireIdentityBindings(context);
      await context.sim.step(context.sim.getStepTicks());
    } catch (err: unknown) {
      onStepError(err);
    }
  }, intervalMs);
};
