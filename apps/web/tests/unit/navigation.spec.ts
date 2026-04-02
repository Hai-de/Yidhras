import { describe, expect, it } from 'vitest'

import {
  buildAgentNavigationTarget,
  buildSourceQuery,
  buildWorkflowJobNavigationTarget,
  buildWorkflowRunNavigationTarget
} from '../../features/shared/navigation'

describe('operator navigation helpers', () => {
  it('builds source query with scheduler/operator context', () => {
    expect(
      buildSourceQuery({
        sourcePage: 'overview',
        sourceRunId: 'run-1',
        sourceDecisionId: 'decision-1',
        sourceAgentId: 'agent-1'
      })
    ).toEqual({
      source_page: 'overview',
      source_run_id: 'run-1',
      source_decision_id: 'decision-1',
      source_agent_id: 'agent-1'
    })
  })

  it('builds workflow job navigation target with source context', () => {
    expect(
      buildWorkflowJobNavigationTarget('job-1', {
        sourcePage: 'agent',
        sourceAgentId: 'agent-9',
        sourceDecisionId: 'decision-9'
      })
    ).toEqual({
      path: '/workflow',
      query: {
        job_id: 'job-1',
        source_page: 'agent',
        source_agent_id: 'agent-9',
        source_decision_id: 'decision-9'
      }
    })
  })

  it('builds workflow run navigation target with overview scheduler source', () => {
    expect(
      buildWorkflowRunNavigationTarget('run-7', {
        sourcePage: 'overview',
        sourceRunId: 'run-7'
      })
    ).toEqual({
      path: '/workflow',
      query: {
        scheduler_run_id: 'run-7',
        source_page: 'overview',
        source_run_id: 'run-7'
      }
    })
  })

  it('builds agent navigation target while omitting default tab', () => {
    expect(
      buildAgentNavigationTarget('agent-5', {
        tab: 'overview',
        context: {
          sourcePage: 'workflow',
          sourceDecisionId: 'decision-2'
        }
      })
    ).toEqual({
      path: '/agents/agent-5',
      query: {
        source_page: 'workflow',
        source_decision_id: 'decision-2'
      }
    })
  })
})
