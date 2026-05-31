import type { DbContext } from '../../../utils/db_context.js';

export interface LatestEventEvidenceRecord {
  id: string;
  title: string;
  type: string;
  impact_data: string | null;
  tick: bigint;
  created_at: bigint;
}

export const getLatestEventEvidenceRecord = async (
  context: DbContext,
  packId: string
): Promise<LatestEventEvidenceRecord | null> => {
  return context.prisma.event.findFirst({
    where: {
      pack_id: packId
    },
    orderBy: {
      tick: 'desc'
    },
    select: {
      id: true,
      title: true,
      type: true,
      impact_data: true,
      tick: true,
      created_at: true
    }
  });
};
