import { randomUUID } from 'node:crypto';

import type { PackRuntimeRuleExecutionRecord } from '../../packs/runtime/core_models.js';
import { recordPackRuleExecution } from '../../packs/storage/rule_execution_repo.js';

export interface ObjectiveRuleExecutionRecordInput {
  id?: string;
  pack_id: string;
  rule_id: string;
  capability_key?: string | null;
  mediator_id?: string | null;
  subject_entity_id?: string | null;
  target_entity_id?: string | null;
  execution_status: string;
  payload_json?: Record<string, unknown> | null;
  emitted_events_json?: unknown[];
  now: bigint;
}

export const createObjectiveRuleExecutionRecord = async (
  input: ObjectiveRuleExecutionRecordInput
): Promise<PackRuntimeRuleExecutionRecord> => {
  return recordPackRuleExecution({
    id: input.id ?? randomUUID(),
    pack_id: input.pack_id,
    rule_id: input.rule_id,
    capability_key: input.capability_key ?? null,
    mediator_id: input.mediator_id ?? null,
    subject_entity_id: input.subject_entity_id ?? null,
    target_entity_id: input.target_entity_id ?? null,
    execution_status: input.execution_status,
    payload_json: input.payload_json ?? null,
    emitted_events_json: input.emitted_events_json ?? [],
    now: input.now
  });
};
