import type { WorkflowJobStatus, WorkflowState } from '../../composables/api/useWorkflowApi'

export type WorkflowTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const resolveJobStatusTone = (status: WorkflowJobStatus): WorkflowTone => {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'info'
    case 'failed':
      return 'danger'
    case 'pending':
    default:
      return 'warning'
  }
}

export const resolveWorkflowStateTone = (workflowState: WorkflowState): WorkflowTone => {
  switch (workflowState) {
    case 'workflow_completed':
      return 'success'
    case 'decision_running':
    case 'dispatching':
      return 'info'
    case 'workflow_failed':
    case 'decision_failed':
      return 'danger'
    case 'workflow_dropped':
    case 'dispatch_pending':
    case 'decision_pending':
      return 'warning'
    default:
      return 'neutral'
  }
}

export const stringifyDebugValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '—'
  }

  return JSON.stringify(value, null, 2)
}
