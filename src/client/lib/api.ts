import { EMOTIONS, type ChatEvent, type ChatRequest, type ProviderInfo } from "../../shared/types";

export async function loadProviders(signal: AbortSignal): Promise<ProviderInfo[]> {
  const response = await fetch("/api/providers", { signal });
  if (!response.ok) throw new Error("模型服务暂时连接不上，演示模式仍然可以使用。");
  const data = await response.json();
  return data.providers;
}

function parseEvent(raw: string): ChatEvent {
  let event: any;
  try { event = JSON.parse(raw); } catch { throw new Error("回复数据格式异常，请重试。"); }
  if (event?.type === "done") return { type: "done" };
  if (event?.type === "error" && typeof event.message === "string") return event;
  if (event?.type === "emotion" && EMOTIONS.includes(event.emotion)) return event;
  if (event?.type === "message" && typeof event.text === "string" && Number.isInteger(event.index)) return event;
  throw new Error("回复数据格式异常，请重试。");
}

export async function requestChat(input: ChatRequest, signal: AbortSignal, onEvent: (event: ChatEvent) => void): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input), signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求没有成功（${response.status}），请稍后再试。`);
  }
  if (!response.body) throw new Error("没有收到模型回复，请再试一次。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event = parseEvent(data);
        if (event.type === "error") throw new Error(event.message);
        onEvent(event);
        if (event.type === "done") completed = true;
      }
      if (buffer.length > 128_000) throw new Error("回复数据过大，请重新开始对话。");
      if (done) break;
    }
    if (!completed) throw new Error("连接中断了，这次回复没有完成。可以点击重试。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
