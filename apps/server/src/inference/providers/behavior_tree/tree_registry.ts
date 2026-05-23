import { btNodeDefSchema } from './schema.js';
import type { BTNodeDef, BTTreeDefinition } from './types.js';

const MAX_DEPTH = 16;

export class TreeRegistry {
  private readonly trees = new Map<string, BTNodeDef>();
  private readonly packId: string;

  constructor(packId: string) {
    this.packId = packId;
  }

  register(rawTrees: Record<string, unknown>): void {
    const parsedEntries = Object.entries(rawTrees).map(([name, rawNode]) =>
      [name, btNodeDefSchema.parse(rawNode)] as const
    );
    const previousTrees = new Map(this.trees);

    for (const [name, parsed] of parsedEntries) {
      this.trees.set(name, parsed);
    }

    try {
      for (const [name, parsed] of parsedEntries) {
        this.validateNode(parsed, name);
      }
    } catch (error) {
      this.trees.clear();
      for (const [name, tree] of previousTrees) this.trees.set(name, tree);
      throw error;
    }
  }

  get(treeName: string): BTTreeDefinition {
    const raw = this.trees.get(treeName);
    if (!raw) {
      throw new Error(`Tree "${treeName}" not found in pack "${this.packId}"`);
    }

    const visiting = new Set<string>();
    const expanded = this.expandNode(raw, treeName, 0, visiting);
    return {
      name: treeName,
      root: this.assignNodePaths(expanded, treeName),
      sourcePackId: this.packId
    };
  }

  list(): string[] {
    return Array.from(this.trees.keys());
  }

  private expandNode(
    node: BTNodeDef,
    callerTreeName: string,
    depth: number,
    visiting: Set<string>
  ): BTNodeDef {
    if (depth > MAX_DEPTH) {
      throw new Error(
        `Tree "${callerTreeName}": expanded depth exceeds maximum of ${MAX_DEPTH}. ` +
        `This may indicate unintended deep nesting or a near-circular $ref chain.`
      );
    }

    // Handle $ref
    if (node.$ref) {
      const refTarget = node.$ref;

      if (refTarget === callerTreeName) {
        throw new Error(
          `Tree "${callerTreeName}" references itself via $ref "${refTarget}". ` +
          `Self-references are not allowed.`
        );
      }

      if (visiting.has(refTarget)) {
        const chain = Array.from(visiting).concat(refTarget).join(' → ');
        throw new Error(
          `$ref cycle detected: ${chain}. Tree "${callerTreeName}" cannot reference "${refTarget}".`
        );
      }

      const targetNode = this.trees.get(refTarget);
      if (!targetNode) {
        throw new Error(
          `Tree "${callerTreeName}" references "${refTarget}" which does not exist in pack "${this.packId}".`
        );
      }

      visiting.add(callerTreeName);
      // $ref resolution does not increase depth — the reference is replaced in-place.
      // Depth increases only for structural nesting (children, child).
      const expanded = this.expandNode(targetNode, refTarget, depth, visiting);
      visiting.delete(callerTreeName);
      return expanded;
    }

    // Recursively expand children
    const expanded: BTNodeDef = { ...node };

    if (node.children) {
      expanded.children = node.children.map((child) =>
        this.expandNode(child, callerTreeName, depth + 1, visiting)
      );
    }

    if (node.child) {
      expanded.child = this.expandNode(node.child, callerTreeName, depth + 1, visiting);
    }

    return expanded;
  }

  private assignNodePaths(node: BTNodeDef, path: string): BTNodeDef {
    const withPath: BTNodeDef = {
      ...node,
      __node_path: path
    };

    if (node.children) {
      withPath.children = node.children.map((child, index) =>
        this.assignNodePaths(child, `${path}.children[${index}]`)
      );
    }

    if (node.child) {
      withPath.child = this.assignNodePaths(node.child, `${path}.child`);
    }

    return withPath;
  }

