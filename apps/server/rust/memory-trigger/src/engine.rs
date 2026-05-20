use crate::models::{
    MemoryActivationEvaluationDto, MemoryActivationStatusDto, MemoryBehaviorDto, MemoryBlockDto,
    MemoryBlockTriggerDiagnosticsDto, MemoryEvaluationContextDto, MemoryRuntimeStateDto,
    MemoryTriggerRateDecisionRecord,
};
use crate::sampling::{build_trigger_rate_gate_seed, compute_trigger_rate_sample};
use crate::trigger::compute_matched_triggers;
use sidecar_common::types::Tick;

pub fn create_initial_memory_runtime_state(memory_id: &str) -> MemoryRuntimeStateDto {
    MemoryRuntimeStateDto {
        memory_id: memory_id.to_string(),
        trigger_count: 0,
        last_triggered_tick: None,
        last_inserted_tick: None,
        cooldown_until_tick: None,
        delayed_until_tick: None,
        retain_until_tick: None,
        currently_active: false,
        last_activation_score: None,
        recent_distance_from_latest_message: None,
    }
}

pub fn resolve_distance_from_latest_message(
    block: &MemoryBlockDto,
    context: &MemoryEvaluationContextDto,
) -> Option<i64> {
    let source_ref = block.source_ref.as_ref()?;
    let source_message_id = source_ref.source_message_id.as_ref()?;
    let trace_records = context.recent.as_ref()?.trace.as_ref()?;

    trace_records
        .iter()
        .position(|record| {
            &record.id == source_message_id
                || source_ref.source_id.as_ref().is_some_and(|source_id| &record.id == source_id)
        })
        .map(|index| index as i64)
}

pub fn calculate_activation_score(trigger_matches: &[(String, f64)]) -> f64 {
    trigger_matches.iter().map(|(_, score)| *score).sum()
}

fn has_pending_delayed_activation(state: &MemoryRuntimeStateDto, now: Tick) -> bool {
    state.delayed_until_tick.is_some_and(|tick| tick > now)
}

fn is_delayed_activation_due(state: &MemoryRuntimeStateDto, now: Tick) -> bool {
    state.delayed_until_tick.is_some_and(|tick| tick <= now)
}

fn evaluate_trigger_rate_gate(
    block: &MemoryBlockDto,
    behavior: &MemoryBehaviorDto,
    state: &MemoryRuntimeStateDto,
    context: &MemoryEvaluationContextDto,
    base_match: bool,
    score_passed: bool,
    fresh_trigger_attempt: bool,
) -> MemoryBlockTriggerDiagnosticsDto {
    let present = (behavior.activation.trigger_rate - 1.0).abs() > f64::EPSILON;
    let applied = present && base_match && score_passed && fresh_trigger_attempt;

    let trigger_rate = if !present {
        MemoryTriggerRateDecisionRecord {
            present: false,
            value: None,
            applied: false,
            sample: None,
            passed: None,
        }
    } else if !applied {
        MemoryTriggerRateDecisionRecord {
            present: true,
            value: Some(behavior.activation.trigger_rate),
            applied: false,
            sample: None,
            passed: None,
        }
    } else if behavior.activation.trigger_rate <= 0.0 {
        MemoryTriggerRateDecisionRecord {
            present: true,
            value: Some(behavior.activation.trigger_rate),
            applied: true,
            sample: None,
            passed: Some(false),
        }
    } else if behavior.activation.trigger_rate >= 1.0 {
        MemoryTriggerRateDecisionRecord {
            present: true,
            value: Some(behavior.activation.trigger_rate),
            applied: true,
            sample: None,
            passed: Some(true),
        }
    } else {
        let tick_str = context.current_tick.to_string();
        let seed = build_trigger_rate_gate_seed(
            block.pack_id.as_deref(),
            &block.id,
            &tick_str,
            state.trigger_count,
        );
        let sample = compute_trigger_rate_sample(&seed);
        MemoryTriggerRateDecisionRecord {
            present: true,
            value: Some(behavior.activation.trigger_rate),
            applied: true,
            sample: Some(sample),
            passed: Some(sample < behavior.activation.trigger_rate),
        }
    };

    MemoryBlockTriggerDiagnosticsDto {
        trigger_rate,
        base_match,
        score_passed,
        fresh_trigger_attempt,
    }
}

