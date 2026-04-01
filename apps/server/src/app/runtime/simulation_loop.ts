import type { InferenceService } from '../../inference/service.js';
import type { AppContext } from '../context.js';
import { runActionDispatcher } from './action_dispatcher_runner.js';
import { runAgentScheduler } from './agent_scheduler.js';
import { runDecisionJobRunner } from './job_runner.js';

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
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  schedulerWorkerId?: string;
  intervalMs?: number;
  onStepError(err: unknown): void;
}

export const startSimulationLoop = ({
  context,
  inferenceService,
  decisionWorkerId,
  actionDispatcherWorkerId,
  schedulerWorkerId = `scheduler:${process.pid}`,
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
      await runAgentScheduler({
        context,
        workerId: schedulerWorkerId
      });
      await runDecisionJobRunner({
        context,
        inferenceService,
        workerId: decisionWorkerId
      });
      await runActionDispatcher({
        context,
        workerId: actionDispatcherWorkerId
      });
    } catch (err: unknown) {
      onStepError(err);
    }
  }, intervalMs);
};
