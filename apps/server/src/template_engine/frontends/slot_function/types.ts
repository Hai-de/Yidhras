export interface SlotRegistration {
  content: string;
  enabled: boolean;
}

export type SlotRegistry = Record<string, SlotRegistration>;

export interface SlotFunctionContext {
  slots: SlotRegistry;
}
