import { EMOTIONS, type AssistantReply, type ChatEvent, type Emotion } from "../shared/types";
import { ApiError } from "./providers";

function jsonSource(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function readString(source: string, start: number): { value: string; end: number } | null {
  if (source[start] !== '"') return null;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === '"') {
      try { return { value: JSON.parse(source.slice(start, i + 1)), end: i + 1 }; }
      catch { return null; }
    }
  }
  return null;
}

export function parseReply(raw: string): AssistantReply {
  let data: any;
  try { data = JSON.parse(jsonSource(raw)); }
  catch { throw new ApiError(502, "模型没有按约定返回聊天内容，请重试或更换模型。"); }
  if (!data || !EMOTIONS.includes(data.emotion) || !Array.isArray(data.messages)
    || data.messages.length < 1 || data.messages.length > 3
    || data.messages.some((text: unknown) => typeof text !== "string" || !text.trim() || text.length > 8000)) {
    throw new ApiError(502, "模型返回的聊天格式不正确，请重试。");
  }
  return { emotion: data.emotion, messages: data.messages.map((text: string) => text.trim()) };
}

/** Emit only complete JSON string values; never render raw JSON or partial escapes. */
export class ReplyDecoder {
  private raw = "";
  private emotionSent = false;
  private sent: string[] = [];

  push(delta: string): ChatEvent[] {
    this.raw += delta;
    if (this.raw.length > 64_000) throw new ApiError(502, "这次回复太长了，请试着缩小问题范围。");
    const source = jsonSource(this.raw);
    const prefix = /^\{\s*"emotion"\s*:\s*/.exec(source);
    if (!prefix) return [];
    const emotion = readString(source, prefix[0].length);
    if (!emotion || !EMOTIONS.includes(emotion.value as Emotion)) return [];
    const events: ChatEvent[] = [];
    if (!this.emotionSent) {
      events.push({ type: "emotion", emotion: emotion.value as Emotion });
      this.emotionSent = true;
    }
    const arrayStart = /^\s*,\s*"messages"\s*:\s*\[\s*/.exec(source.slice(emotion.end));
    if (!arrayStart) return events;
    let position = emotion.end + arrayStart[0].length;
    for (let index = 0; index < 3; index++) {
      const message = readString(source, position);
      if (!message) break;
      const text = message.value.trim();
      if (index >= this.sent.length && text && text.length <= 8000) {
        this.sent.push(text);
        events.push({ type: "message", text, index });
      }
      const separator = /^\s*,\s*/.exec(source.slice(message.end));
      if (!separator) break;
      position = message.end + separator[0].length;
    }
    return events;
  }

  finish(): ChatEvent[] {
    const reply = parseReply(this.raw);
    if (this.sent.some((text, index) => text !== reply.messages[index])) {
      throw new ApiError(502, "模型返回的消息不一致，请重试。");
    }
    const events: ChatEvent[] = [];
    if (!this.emotionSent) events.push({ type: "emotion", emotion: reply.emotion });
    reply.messages.forEach((text, index) => {
      if (index >= this.sent.length) events.push({ type: "message", text, index });
    });
    return events;
  }
}
