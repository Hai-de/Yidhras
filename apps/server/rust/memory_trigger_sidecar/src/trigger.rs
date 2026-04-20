use crate::logic_dsl::evaluate_memory_logic_expr;
use crate::models::{
    MemoryActivationModeDto, MemoryBehaviorDto, MemoryBlockDto, MemoryEvaluationContextDto,
    MemoryKeywordFieldDto, MemoryKeywordMatchModeDto, MemoryRecentSourceDto,
    MemoryRecentSourceMatchOpDto, MemoryRecentSourceRecordDto, MemoryTriggerDto,
};
use serde_json::{json, Value};

fn contains_keyword(value: &str, keyword: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        value.contains(keyword)
    } else {
        value.to_lowercase().contains(&keyword.to_lowercase())
    }
}

fn build_keyword_haystacks(
    block: &MemoryBlockDto,
    context: &MemoryEvaluationContextDto,
    fields: Option<&Vec<MemoryKeywordFieldDto>>,
) -> Vec<String> {
    let selected_fields = fields
        .cloned()
        .unwrap_or_else(|| vec![MemoryKeywordFieldDto::ContentText]);
    let mut haystacks = Vec::new();

    for field in selected_fields {
        match field {
            MemoryKeywordFieldDto::ContentText => {
                haystacks.push(block.content_text.clone());
            }
            MemoryKeywordFieldDto::ContentStructured => {
                if let Some(content) = &block.content_structured {
                    haystacks.push(Value::Object(content.clone()).to_string());
                }
            }
            MemoryKeywordFieldDto::RecentTraceReasoning => {
                if let Some(records) = context.recent.as_ref().and_then(|recent| recent.trace.as_ref()) {
                    for trace in records {
                        if let Some(reasoning) = trace.payload.get("reasoning").and_then(Value::as_str) {
                            haystacks.push(reasoning.to_string());
                        }
                    }
                }
            }
            MemoryKeywordFieldDto::RecentEventText => {
                if let Some(records) = context.recent.as_ref().and_then(|recent| recent.event.as_ref()) {
                    for event in records {
                        let title = event
                            .payload
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let description = event
                            .payload
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let joined = [title, description]
                            .iter()
                            .filter(|value| !value.is_empty())
                            .cloned()
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !joined.trim().is_empty() {
                            haystacks.push(joined);
                        }
                    }
                }
            }
        }
    }

    haystacks
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect()
}

fn evaluate_keyword_trigger(
    block: &MemoryBlockDto,
    context: &MemoryEvaluationContextDto,
    keywords: &[String],
    match_mode: &MemoryKeywordMatchModeDto,
    case_sensitive: bool,
    fields: Option<&Vec<MemoryKeywordFieldDto>>,
) -> bool {
    let haystacks = build_keyword_haystacks(block, context, fields);
    if haystacks.is_empty() || keywords.is_empty() {
        return false;
    }

    let matches_keyword = |keyword: &str| {
        haystacks
            .iter()
            .any(|haystack| contains_keyword(haystack, keyword, case_sensitive))
    };

    match match_mode {
        MemoryKeywordMatchModeDto::All => keywords.iter().all(|keyword| matches_keyword(keyword)),
        MemoryKeywordMatchModeDto::Any => keywords.iter().any(|keyword| matches_keyword(keyword)),
    }
}

fn resolve_recent_source_records<'a>(
    context: &'a MemoryEvaluationContextDto,
    source: &MemoryRecentSourceDto,
) -> &'a [MemoryRecentSourceRecordDto] {
    match source {
        MemoryRecentSourceDto::Trace => context
            .recent
            .as_ref()
            .and_then(|recent| recent.trace.as_deref())
            .unwrap_or(&[]),
        MemoryRecentSourceDto::Intent => context
            .recent
            .as_ref()
            .and_then(|recent| recent.intent.as_deref())
            .unwrap_or(&[]),
        MemoryRecentSourceDto::Event => context
            .recent
            .as_ref()
            .and_then(|recent| recent.event.as_deref())
            .unwrap_or(&[]),
    }
}

