export type PerceptionLevel = 'full' | 'partial' | 'none';

// ── Rule definition (matches YAML schema) ──

export interface PerceptionWhenClause {
  observer_at?: 'same' | 'adjacent' | 'any' | undefined;
  event_visibility?: 'public' | 'private' | undefined;
  observer_is_actor?: boolean | undefined;
  investigation_count_min?: number | undefined;
  observer_has_capability?: string | undefined;
}

export interface PerceptionThenClause {
  level: PerceptionLevel;
  reveal_public?: boolean | undefined;
  reveal_hidden?: boolean | undefined;
  max_hidden_segments?: number | undefined;
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
  event?: PerceptionEventInput | undefined;
  location?: PerceptionLocationInput | undefined;
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


