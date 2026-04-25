import type { PromptBlock } from './prompt_block.js';
import type { PromptFragmentV2 } from './prompt_fragment_v2.js';
import type { PromptSlotConfig } from './prompt_slot_config.js';
import type { PromptWorkflowMetadata } from './types.js';

export interface PromptTree {
  inference_id: string;
  task_type: string;
  fragments_by_slot: Record<string, PromptFragmentV2[]>;
  slot_registry: Record<string, PromptSlotConfig>;
  metadata: PromptTreeMetadata;
}

export interface PromptTreeMetadata {
  prompt_version: string;
  profile_id: string | null;
  profile_version: string | null;
  source_prompt_keys: string[];
  workflow?: PromptWorkflowMetadata;
  processing_trace?: unknown;
}

export function walkPromptBlocks(
  fragments: PromptFragmentV2[],
  visitor: (block: PromptBlock, ancestors: Array<PromptFragmentV2 | PromptBlock>) => void
): void {
  for (const fragment of fragments) {
    if (fragment.permission_denied) {
      continue;
    }
    walkFragmentChildren(fragment, [fragment], visitor);
  }
}

function walkFragmentChildren(
  fragment: PromptFragmentV2,
  ancestors: Array<PromptFragmentV2 | PromptBlock>,
  visitor: (block: PromptBlock, ancestors: Array<PromptFragmentV2 | PromptBlock>) => void
): void {
  for (const child of fragment.children) {
    if ('kind' in child) {
      const block = child as PromptBlock;
      visitor(block, [...ancestors, block]);
      if (block.kind === 'conditional' || block.kind === 'loop') {
        const nested = (block.content as { children?: PromptBlock[] }).children;
        if (nested) {
          for (const nestedBlock of nested) {
            visitor(nestedBlock, [...ancestors, block, nestedBlock]);
          }
        }
      }
    } else {
      const childFrag = child as PromptFragmentV2;
      if (childFrag.permission_denied) {
        continue;
      }
      walkFragmentChildren(childFrag, [...ancestors, child], visitor);
    }
  }
}

export function renderSlotText(
  fragmentsBySlot: Record<string, PromptFragmentV2[]>,
  slotId: string
): string {
  const fragments = fragmentsBySlot[slotId] ?? [];
  const lines: string[] = [];
  walkPromptBlocks(fragments, (block) => {
    if (block.rendered) {
      lines.push(block.rendered);
    }
  });
  return lines.join('\n');
}

export async function walkPromptBlocksAsync(
  fragments: PromptFragmentV2[],
  visitor: (block: PromptBlock, ancestors: Array<PromptFragmentV2 | PromptBlock>) => Promise<void>
): Promise<void> {
  for (const fragment of fragments) {
    if (fragment.permission_denied) {
      continue;
    }
    await walkFragmentChildrenAsync(fragment, [fragment], visitor);
  }
}

async function walkFragmentChildrenAsync(
  fragment: PromptFragmentV2,
  ancestors: Array<PromptFragmentV2 | PromptBlock>,
  visitor: (block: PromptBlock, ancestors: Array<PromptFragmentV2 | PromptBlock>) => Promise<void>
): Promise<void> {
  for (const child of fragment.children) {
    if ('kind' in child) {
      const block = child as PromptBlock;
      await visitor(block, [...ancestors, block]);
      if (block.kind === 'conditional' || block.kind === 'loop') {
        const nested = (block.content as { children?: PromptBlock[] }).children;
        if (nested) {
          for (const nestedBlock of nested) {
            await visitor(nestedBlock, [...ancestors, block, nestedBlock]);
          }
        }
      }
    } else {
      const childFrag = child as PromptFragmentV2;
      if (childFrag.permission_denied) {
        continue;
      }
      await walkFragmentChildrenAsync(childFrag, [...ancestors, child], visitor);
    }
  }
}
