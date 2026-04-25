/**
 * PromptBlock 是 prompt 树的最小内容单元。
 * 类比 AST 中的叶子节点：文本字面量、宏引用、条件语句、循环语句、JSON 数据。
 */
export type PromptBlockKind =
  | 'text'          // 纯文本
  | 'macro_ref'     // 宏变量引用 {{ ... }}
  | 'conditional'   // #if / #unless 条件块
  | 'loop'          // #each 循环块
  | 'json';         // 结构化 JSON 数据

export interface PromptBlock {
  /** 块唯一标识 */
  id: string;
  /** 块类型 */
  kind: PromptBlockKind;
  /** 渲染后的缓存纯文本（由宏展开阶段填充） */
  rendered?: string | null;
  /** 预估 token 数（由 PromptTokenizer 填充，强依附于当前 model 的编码） */
  estimated_tokens?: number;
  /** 计数时使用的编码名称（如 'cl100k_base'），用于跨模型失效判断 */
  token_encoding?: string;
  /** 类型相关的具体内容 */
  content: PromptBlockContent;
  /** 元数据（来源、诊断等） */
  metadata?: Record<string, unknown>;
}

export type PromptBlockContent =
  | { kind: 'text'; text: string }
  | { kind: 'macro_ref'; path: string; default_value?: string | null }
  | { kind: 'conditional'; predicate_path: string; children: PromptBlock[]; else_children?: PromptBlock[] }
  | { kind: 'loop'; iterator_path: string; item_alias: string; children: PromptBlock[] }
  | { kind: 'json'; value: Record<string, unknown> };
