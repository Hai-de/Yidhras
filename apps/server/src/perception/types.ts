export type PerceptionLevel = 'full' | 'partial' | 'none';

// ── Rule definition (matches YAML schema) ──

export interface PerceptionWhenClause {
  observer_at?: 'same' | 'adjacent' | 'any';
  event_visibility?: 'public' | 'private';
  observer_is_actor?: boolean;
  investigation_count_min?: number;
  observer_has_capability?: string;
}

export interface PerceptionThenClause {
  level: PerceptionLevel;
  reveal_public?: boolean;
  reveal_hidden?: boolean;
  max_hidden_segments?: number;
}

export interface PerceptionRuleDef {
  id: string;
  when: PerceptionWhenClause;
  then: PerceptionThenClause;
}

// ── Unified input ──

export interface PerceptionEventInput {
  eventId: string;
  eventTitle: string;
  eventDescription: string;
  locationId: string | null;
  visibility: string | null;
  actorEntityId: string | null;
}

export interface PerceptionLocationInput {
  locationId: string;
  publicDescription: string | null;
  hiddenDetails: string | string[] | null;
  tags: string[];
}

export type PerceptionObserverRelation = 'same' | 'adjacent' | 'different' | 'no_location';

export interface PerceptionRuleInput {
  event?: PerceptionEventInput;
  location?: PerceptionLocationInput;
  observerEntityId: string;
  observerRelation: PerceptionObserverRelation;
  agentCapabilities: string[];
  investigationCount: number;
}

// ── Unified output ──

export interface PerceptionRuleOutput {
  level: PerceptionLevel;
  visibleDescription: string;
  hiddenDescription: string | null;
  matchedRuleId: string | null;
}

// ── Unified resolver interface ──

export interface PerceptionResolver {
  resolve(input: PerceptionRuleInput): Promise<PerceptionRuleOutput>;
}


