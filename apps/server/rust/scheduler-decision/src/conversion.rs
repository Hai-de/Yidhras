use crate::models::{EventDrivenSchedulerReason, SchedulerReason};

impl From<EventDrivenSchedulerReason> for SchedulerReason {
    fn from(reason: EventDrivenSchedulerReason) -> Self {
        match reason {
            EventDrivenSchedulerReason::EventFollowup => SchedulerReason::EventFollowup,
            EventDrivenSchedulerReason::RelationshipChangeFollowup => {
                SchedulerReason::RelationshipChangeFollowup
            }
            EventDrivenSchedulerReason::SnrChangeFollowup => SchedulerReason::SnrChangeFollowup,
            EventDrivenSchedulerReason::OverlayChangeFollowup => {
                SchedulerReason::OverlayChangeFollowup
            }
            EventDrivenSchedulerReason::MemoryChangeFollowup => {
                SchedulerReason::MemoryChangeFollowup
            }
        }
    }
}

impl From<&EventDrivenSchedulerReason> for SchedulerReason {
    fn from(reason: &EventDrivenSchedulerReason) -> Self {
        match reason {
            EventDrivenSchedulerReason::EventFollowup => SchedulerReason::EventFollowup,
            EventDrivenSchedulerReason::RelationshipChangeFollowup => {
                SchedulerReason::RelationshipChangeFollowup
            }
            EventDrivenSchedulerReason::SnrChangeFollowup => SchedulerReason::SnrChangeFollowup,
            EventDrivenSchedulerReason::OverlayChangeFollowup => {
                SchedulerReason::OverlayChangeFollowup
            }
            EventDrivenSchedulerReason::MemoryChangeFollowup => {
                SchedulerReason::MemoryChangeFollowup
            }
        }
    }
}