pub fn resolve_status(
    behavior: &MemoryBehaviorDto,
    state: &MemoryRuntimeStateDto,
    now: Tick,
    matched: bool,
) -> MemoryActivationStatusDto {
    if state.cooldown_until_tick.is_some_and(|tick| tick > now) {
        return MemoryActivationStatusDto::Cooling;
    }

    if state.delayed_until_tick.is_some_and(|tick| tick > now) {
        return MemoryActivationStatusDto::Delayed;
    }

    if state.delayed_until_tick.is_some_and(|tick| tick <= now) && state.currently_active {
        return MemoryActivationStatusDto::Active;
    }

    if state.retain_until_tick.is_some_and(|tick| tick > now) && !matched {
        return MemoryActivationStatusDto::Retained;
    }

    if !matched {
        return MemoryActivationStatusDto::Inactive;
    }

    if behavior.retention.delay_rounds_before_insert > 0 && state.delayed_until_tick.is_none() {
        return MemoryActivationStatusDto::Delayed;
    }

    MemoryActivationStatusDto::Active
}

pub fn evaluate_memory_block_activation(
    block: &MemoryBlockDto,
    behavior: &MemoryBehaviorDto,
    state: Option<&MemoryRuntimeStateDto>,
    context: &MemoryEvaluationContextDto,
) -> MemoryActivationEvaluationDto {
    let runtime_state =
        state.cloned().unwrap_or_else(|| create_initial_memory_runtime_state(&block.id));
    let matched_triggers = compute_matched_triggers(block, behavior, context);
    let base_match = !matched_triggers.is_empty();
    let activation_score = calculate_activation_score(&matched_triggers);
    let score_passed = activation_score >= behavior.activation.min_score;
    let now = context.current_tick;
    let pending_delayed_activation = has_pending_delayed_activation(&runtime_state, now);
    let delayed_activation_due = is_delayed_activation_due(&runtime_state, now);
    let fresh_trigger_attempt = !pending_delayed_activation && !delayed_activation_due;
    let trigger_diagnostics = evaluate_trigger_rate_gate(
        block,
        behavior,
        &runtime_state,
        context,
        base_match,
        score_passed,
        fresh_trigger_attempt,
    );
    let gate_passed = if trigger_diagnostics.trigger_rate.applied {
        trigger_diagnostics.trigger_rate.passed == Some(true)
    } else {
        true
    };
    let matched =
        if delayed_activation_due { true } else { base_match && score_passed && gate_passed };
    let recent_distance_from_latest_message = resolve_distance_from_latest_message(block, context);
    let status = resolve_status(behavior, &runtime_state, now, matched);
    let reason = if !base_match {
        Some("no_trigger_match".to_string())
    } else if !score_passed {
        Some("below_min_score".to_string())
    } else if !gate_passed {
        Some("trigger_rate_blocked".to_string())
    } else {
        None
    };

    MemoryActivationEvaluationDto {
        memory_id: block.id.clone(),
        status,
        trigger_diagnostics,
        activation_score,
        matched_triggers: matched_triggers.into_iter().map(|(label, _)| label).collect(),
        reason,
        recent_distance_from_latest_message,
    }
}

