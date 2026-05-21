import type { AppInfrastructure } from '../context.js';

export interface LatestEventEvidenceRecord {
  id: string;
  title: string;
  type: string;
  impact_data: string | null;
  created_at: bigint;
}

export const getLatestEventEvidenceRecord = async (
  context: AppInfrastructure
): Promise<LatestEventEvidenceRecord | null> => {
  return context.prisma.event.findFirst({
    orderBy: {
      tick: 'desc'
    },
    select: {
      id: true,
      title: true,
      type: true,
      impact_data: true,
      created_at: true
    }
  });
};
