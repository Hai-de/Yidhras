export interface TimeUnit {
  name: string;
  ratio: number; // 相对于上一级单位的进位比率
  irregular_ratios?: number[]; // 如果存在，则优先于 ratio 使用（如：每月天数不等）
}

export interface CalendarConfig {
  id: string;
  name: string;
  is_primary?: boolean;
  tick_rate: number; // 一个 tick 对应的毫秒数
  units: TimeUnit[];
}

export interface TimeFormatted {
  calendar_id: string;
  calendar_name: string;
  display: string; // 格式化后的字符串
  units: Record<string, bigint | number>; // 各级单位的数值
}
