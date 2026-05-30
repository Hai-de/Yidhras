export type { CalendarConfig, TimeUnit } from '../packs/schema/constitution_schema.js';

export interface TimeFormatted {
  calendar_id: string;
  calendar_name: string;
  display: string; // 格式化后的字符串
  units: Record<string, bigint | number>; // 各级单位的数值
}