pub fn apply_memory_activation_to_runtime_state(
    behavior: &MemoryBehaviorDto,
    evaluation: &MemoryActivationEvaluationDto,
    previous_state: Option<&MemoryRuntimeStateDto>,
    current_tick: Tick,
) -> MemoryRuntimeStateDto {
    let previous = previous_state
        .cloned()
        .unwrap_or_else(|| create_initial_memory_runtime_state(&evaluation.memory_id));

    let mut next = MemoryRuntimeStateDto {
        memory_id: evaluation.memory_id.clone(),
        trigger_count: previous.trigger_count,
        last_triggered_tick: previous.last_triggered_tick,
        last_inserted_tick: previous.last_inserted_tick,
        cooldown_until_tick: previous.cooldown_until_tick,
        delayed_until_tick: previous.delayed_until_tick,
        retain_until_tick: previous.retain_until_tick,
        currently_active: matches!(
            evaluation.status,
            MemoryActivationStatusDto::Active | MemoryActivationStatusDto::Retained
        ),
        last_activation_score: Some(evaluation.activation_score),
        recent_distance_from_latest_message: evaluation.recent_distance_from_latest_message,
    };

    match evaluation.status {
        MemoryActivationStatusDto::Active => {
            next.trigger_count = previous.trigger_count + 1;
            next.last_triggered_tick = Some(current_tick);
            next.delayed_until_tick = None;
            next.last_inserted_tick = Some(current_tick);
            next.delayed_until_tick = if behavior.retention.delay_rounds_before_insert > 0 {
                Some(Tick::new(
                    current_tick
                        .as_u64()
                        .saturating_add(behavior.retention.delay_rounds_before_insert as u64),
                ))
            } else {
                None
            };
            next.retain_until_tick = if behavior.retention.retain_rounds_after_trigger > 0 {
                Some(Tick::new(
                    current_tick
                        .as_u64()
                        .saturating_add(behavior.retention.retain_rounds_after_trigger as u64),
                ))
            } else {
                None
            };
            next.cooldown_until_tick = if behavior.retention.cooldown_rounds_after_insert > 0 {
                Some(Tick::new(
                    current_tick
                        .as_u64()
                        .saturating_add(behavior.retention.cooldown_rounds_after_insert as u64),
                ))
            } else {
                None
            };
        }
        MemoryActivationStatusDto::Delayed => {
            next.last_triggered_tick = previous.last_triggered_tick.or(Some(current_tick));
            next.delayed_until_tick = previous.delayed_until_tick.or_else(|| {
                Some(Tick::new(
                    current_tick.as_u64().saturating_add(std::cmp::max(
                        behavior.retention.delay_rounds_before_insert,
                        1,
                    ) as u64),
                ))
            });
        }
        MemoryActivationStatusDto::Retained => {
            next.retain_until_tick = previous.retain_until_tick;
        }
        MemoryActivationStatusDto::Cooling => {
            next.cooldown_until_tick = previous.cooldown_until_tick;
        }
        MemoryActivationStatusDto::Inactive => {
            next.currently_active = false;
        }
    }

    next
}

#[cfg(test)]
mod tests {
    use super::{
        apply_memory_activation_to_runtime_state, create_initial_memory_runtime_state,
        evaluate_memory_block_activation,
    };
    use crate::models::{
        MemoryActivationModeDto, MemoryActivationRuleDto, MemoryActivationStatusDto,
        MemoryBehaviorDto, MemoryBlockDto, MemoryBlockKindDto, MemoryBlockSourceRefDto,
        MemoryBlockStatusDto, MemoryEvaluationContextDto, MemoryKeywordMatchModeDto,
        MemoryMutationPolicyDto, MemoryPlacementModeDto, MemoryPlacementRuleDto,
        MemoryPlacementSlotDto, MemoryRecentSourceRecordDto, MemoryRecentSourceRecordKindDto,
        MemoryRecentSourcesDto, MemoryRetentionRuleDto, MemoryTriggerDto,
    };
    use serde_json::{json, Map, Value};
    use sidecar_common::types::Tick;

    fn sample_behavior(delay_rounds_before_insert: i64) -> MemoryBehaviorDto {
        MemoryBehaviorDto {
            mutation: MemoryMutationPolicyDto {
                allow_insert: true,
                allow_rewrite: true,
                allow_delete: true,
            },
            placement: MemoryPlacementRuleDto {
                slot: MemoryPlacementSlotDto::MemoryLongTerm,
                anchor: None,
                mode: MemoryPlacementModeDto::Append,
                depth: 0,
                order: 0,
            },
            activation: MemoryActivationRuleDto {
                mode: MemoryActivationModeDto::Keyword,
                trigger_rate: 1.0,
                min_score: 1.0,
                triggers: vec![MemoryTriggerDto::Keyword {
                    r#match: MemoryKeywordMatchModeDto::Any,
                    keywords: vec!["调查".to_string()],
                    case_sensitive: Some(false),
                    fields: None,
                    score: Some(1.0),
                }],
            },
            retention: MemoryRetentionRuleDto {
                retain_rounds_after_trigger: 2,
                cooldown_rounds_after_insert: 3,
                delay_rounds_before_insert,
            },
        }
    }

