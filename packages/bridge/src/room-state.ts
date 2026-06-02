export const BeeperAIRoomStateEvent = {
  additionalPrompt: "com.beeper.ai.additional_prompt",
  model: "com.beeper.ai.model",
  tools: "com.beeper.ai.tools",
} as const;

export type BeeperAIRoomStateEventType = typeof BeeperAIRoomStateEvent[keyof typeof BeeperAIRoomStateEvent];

export interface BeeperAIRoomModelState {
  model: string;
  name?: string;
  reasoning?: string;
  reasoning_mode?: string;
}

export interface BeeperAIRoomPromptState {
  prompt: string;
}

export interface BeeperAIRoomToolsState {
  disabled?: string[];
  fetch?: "beeper" | "native" | "off" | string;
  search?: "beeper" | "native" | "off" | string;
}

export type BeeperAIRoomStateContent =
  | BeeperAIRoomModelState
  | BeeperAIRoomPromptState
  | BeeperAIRoomToolsState;
