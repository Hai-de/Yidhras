/**
 * Profile resolver — determines which PromptWorkflowProfile to use for a conversation turn.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §3.1
 */

import type { AgentConversationMemory } from './types.js';

export type ProfileResolverContext = {
  worldStateChanged: boolean;
  agentRequestedProfile?: string;
};

export type ProfileResolver = (
  memory: AgentConversationMemory,
  ctx: ProfileResolverContext
) => string;

/**
 * Default implementation: pick 'chat-first-turn' if the agent has no entries yet,
 * otherwise use the lightweight 'chat-follow-up' path.
 * Future: accept worldStateChanged / agentRequestedProfile to switch back to full tracks.
 */
export const defaultProfileResolver: ProfileResolver = (memory, _ctx) =>
  memory.entries.length === 0 ? 'chat-first-turn' : 'chat-follow-up';
