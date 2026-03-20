import { AccessLevel, InformationMetadata, PermissionContext } from '../permission/types.js';
import { VariablePool, VariableValue } from './types.js';

export class NarrativeResolver {
  private variables: Record<string, { value: VariableValue; meta?: InformationMetadata }> = {};
  private readonly MAX_RECURSION_DEPTH = 10;
  
  // 非法占位符模式（如：带有特殊控制符、不完整的 {{）
  private readonly ILLEGAL_PATTERN = /\{\{[^\w.]+\}\}/g;

  constructor(initialVariables: VariablePool = {}) {
    this.updateVariables(initialVariables);
  }

  /**
   * 更新变量池，并附带元数据支持（如：权限等级）
   */
  public updateVariables(newVars: VariablePool, metadataMap: Record<string, InformationMetadata> = {}): void {
    for (const [key, value] of Object.entries(newVars)) {
      this.variables[key] = {
        value,
        meta: metadataMap[key] || { id: key, min_level: AccessLevel.PUBLIC }
      };
    }
  }

  /**
   * 解析模板
   */
  public resolve(template: string, extraContext: VariablePool = {}, permission?: PermissionContext): string {
    try {
      // 1. 预检查非法模式
      if (this.ILLEGAL_PATTERN.test(template)) {
        console.warn(`[NarrativeResolver] Illegal pattern found in template: ${template}`);
        return "[INVALID_TEMPLATE_CONTENT]";
      }

      // 2. 构造可见的变量池 (基于权限过滤)
      const visiblePool: VariablePool = {};
      for (const [key, entry] of Object.entries(this.variables)) {
        if (this.canAccess(entry.meta, permission)) {
          visiblePool[key] = entry.value;
        }
      }

      // 3. 合并额外上下文
      const finalPool = { ...visiblePool, ...extraContext };

      // 4. 执行递归解析
      return this.recursiveResolve(template, finalPool, 0);
    } catch (error) {
      console.error(`[NarrativeResolver] Critical Error during resolve:`, error);
      return "[ERROR_RECOVERED_STUB]"; // 错误拦停，返回存根
    }
  }

  /**
   * 检查 Agent 权限是否满足要求
   */
  private canAccess(meta?: InformationMetadata, permission?: PermissionContext): boolean {
    if (!meta || meta.min_level === AccessLevel.PUBLIC) return true;
    if (!permission) return false;

    // A. 基础等级达标
    if (permission.global_level >= meta.min_level) return true;

    // B. 所属特定圈子满足
    if (meta.circle_id && permission.circles.has(meta.circle_id)) return true;

    return false;
  }

  private recursiveResolve(template: string, pool: VariablePool, depth: number): string {
    if (depth >= this.MAX_RECURSION_DEPTH) {
      console.warn(`[NarrativeResolver] Max recursion depth reached.`);
      return template;
    }

    const regex = /\{\{\s*([\w.]+)\s*\}\}/g;
    let hasChanged = false;

    const resolved = template.replace(regex, (match, key) => {
      const value = this.getValueFromPool(key, pool);
      if (value !== undefined) {
        hasChanged = true;
        return String(value);
      }
      return "[RESTRICTED_OR_MISSING]"; // 权限受限或变量缺失时的安全返回
    });

    if (hasChanged && /\{\{\s*[\w.]+\s*\}\}/g.test(resolved)) {
      return this.recursiveResolve(resolved, pool, depth + 1);
    }

    return resolved;
  }

  private getValueFromPool(path: string, pool: VariablePool): unknown {
    return path
      .split('.')
      .reduce<unknown>((obj, key) => {
        if (obj && typeof obj === 'object' && key in obj) {
          return (obj as Record<string, unknown>)[key];
        }
        return undefined;
      }, pool);
  }
}
