export enum ValueChangeReason {
  POST_ENGAGEMENT = "post_engagement",   // 高互动/转发
  FOLLOWED_BY_ELITE = "followed_by_elite", // 被高权重节点关注
  FAKE_NEWS_DETECTED = "fake_news",        // 发布虚假信息
  NOISE_FLAGGED = "noise_flagged",         // 被噪声节点大量标记
  NARRATIVE_ENDORSEMENT = "narrative_endors", // 叙事层背书
  SYSTEM_RESET = "system_reset"            // 系统重置
}

export interface NodeValueState {
  node_id: string;
  snr: number; // 信噪比 (0.0 - 1.0)
  is_pinned: boolean; // 是否被钉住（免疫贬值）
  last_updated_tick: bigint;
}

export interface ValueUpdateResult {
  node_id: string;
  old_snr: number;
  new_snr: number;
  delta: number;
  reason: ValueChangeReason;
}
