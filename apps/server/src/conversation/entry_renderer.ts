/**
 * Renders individual ConversationEntry text using the structured parser.
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.6
 */

import { render } from '../parser/index.js';
import type { SpeakerFormatConfig, TranscriptConfig } from './format_config.js';
import type { ConversationEntry } from './types.js';

/**
 * Render a single conversation entry as text using speaker_format rules.
 * Uses the parser's render() API for template variable substitution.
 */
export function renderEntryText(
  entry: ConversationEntry,
  transcriptConfig: TranscriptConfig,
  _currentAgentId: string
): string {
  const speakerFormat: SpeakerFormatConfig = transcriptConfig.speaker_format.default;
  const prefix = render(speakerFormat.prefix, {
    speaker_id: entry.speaker_agent_id,
    turn_number: String(entry.turn_number),
    content: entry.current_content
  });
  const suffix = render(speakerFormat.suffix, {
    speaker_id: entry.speaker_agent_id,
    turn_number: String(entry.turn_number),
    content: entry.current_content
  });

  return `${prefix}${entry.current_content}${suffix}`;
}