    fn sample_block() -> MemoryBlockDto {
        MemoryBlockDto {
            id: "mem-1".to_string(),
            owner_agent_id: "agent-1".to_string(),
            pack_id: Some("pack-1".to_string()),
            kind: MemoryBlockKindDto::Reflection,
            status: MemoryBlockStatusDto::Active,
            title: None,
            content_text: "L 正在调查异常死亡。".to_string(),
            content_structured: None,
            tags: vec![],
            keywords: vec![],
            source_ref: Some(MemoryBlockSourceRefDto {
                source_kind: None,
                source_id: Some("trace-1".to_string()),
                source_message_id: Some("trace-1".to_string()),
            }),
            importance: 1.0,
            salience: 1.0,
            confidence: Some(1.0),
            embedding: None,
            embedding_model: None,
            created_at_tick: "1".to_string(),
            updated_at_tick: "1".to_string(),
        }
    }

    fn sample_context(current_tick: Tick) -> MemoryEvaluationContextDto {
        MemoryEvaluationContextDto {
            actor_ref: json!({ "id": "agent-1" }),
            resolved_agent_id: Some("agent-1".to_string()),
            pack_id: Some("pack-1".to_string()),
            current_tick,
            attributes: None,
            pack_state: None,
            query_embedding: None,
            recent: Some(MemoryRecentSourcesDto {
                trace: Some(vec![MemoryRecentSourceRecordDto {
                    id: "trace-1".to_string(),
                    kind: MemoryRecentSourceRecordKindDto::Trace,
                    payload: Map::from_iter(vec![(
                        "reasoning".to_string(),
                        Value::String("正在调查异常死亡".to_string()),
                    )]),
                    occurred_at_tick: current_tick.to_string(),
                }]),
                intent: None,
                event: None,
            }),
        }
    }

    #[test]
    fn creates_initial_runtime_state() {
        let state = create_initial_memory_runtime_state("mem-1");
        assert_eq!(state.memory_id, "mem-1");
        assert_eq!(state.trigger_count, 0);
        assert!(!state.currently_active);
    }

    #[test]
    fn evaluates_active_when_matched_without_delay() {
        let evaluation = evaluate_memory_block_activation(
            &sample_block(),
            &sample_behavior(0),
            None,
            &sample_context(Tick::new(10)),
        );

        assert_eq!(evaluation.status, MemoryActivationStatusDto::Active);
        assert_eq!(evaluation.activation_score, 1.0);
        assert_eq!(evaluation.recent_distance_from_latest_message, Some(0));
    }

    #[test]
    fn evaluates_delayed_when_first_match_has_delay() {
        let evaluation = evaluate_memory_block_activation(
            &sample_block(),
            &sample_behavior(2),
            None,
            &sample_context(Tick::new(10)),
        );

        assert_eq!(evaluation.status, MemoryActivationStatusDto::Delayed);
    }

    #[test]
    fn delay_due_turns_into_active() {
        let previous_state = crate::models::MemoryRuntimeStateDto {
            memory_id: "mem-1".to_string(),
            trigger_count: 0,
            last_triggered_tick: Some(Tick::new(10)),
            last_inserted_tick: None,
            cooldown_until_tick: None,
            delayed_until_tick: Some(Tick::new(10)),
            retain_until_tick: None,
            currently_active: false,
            last_activation_score: None,
            recent_distance_from_latest_message: None,
        };

        let evaluation = evaluate_memory_block_activation(
            &sample_block(),
            &sample_behavior(2),
            Some(&previous_state),
            &sample_context(Tick::new(10)),
        );

        assert_eq!(evaluation.status, MemoryActivationStatusDto::Active);
    }

    #[test]
    fn apply_active_updates_runtime_state() {
        let evaluation = evaluate_memory_block_activation(
            &sample_block(),
            &sample_behavior(0),
            None,
            &sample_context(Tick::new(10)),
        );
        let next_state = apply_memory_activation_to_runtime_state(
            &sample_behavior(0),
            &evaluation,
            None,
            Tick::new(10),
        );

        assert_eq!(next_state.trigger_count, 1);
        assert_eq!(next_state.last_triggered_tick, Some(Tick::new(10)));
        assert_eq!(next_state.last_inserted_tick, Some(Tick::new(10)));
        assert!(next_state.currently_active);
    }
}
