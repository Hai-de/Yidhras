use crate::engine::{
    apply_memory_activation_to_runtime_state, evaluate_memory_block_activation,
};
use crate::models::{
    MemoryActivationStatusDto, MemoryTriggerRateDecisionSummary, MemoryTriggerSourceDiagnostics,
    MemoryTriggerSourceEvaluateInput, MemoryTriggerSourceEvaluateOutput, MemoryTriggerSourceRecordResult,
};
use std::collections::HashMap;

const PROTOCOL_VERSION: &str = "memory_trigger/v1alpha1";

pub fn evaluate(input: MemoryTriggerSourceEvaluateInput) -> MemoryTriggerSourceEvaluateOutput {
    let mut status_counts = HashMap::from([
        ("active".to_string(), 0usize),
        ("retained".to_string(), 0usize),
        ("delayed".to_string(), 0usize),
        ("cooling".to_string(), 0usize),
        ("inactive".to_string(), 0usize),
    ]);

    let mut trigger_rate_present_count = 0usize;
    let mut trigger_rate_applied_count = 0usize;
    let mut trigger_rate_blocked_count = 0usize;
    let mut materialized_count = 0usize;

    let records = input
        .candidates
        .iter()
        .map(|candidate| {
            let evaluation = evaluate_memory_block_activation(
                &candidate.block,
                &candidate.behavior,
                candidate.state.as_ref(),
                &input.evaluation_context,
            );
            let next_runtime_state = apply_memory_activation_to_runtime_state(
                &candidate.behavior,
                &evaluation,
                candidate.state.as_ref(),
                &input.evaluation_context.current_tick,
            );

            if evaluation.trigger_diagnostics.trigger_rate.present {
                trigger_rate_present_count += 1;
            }
            if evaluation.trigger_diagnostics.trigger_rate.applied {
                trigger_rate_applied_count += 1;
            }
            if evaluation.trigger_diagnostics.trigger_rate.passed == Some(false) {
                trigger_rate_blocked_count += 1;
            }

            let should_materialize = matches!(
                evaluation.status,
                MemoryActivationStatusDto::Active | MemoryActivationStatusDto::Retained
            );
            if should_materialize {
                materialized_count += 1;
            }

            let status_key = match evaluation.status {
                MemoryActivationStatusDto::Active => "active",
                MemoryActivationStatusDto::Retained => "retained",
                MemoryActivationStatusDto::Delayed => "delayed",
                MemoryActivationStatusDto::Cooling => "cooling",
                MemoryActivationStatusDto::Inactive => "inactive",
            }
            .to_string();

            if let Some(count) = status_counts.get_mut(&status_key) {
                *count += 1;
            }

            MemoryTriggerSourceRecordResult {
                memory_id: candidate.block.id.clone(),
                evaluation: evaluation.clone(),
                next_runtime_state,
                should_materialize,
                materialize_reason: if should_materialize {
                    Some(evaluation.status.clone())
                } else {
                    None
                },
                trigger_rate: Some(evaluation.trigger_diagnostics.trigger_rate.clone()),
            }
        })
        .collect::<Vec<_>>();

    MemoryTriggerSourceEvaluateOutput {
        protocol_version: PROTOCOL_VERSION,
        records,
        diagnostics: MemoryTriggerSourceDiagnostics {
            candidate_count: input.candidates.len(),
            materialized_count,
            status_counts,
            trigger_rate: MemoryTriggerRateDecisionSummary {
                present_count: trigger_rate_present_count,
                applied_count: trigger_rate_applied_count,
                blocked_count: trigger_rate_blocked_count,
            },
        },
    }
}
