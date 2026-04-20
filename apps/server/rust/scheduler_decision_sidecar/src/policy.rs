use crate::models::{
    EventDrivenSchedulerReason, SchedulerKernelEvaluateInput, SchedulerRecoveryWindowType,
    SchedulerReason, SchedulerSkipReason,
};

pub fn is_periodic_reason(reason: &SchedulerReason) -> bool {
    matches!(reason, SchedulerReason::PeriodicTick | SchedulerReason::BootstrapSeed)
}

pub fn is_event_driven_reason(reason: &SchedulerReason) -> bool {
    !is_periodic_reason(reason)
}

pub fn recovery_skip_reason(
    recovery_window_type: &SchedulerRecoveryWindowType,
    kind: &crate::models::SchedulerKind,
) -> SchedulerSkipReason {
    match (recovery_window_type, kind) {
        (SchedulerRecoveryWindowType::Replay, crate::models::SchedulerKind::Periodic) => {
            SchedulerSkipReason::ReplayWindowPeriodicSuppressed
        }
        (SchedulerRecoveryWindowType::Replay, crate::models::SchedulerKind::EventDriven) => {
            SchedulerSkipReason::ReplayWindowEventSuppressed
        }
        (SchedulerRecoveryWindowType::Retry, crate::models::SchedulerKind::Periodic) => {
            SchedulerSkipReason::RetryWindowPeriodicSuppressed
        }
        (SchedulerRecoveryWindowType::Retry, crate::models::SchedulerKind::EventDriven) => {
            SchedulerSkipReason::RetryWindowEventSuppressed
        }
    }
}

pub fn should_suppress_for_recovery_window(
    input: &SchedulerKernelEvaluateInput,
    kind: &crate::models::SchedulerKind,
    reason: &SchedulerReason,
    recovery_window_type: &SchedulerRecoveryWindowType,
) -> bool {
    let Some(policy) = input.recovery_suppression.get(recovery_window_type) else {
        return false;
    };

    if matches!(kind, crate::models::SchedulerKind::Periodic) {
        return policy.suppress_periodic;
    }

    if !is_event_driven_reason(reason) {
        return false;
    }

    let event_reason = match reason {
        SchedulerReason::EventFollowup => EventDrivenSchedulerReason::EventFollowup,
        SchedulerReason::RelationshipChangeFollowup => {
            EventDrivenSchedulerReason::RelationshipChangeFollowup
        }
        SchedulerReason::SnrChangeFollowup => EventDrivenSchedulerReason::SnrChangeFollowup,
        SchedulerReason::OverlayChangeFollowup => {
            EventDrivenSchedulerReason::OverlayChangeFollowup
        }
        SchedulerReason::MemoryChangeFollowup => EventDrivenSchedulerReason::MemoryChangeFollowup,
        _ => return false,
    };

    let Some(signal_policy) = input.signal_policy.get(&event_reason) else {
        return false;
    };

    policy
        .suppress_event_tiers
        .iter()
        .any(|tier| tier == &signal_policy.suppression_tier)
}
