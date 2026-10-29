export const EMOTIONS = ["neutral", "happy", "excited", "curious", "thinking", "sympathetic", "surprised"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type FaceState = "idle" | "thinking" | "speaking";
export type ProviderId = "deepseek" | "openai" | "anthropic" | "gemini" | "qwen" | "moonshot" | "siliconflow" | "custom";
export type Protocol = "openai" | "anthropic" | "gemini";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  models: string[];
  configured: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  apiKey?: string;
  baseUrl?: string;
}

export interface AssistantReply {
  emotion: Emotion;
  messages: string[];
}

export type ChatEvent =
  | { type: "emotion"; emotion: Emotion }
  | { type: "message"; text: string; index: number }
  | { type: "done" }
  | { type: "error"; message: string };

export const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: "在听你说",
  happy: "有点开心",
  excited: "好期待呀",
  curious: "有点好奇",
  thinking: "认真想想",
  sympathetic: "陪在你这边",
  surprised: "哇，真的吗",
};
