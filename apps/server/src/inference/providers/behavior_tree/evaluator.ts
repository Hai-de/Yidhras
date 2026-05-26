import type { ProviderDecisionRaw } from '../../types.js';
import { tickAction, tickCondition, tickLLMDecision } from './nodes/leaves.js';
import type { BTDecisionTrace, BTEvalContext, BTNodeDef, BTNodeTrace,BTStatus } from './types.js';

export async function tick(node: BTNodeDef, ctx: BTEvalContext): Promise<BTStatus> {
  if (node.$ref) {
    return 'failure';
  }

  if (node.decorators && node.child) {
    const { tickDecorated } = await import('./nodes/decorators.js');
    return tickDecorated(node.decorators, node.child, ctx);
  }

  if (node.type === 'selector' && node.children) {
    const { tickSelector } = await import('./nodes/composites.js');
    return tickSelector(node.children, ctx);
  }

  if (node.type === 'sequence' && node.children) {
    const { tickSequence } = await import('./nodes/composites.js');
    return tickSequence(node.children, ctx);
  }

  // Guarded action: node has both condition and action — evaluate condition first
  if (node.condition && node.action) {
    const condStatus = tickCondition(node.condition, ctx);
    if (condStatus !== 'success') return condStatus;
    return tickAction(node.action, ctx);
  }

  // Unguarded action: node has action without condition or explicit type
  if (node.action && !node.condition && !node.type) {
    return tickAction(node.action, ctx);
  }

  if (node.type === 'condition') {
    return tickCondition(node.condition, ctx);
  }

  if (node.type === 'action' && node.action) {
    return tickAction(node.action, ctx);
  }

  if (node.type === 'llm_decision' && node.prompt_template) {
    const llmDef = {
      prompt_template: node.prompt_template,
      provider: node.provider ?? 'openai_compatible',
      model: node.model ?? 'unknown'
    };
    return tickLLMDecision(llmDef, ctx);
  }

  return 'failure';
}

function getNodeType(node: BTNodeDef): string {
  if (node.$ref) return '$ref';
  if (node.decorators) return `decorated(${node.decorators.map((d) => d.type).join(',')})`;
  return node.type ?? 'unknown';
}

async function tickWithTrace(
  node: BTNodeDef,
  ctx: BTEvalContext,
  nodePath: string,
  traces: BTNodeTrace[]
): Promise<BTStatus> {
  const nodeType = getNodeType(node);
  const startMs = Date.now();
  let status: BTStatus | 'skipped' = 'failure';

  try {
    status = await tick(node, ctx);
    return status;
  } finally {
    const durationMs = Date.now() - startMs;
    traces.push({
      nodePath,
      nodeType,
      status,
      durationMs,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      discardedDecision: node.type === 'action' ? (ctx.blackboard['__last_decision'] as ProviderDecisionRaw | undefined) ?? null : null
    });
  }
}

export async function evaluateTree(
  treeName: string,
  root: BTNodeDef,
  ctx: BTEvalContext
): Promise<{ decision: ProviderDecisionRaw | null; trace: BTDecisionTrace }> {
  const traces: BTNodeTrace[] = [];
  const agentId = ctx.inferenceContext.actor_ref.agent_id ?? 'unknown';
  const simTick = ctx.inferenceContext.tick;

  ctx.blackboard['__last_decision'] = null;
  ctx.blackboard['__tree_name'] = treeName;
  if (!ctx.blackboard['__agent_id']) {
    ctx.blackboard['__agent_id'] = agentId;
  }

  try {
    await tickWithTrace(root, ctx, treeName, traces);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const finalDecision = (ctx.blackboard['__last_decision'] as ProviderDecisionRaw | null) ?? null;

    return {
      decision: finalDecision,
      trace: {
        agentId,
        treeName,
        simTick,
        nodeTraces: traces,
        finalDecision
      }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the error — in production this goes through the logger
    console.error(`[behavior_tree] Evaluation error in tree "${treeName}" for agent "${agentId}": ${message}`);

    return {
      decision: null,
      trace: {
        agentId,
        treeName,
        simTick,
        nodeTraces: traces,
        finalDecision: null
      }
    };
  }
}
