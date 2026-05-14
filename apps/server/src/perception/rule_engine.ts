import type {
  PerceptionEventInput,
  PerceptionLocationInput,
  PerceptionObserverRelation,
  PerceptionResolver,
  PerceptionRuleDef,
  PerceptionRuleInput,
  PerceptionRuleOutput
} from './types.js';

export interface PerceptionRuleEngine {
  evaluate(input: PerceptionRuleInput): Promise<PerceptionRuleOutput>;
}

// ── Rule matching ──

const matchesWhen = (
  when: PerceptionRuleDef['when'],
  event: PerceptionEventInput | undefined,
  _location: PerceptionLocationInput | undefined,
  observerRelation: PerceptionObserverRelation,
  agentCapabilities: string[],
  investigationCount: number,
  observerEntityId: string
): boolean => {
  // Event-specific constraints require an event
  if (!event && (when.event_visibility !== undefined || when.observer_is_actor !== undefined)) {
    return false;
  }

  // observer_at — skip for global events (locationId === null)
  if (when.observer_at) {
    const isGlobalEvent = event?.locationId === null;
    if (!isGlobalEvent) {
      if (observerRelation !== when.observer_at) {
        return false;
      }
    }
  }

  // event_visibility — only applies when an event is present
  if (when.event_visibility !== undefined && event) {
    if (event.visibility !== when.event_visibility) {
      return false;
    }
  }

  // observer_is_actor — only applies when both event and observer exist
  if (when.observer_is_actor !== undefined && event) {
    const isActor = event.actorEntityId === observerEntityId;
    if (isActor !== when.observer_is_actor) {
      return false;
    }
  }

  // investigation_count_min
  if (when.investigation_count_min !== undefined) {
    if (investigationCount < when.investigation_count_min) {
      return false;
    }
  }

  // observer_has_capability
  if (when.observer_has_capability) {
    if (!agentCapabilities.includes(when.observer_has_capability)) {
      return false;
    }
  }

  return true;
};

// ── Description assembly (environment perception) ──

const buildDescriptions = (
  then: PerceptionRuleDef['then'],
  location: PerceptionLocationInput | undefined,
  investigationCount: number
): { visibleDescription: string; hiddenDescription: string | null } => {
  const visibleParts: string[] = [];
  let hiddenDescription: string | null = null;

  if (location) {
    if (then.reveal_public && location.publicDescription) {
      visibleParts.push(location.publicDescription);
    }

    if (then.reveal_hidden && location.hiddenDetails) {
      const segments = Array.isArray(location.hiddenDetails)
        ? location.hiddenDetails
        : [location.hiddenDetails];

      const maxSegments = then.max_hidden_segments ?? segments.length;
      const revealCount = Math.min(investigationCount, maxSegments);
      const revealed = segments.slice(0, revealCount);
      const hidden = segments.slice(revealCount);

      if (revealed.length > 0) {
        visibleParts.push(`[调查发现] ${revealed.join(' ')}`);
      }
      if (hidden.length > 0) {
        hiddenDescription = hidden.join(' ');
      }
    }
  }

  return {
    visibleDescription: visibleParts.join('\n'),
    hiddenDescription
  };
};

// ── Engine fallback (when no rule matches) ──

const engineFallback = (input: PerceptionRuleInput): PerceptionRuleOutput => {
  // Global events (no location_id) are always fully visible
  if (input.event?.locationId === null) {
    return { level: 'full', visibleDescription: '', hiddenDescription: null, matchedRuleId: 'builtin:global-event-fallback' };
  }

  return { level: 'none', visibleDescription: '', hiddenDescription: null, matchedRuleId: 'builtin:fallback-deny' };
};

// ── Factory ──

export const createPerceptionRuleEngine = (
  rules: PerceptionRuleDef[],
  pluginResolver?: PerceptionResolver | null
): PerceptionRuleEngine => {
  return {
    async evaluate(input: PerceptionRuleInput): Promise<PerceptionRuleOutput> {
      // 1. Evaluate pack/built-in rules in order — first match wins
      for (const rule of rules) {
        if (
          matchesWhen(
            rule.when,
            input.event,
            input.location,
            input.observerRelation,
            input.agentCapabilities,
            input.investigationCount,
            input.observerEntityId
          )
        ) {
          const { visibleDescription, hiddenDescription } = buildDescriptions(
            rule.then,
            input.location,
            input.investigationCount
          );

          return {
            level: rule.then.level,
            visibleDescription,
            hiddenDescription,
            matchedRuleId: rule.id
          };
        }
      }

      // 2. Fallback to plugin resolver
      if (pluginResolver) {
        return pluginResolver.resolve(input);
      }

      // 3. Engine-level fallback
      return engineFallback(input);
    }
  };
};