fn evaluate_recent_source_trigger(
    context: &MemoryEvaluationContextDto,
    source: &MemoryRecentSourceDto,
    match_field: &str,
    op: &MemoryRecentSourceMatchOpDto,
    value: Option<&Value>,
    values: Option<&Vec<Value>>,
) -> bool {
    resolve_recent_source_records(context, source)
        .iter()
        .any(|candidate| {
            let current = candidate.payload.get(match_field);
            match op {
                MemoryRecentSourceMatchOpDto::Eq => current == value,
                MemoryRecentSourceMatchOpDto::In => current
                    .map(|item| values.map(|items| items.contains(item)).unwrap_or(false))
                    .unwrap_or(false),
                MemoryRecentSourceMatchOpDto::Contains => current
                    .and_then(Value::as_str)
                    .zip(value.and_then(Value::as_str))
                    .map(|(current, expected)| current.contains(expected))
                    .unwrap_or(false),
                MemoryRecentSourceMatchOpDto::Exists => current.is_some(),
                MemoryRecentSourceMatchOpDto::Gt => current
                    .and_then(Value::as_f64)
                    .zip(value.and_then(Value::as_f64))
                    .map(|(current, expected)| current > expected)
                    .unwrap_or(false),
                MemoryRecentSourceMatchOpDto::Lt => current
                    .and_then(Value::as_f64)
                    .zip(value.and_then(Value::as_f64))
                    .map(|(current, expected)| current < expected)
                    .unwrap_or(false),
            }
        })
}

pub fn evaluate_trigger(
    block: &MemoryBlockDto,
    context: &MemoryEvaluationContextDto,
    trigger: &MemoryTriggerDto,
) -> bool {
    match trigger {
        MemoryTriggerDto::Keyword {
            r#match,
            keywords,
            case_sensitive,
            fields,
            ..
        } => evaluate_keyword_trigger(
            block,
            context,
            keywords,
            r#match,
            case_sensitive.unwrap_or(false),
            fields.as_ref(),
        ),
        MemoryTriggerDto::Logic { expr, .. } => {
            let root = json!({
                "pack_state": context.pack_state,
                "recent": context.recent,
                "context": {
                    "attributes": context.attributes,
                    "current_tick": context.current_tick,
                    "resolved_agent_id": context.resolved_agent_id,
                    "pack_id": context.pack_id,
                },
                "actor_ref": context.actor_ref,
            });
            evaluate_memory_logic_expr(expr, &root)
        }
        MemoryTriggerDto::RecentSource {
            source,
            r#match,
            ..
        } => evaluate_recent_source_trigger(
            context,
            source,
            &r#match.field,
            &r#match.op,
            r#match.value.as_ref(),
            r#match.values.as_ref(),
        ),
    }
}

pub fn should_treat_as_always(behavior: &MemoryBehaviorDto) -> bool {
    behavior.activation.mode == MemoryActivationModeDto::Always
        || behavior.activation.triggers.is_empty()
}

