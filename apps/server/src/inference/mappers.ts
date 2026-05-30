import type { PolicyRule } from '../access_policy/types.js';
import { extractSemanticType } from './helpers.js';
import type {
  InferenceAgentSnapshot,
  InferenceBindingRef,
  InferencePackLatestEventSnapshot} from './types.js';

// ── Binding ──────────────────────────────────────────────────

interface BindingPrismaRow {
  id: string;
  role: string;
  status: string;
  agent_id: string | null;
  atmosphere_node_id: string | null;
}

export const toBindingRef = (row: BindingPrismaRow): InferenceBindingRef => ({
  binding_id: row.id,
  role: (row.role === 'active' || row.role === 'atmosphere' ? row.role : 'active'),
  status: row.status,
  agent_id: row.agent_id,
  atmosphere_node_id: row.atmosphere_node_id
});

// ── Agent snapshot ───────────────────────────────────────────

interface AgentSnapshotSource {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  snr?: unknown;
  is_pinned?: unknown;
}

export const toAgentSnapshot = (source: AgentSnapshotSource): InferenceAgentSnapshot => ({
  id: typeof source.id === 'string' ? source.id : '',
  name: typeof source.name === 'string' ? source.name : '',
  type: typeof source.type === 'string' ? source.type : '',
  snr: typeof source.snr === 'number' ? source.snr : 0,
  is_pinned: source.is_pinned === true
});

// ── Event snapshot ───────────────────────────────────────────

interface EventPrismaRow {
  id: string;
  title: string;
  type: string;
  impact_data: string | null;
  tick: bigint;
  created_at: Date | bigint;
}

export const toPackLatestEventSnapshot = (row: EventPrismaRow): InferencePackLatestEventSnapshot => ({
  event_id: row.id,
  title: row.title,
  type: row.type,
  semantic_type: extractSemanticType(row.impact_data),
  tick: row.tick.toString(),
  created_at: row.created_at.toString()
});

// ── Policy rule ──────────────────────────────────────────────

interface PolicyPrismaRow {
  id: string;
  effect: string;
  subject_id: string | null;
  subject_type: string | null;
  resource: string;
  action: string;
  field: string;
  conditions: unknown;
  priority: number;
}

export const toPolicyRule = (row: PolicyPrismaRow): PolicyRule => ({
  id: row.id,
  effect: row.effect === 'deny' ? 'deny' : 'allow',
  subject_id: row.subject_id ?? null,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB value typed at boundary
  subject_type: (row.subject_type as PolicyRule['subject_type']) ?? null,
  resource: row.resource,
  action: row.action,
  field: row.field,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB value typed at boundary
  conditions: (row.conditions as Record<string, unknown> | null | undefined) ?? null,
  priority: row.priority
});