  private readonly SUPPORTED_TYPES = ['selector', 'sequence', 'condition', 'action'];

  private validateNode(node: BTNodeDef, treeName: string): void {
    if (!node.type && !node.$ref && !node.decorators) {
      throw new Error(
        `Tree "${treeName}": root node must have a "type" (selector, sequence, condition, action, llm_decision) or "$ref".`
      );
    }
    if (node.type === 'llm_decision') {
      throw new Error(
        `Tree "${treeName}": llm_decision nodes are not supported until AI Gateway wiring is implemented. ` +
        `Use a deterministic action node or remove this branch.`
      );
    }
    if (node.type && !this.SUPPORTED_TYPES.includes(node.type)) {
      throw new Error(
        `Tree "${treeName}": unsupported node type "${node.type}". Supported types: ${this.SUPPORTED_TYPES.join(', ')}.`
      );
    }
    this.validateNoParallel(node, treeName);
    this.validateSequenceActions(node, treeName);
  }

  private validateNoParallel(node: BTNodeDef, treeName: string): void {
    const nodeType = node.type as string | undefined;
    if (nodeType === 'parallel') {
      throw new Error(
        `Tree "${treeName}": Parallel nodes are not supported in this version.`
      );
    }

    if (node.children) {
      for (const child of node.children) {
        this.validateNoParallel(child, treeName);
      }
    }
    if (node.child) {
      this.validateNoParallel(node.child, treeName);
    }
  }

  private validateSequenceActions(node: BTNodeDef, treeName: string): void {
    this.validateSequenceActionsInNode(node, treeName);
  }

  private validateSequenceActionsInNode(node: BTNodeDef, treeName: string): void {
    if (node.type === 'sequence' && node.children) {
      const actionCount = this.countDecisionLeaves(node, treeName, new Set<string>());
      if (actionCount > 1) {
        throw new Error(
          `Tree "${treeName}": Sequence nodes may have at most one action or llm_decision leaf. ` +
          `Found ${actionCount} after expanding decorators and $ref nodes. ` +
          `Move additional actions to separate tick decisions or use a Selector outside this Sequence.`
        );
      }
    }

    if (node.children) {
      for (const child of node.children) {
        this.validateSequenceActionsInNode(child, treeName);
      }
    }
    if (node.child) {
      this.validateSequenceActionsInNode(node.child, treeName);
    }
  }

  private countDecisionLeaves(node: BTNodeDef, treeName: string, visiting: Set<string>): number {
    if (node.$ref) {
      const refTarget = node.$ref;

      if (refTarget === treeName) {
        throw new Error(
          `Tree "${treeName}" references itself via $ref "${refTarget}". ` +
          `Self-references are not allowed.`
        );
      }

      if (visiting.has(refTarget)) {
        const chain = Array.from(visiting).concat(refTarget).join(' → ');
        throw new Error(
          `$ref cycle detected while validating Sequence actions: ${chain}. ` +
          `Tree "${treeName}" cannot reference "${refTarget}".`
        );
      }

      const targetNode = this.trees.get(refTarget);
      if (!targetNode) {
        throw new Error(
          `Tree "${treeName}" references "${refTarget}" which does not exist in pack "${this.packId}".`
        );
      }

      visiting.add(refTarget);
      const count = this.countDecisionLeaves(targetNode, treeName, visiting);
      visiting.delete(refTarget);
      return count;
    }

    let count = this.isDecisionLeaf(node) ? 1 : 0;

    if (node.children) {
      for (const child of node.children) {
        count += this.countDecisionLeaves(child, treeName, visiting);
      }
    }

    if (node.child) {
      count += this.countDecisionLeaves(node.child, treeName, visiting);
    }

    return count;
  }

  private isDecisionLeaf(node: BTNodeDef): boolean {
    if (node.type === 'action' || node.type === 'llm_decision') return true;
    if (node.action) return true;
    if (node.prompt_template) return true;
    return false;
  }
}