pub fn compute_matched_triggers(
    block: &MemoryBlockDto,
    behavior: &MemoryBehaviorDto,
    context: &MemoryEvaluationContextDto,
) -> Vec<(String, f64)> {
    if should_treat_as_always(behavior) {
        return vec![("always".to_string(), 1.0)];
    }

    behavior
        .activation
        .triggers
        .iter()
        .enumerate()
        .filter_map(|(index, trigger)| {
            if !evaluate_trigger(block, context, trigger) {
                return None;
            }

            let score = match trigger {
                MemoryTriggerDto::Keyword { score, .. }
                | MemoryTriggerDto::Logic { score, .. }
                | MemoryTriggerDto::RecentSource { score, .. } => score.unwrap_or(1.0),
            };

            let label = match trigger {
                MemoryTriggerDto::Keyword { .. } => format!("keyword:{}", index),
                MemoryTriggerDto::Logic { .. } => format!("logic:{}", index),
                MemoryTriggerDto::RecentSource { .. } => format!("recent_source:{}", index),
            };

            Some((label, score))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{compute_matched_triggers, evaluate_trigger, should_treat_as_always};
    use crate::models::{
        MemoryActivationModeDto, MemoryActivationRuleDto, MemoryBehaviorDto, MemoryBlockDto,
        MemoryBlockKindDto, MemoryBlockStatusDto, MemoryEvaluationContextDto,
        MemoryKeywordFieldDto, MemoryMutationPolicyDto, MemoryPlacementModeDto,
        MemoryPlacementRuleDto, MemoryPlacementSlotDto, MemoryRecentSourceDto,
        MemoryRecentSourceMatchOpDto, MemoryRecentSourceRecordDto, MemoryRecentSourceTriggerMatchDto,
        MemoryRecentSourcesDto, MemoryRetentionRuleDto, MemoryTriggerDto,
    };
    use serde_json::{json, Map, Value};

    fn sample_behavior(triggers: Vec<MemoryTriggerDto>, mode: MemoryActivationModeDto) -> MemoryBehaviorDto {
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
                mode,
                trigger_rate: 1.0,
                min_score: 0.0,
                triggers,
            },
            retention: MemoryRetentionRuleDto {
                retain_rounds_after_trigger: 0,
                cooldown_rounds_after_insert: 0,
                delay_rounds_before_insert: 0,
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
            content_text: "L 的行动模式说明他已开始调查异常死亡。".to_string(),
            content_structured: None,
            tags: vec![],
            keywords: vec![],
            source_ref: None,
            importance: 0.9,
            salience: 0.8,
            confidence: Some(0.7),
            created_at_tick: "1".to_string(),
            updated_at_tick: "1".to_string(),
        }
    }

    fn sample_context() -> MemoryEvaluationContextDto {
        MemoryEvaluationContextDto {
            actor_ref: json!({ "id": "agent-1" }),
            resolved_agent_id: Some("agent-1".to_string()),
            pack_id: Some("pack-1".to_string()),
            current_tick: "10".to_string(),
            attributes: None,
            pack_state: None,
            recent: Some(MemoryRecentSourcesDto {
                trace: Some(vec![MemoryRecentSourceRecordDto {
                    id: "trace-1".to_string(),
                    kind: crate::models::MemoryRecentSourceRecordKindDto::Trace,
                    payload: Map::from_iter(vec![(
                        "reasoning".to_string(),
                        Value::String("L 正在调查异常死亡模式".to_string()),
                    )]),
                    occurred_at_tick: "10".to_string(),
                }]),
                intent: None,
                event: Some(vec![MemoryRecentSourceRecordDto {
                    id: "event-1".to_string(),
                    kind: crate::models::MemoryRecentSourceRecordKindDto::Event,
                    payload: Map::from_iter(vec![
                        ("semantic_type".to_string(), Value::String("suspicious_death_occurred".to_string())),
                        ("title".to_string(), Value::String("异常死亡".to_string())),
                    ]),
                    occurred_at_tick: "10".to_string(),
                }]),
            }),
        }
    }

    #[test]
    fn keyword_trigger_matches_recent_trace_reasoning() {
        let trigger = MemoryTriggerDto::Keyword {
            r#match: crate::models::MemoryKeywordMatchModeDto::Any,
            keywords: vec!["调查".to_string()],
            case_sensitive: Some(false),
            fields: Some(vec![MemoryKeywordFieldDto::RecentTraceReasoning]),
            score: Some(1.0),
        };

        assert!(evaluate_trigger(&sample_block(), &sample_context(), &trigger));
    }

    #[test]
    fn recent_source_trigger_matches_event_field() {
        let trigger = MemoryTriggerDto::RecentSource {
            source: MemoryRecentSourceDto::Event,
            r#match: MemoryRecentSourceTriggerMatchDto {
                field: "semantic_type".to_string(),
                op: MemoryRecentSourceMatchOpDto::Eq,
                value: Some(json!("suspicious_death_occurred")),
                values: None,
            },
            score: Some(1.0),
        };

        assert!(evaluate_trigger(&sample_block(), &sample_context(), &trigger));
    }

    #[test]
    fn always_mode_short_circuits_to_always_match() {
        let behavior = sample_behavior(vec![], MemoryActivationModeDto::Always);
        assert!(should_treat_as_always(&behavior));
        assert_eq!(compute_matched_triggers(&sample_block(), &behavior, &sample_context()), vec![("always".to_string(), 1.0)]);
    }
}
