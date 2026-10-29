import type { ChatMessage, Protocol, ProviderId, ProviderInfo } from "../shared/types";

interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  models: string[];
  protocol: Protocol;
  baseUrl: string;
  envPrefix: string;
}

export const PROVIDERS: ProviderDefinition[] = [
  { id: "deepseek", name: "DeepSeek", description: "深度求索", models: ["deepseek-chat", "deepseek-reasoner"], protocol: "openai", baseUrl: "https://api.deepseek.com", envPrefix: "DEEPSEEK" },
  { id: "openai", name: "OpenAI", description: "GPT 系列", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o"], protocol: "openai", baseUrl: "https://api.openai.com/v1", envPrefix: "OPENAI" },
  { id: "anthropic", name: "Claude", description: "Anthropic", models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"], protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", envPrefix: "ANTHROPIC" },
  { id: "gemini", name: "Gemini", description: "Google", models: ["gemini-2.5-flash", "gemini-2.5-pro"], protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", envPrefix: "GEMINI" },
  { id: "qwen", name: "通义千问", description: "阿里云百炼", models: ["qwen-plus", "qwen-turbo", "qwen-max"], protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", envPrefix: "QWEN" },
  { id: "moonshot", name: "Kimi", description: "月之暗面", models: ["moonshot-v1-8k", "moonshot-v1-32k"], protocol: "openai", baseUrl: "https://api.moonshot.cn/v1", envPrefix: "MOONSHOT" },
  { id: "siliconflow", name: "硅基流动", description: "开源模型平台", models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", envPrefix: "SILICONFLOW" },
  { id: "custom", name: "自定义接口", description: "OpenAI 兼容协议", models: [], protocol: "openai", baseUrl: "", envPrefix: "CUSTOM" },
];

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function getProvider(id: string): ProviderDefinition {
  const provider = PROVIDERS.find((item) => item.id === id);
  if (!provider) throw new ApiError(400, "不支持的模型服务商。");
  return provider;
}

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map(({ id, name, description, models, envPrefix }) => ({
    id, name, description,
    models: process.env[`${envPrefix}_MODEL`]
      ? [...new Set([process.env[`${envPrefix}_MODEL`]!, ...models])]
      : models,
    configured: Boolean(process.env[`${envPrefix}_API_KEY`]),
  }));
}

// Only administrator-controlled environment variables may change upstream hosts.
// Browser-supplied custom hosts must match CUSTOM_BASE_URL exactly (SSRF protection).
export function resolveConnection(id: ProviderId, suppliedKey?: string, suppliedBaseUrl?: string) {
  const provider = getProvider(id);
  const key = suppliedKey?.trim() || process.env[`${provider.envPrefix}_API_KEY`]?.trim();
  if (!key) throw new ApiError(400, `请先配置 ${provider.name} 的 API Key，或切换到演示模式。`);
  if (key.length > 4096 || /[\r\n]/.test(key)) throw new ApiError(400, "API Key 格式不正确。");
  const configuredUrl = process.env[`${provider.envPrefix}_BASE_URL`]?.trim() || provider.baseUrl;
  if (!configuredUrl) throw new ApiError(400, "请先在 .env 中配置 CUSTOM_BASE_URL，再使用自定义接口。");
  if (suppliedBaseUrl && suppliedBaseUrl.replace(/\/+$/, "") !== configuredUrl.replace(/\/+$/, "")) {
    throw new ApiError(400, "接口地址需要由服务端 .env 的 CUSTOM_BASE_URL 配置。");
  }
  let url: URL;
  try { url = new URL(configuredUrl); } catch { throw new ApiError(400, "服务端接口地址无效。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "接口地址必须是没有凭据、查询参数的 HTTP(S) URL。");
  }
  return { provider, key, baseUrl: url.href.replace(/\/+$/, "") };
}

export interface UpstreamOptions {
  provider: ProviderDefinition;
  key: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  system: string;
  signal: AbortSignal;
}

export function buildUpstreamRequest(options: UpstreamOptions): { url: string; init: RequestInit } {
  const { provider, key, baseUrl, model, messages, system, signal } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
  let url: string;
  let body: unknown;
  if (provider.protocol === "anthropic") {
    url = `${baseUrl}/messages`;
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    body = { model, system, messages, stream: true, max_tokens: 2048 };
  } else if (provider.protocol === "gemini") {
    url = `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    headers["x-goog-api-key"] = key;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
    };
  } else {
    url = `${baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      messages: [{ role: "system", content: system }, ...messages],
      stream: true,
      ...(provider.id === "qwen" ? { enable_thinking: false } : {}),
      // Compatible endpoints differ in JSON-mode support. The system prompt enforces
      // our JSON contract instead of relying on an optional provider-specific flag.
    };
  }
  return { url, init: { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" } };
}

export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function extract(frame: string) {
    return frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize CRLF without losing a CR split across network chunks.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extract(frame);
        if (data) yield data;
      }
      if (buffer.length > 256_000) throw new ApiError(502, "模型返回的数据片段过大。");
      if (done) {
        const data = extract(buffer);
        if (data) yield data;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* streamCompletion(options: UpstreamOptions): AsyncGenerator<string> {
  const { url, init } = buildUpstreamRequest(options);
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) {
    if (options.signal.aborted) throw error;
    throw new ApiError(502, "暂时连接不上模型服务，请检查网络或服务端接口地址。");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    if (status === 401 || status === 403) throw new ApiError(401, "API Key 无效或没有该模型的访问权限。");
    if (status === 429) throw new ApiError(429, "模型请求过于频繁或额度不足，请稍后再试。");
    if (status === 404) throw new ApiError(400, "没有找到该模型，请检查模型名称和接口地址。");
    throw new ApiError(502, `模型服务暂时不可用（HTTP ${status}），请稍后再试。`);
  }
  if (!response.body) throw new ApiError(502, "模型没有返回内容。");
  for await (const data of readSSE(response.body)) {
    if (data === "[DONE]") break;
    let chunk: any;
    try { chunk = JSON.parse(data); } catch { throw new ApiError(502, "模型返回了无法识别的数据。"); }
    if (chunk.error || chunk.type === "error") throw new ApiError(502, "模型生成时发生错误，请稍后重试。");
    let text: unknown;
    if (options.provider.protocol === "anthropic") {
      text = chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" ? chunk.delta.text : undefined;
    } else if (options.provider.protocol === "gemini") {
      const candidate = chunk.candidates?.[0];
      if (chunk.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "PROHIBITED_CONTENT"].includes(candidate?.finishReason)) {
        throw new ApiError(502, "模型未能回答这条消息，请换一种表达再试。");
      }
      text = candidate?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text ?? "").join("");
    } else {
      text = chunk.choices?.[0]?.delta?.content;
      // Reasoning-only deltas are intentionally not exposed as conversation text.
    }
    if (typeof text === "string" && text) yield text;
  }
}
