import type { AppContext } from '../context.js';

export const SCHEDULER_LEASE_KEY = 'agent_scheduler_main';
export const SCHEDULER_CURSOR_KEY = 'agent_scheduler_cursor';
export const DEFAULT_SCHEDULER_LEASE_TICKS = 5n;

export interface SchedulerLeaseAcquireResult {
  acquired: boolean;
  holder: string | null;
  expires_at: bigint | null;
}

export const acquireSchedulerLease = async (
  context: AppContext,
  input: {
    workerId: string;
    now?: bigint;
    leaseTicks?: bigint;
  }
): Promise<SchedulerLeaseAcquireResult> => {
  const now = input.now ?? context.sim.clock.getTicks();
  const leaseTicks = input.leaseTicks ?? DEFAULT_SCHEDULER_LEASE_TICKS;
  const expiresAt = now + leaseTicks;
  const existing = await context.prisma.schedulerLease.findUnique({
    where: {
      key: SCHEDULER_LEASE_KEY
    }
  });

  if (!existing) {
    await context.prisma.schedulerLease.create({
      data: {
        key: SCHEDULER_LEASE_KEY,
        holder: input.workerId,
        acquired_at: now,
        expires_at: expiresAt,
        updated_at: now
      }
    });
    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt
    };
  }

  if (existing.holder === input.workerId || existing.expires_at <= now) {
    await context.prisma.schedulerLease.update({
      where: {
        key: SCHEDULER_LEASE_KEY
      },
      data: {
        holder: input.workerId,
        acquired_at: existing.holder === input.workerId ? existing.acquired_at : now,
        expires_at: expiresAt,
        updated_at: now
      }
    });
    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt
    };
  }

  return {
    acquired: false,
    holder: existing.holder,
    expires_at: existing.expires_at
  };
};

export const renewSchedulerLease = async (
  context: AppContext,
  input: {
    workerId: string;
    now?: bigint;
    leaseTicks?: bigint;
  }
): Promise<SchedulerLeaseAcquireResult> => {
  return acquireSchedulerLease(context, input);
};

export const releaseSchedulerLease = async (
  context: AppContext,
  workerId: string
): Promise<boolean> => {
  const existing = await context.prisma.schedulerLease.findUnique({
    where: {
      key: SCHEDULER_LEASE_KEY
    }
  });

  if (!existing || existing.holder !== workerId) {
    return false;
  }

  await context.prisma.schedulerLease.delete({
    where: {
      key: SCHEDULER_LEASE_KEY
    }
  });

  return true;
};

export const updateSchedulerCursor = async (
  context: AppContext,
  input: {
    lastScannedTick: bigint;
    lastSignalTick: bigint;
    now?: bigint;
  }
): Promise<void> => {
  const now = input.now ?? context.sim.clock.getTicks();
  await context.prisma.schedulerCursor.upsert({
    where: {
      key: SCHEDULER_CURSOR_KEY
    },
    update: {
      last_scanned_tick: input.lastScannedTick,
      last_signal_tick: input.lastSignalTick,
      updated_at: now
    },
    create: {
      key: SCHEDULER_CURSOR_KEY,
      last_scanned_tick: input.lastScannedTick,
      last_signal_tick: input.lastSignalTick,
      updated_at: now
    }
  });
};

export const getSchedulerCursor = async (
  context: AppContext
): Promise<{ last_scanned_tick: bigint; last_signal_tick: bigint } | null> => {
  const cursor = await context.prisma.schedulerCursor.findUnique({
    where: {
      key: SCHEDULER_CURSOR_KEY
    }
  });

  if (!cursor) {
    return null;
  }

  return {
    last_scanned_tick: cursor.last_scanned_tick,
    last_signal_tick: cursor.last_signal_tick
  };
};
