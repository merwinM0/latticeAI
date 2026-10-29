import systemPrompt from "../../prompts/companion.md" with { type: "text" };
import type { ChatEvent, ChatMessage, ChatRequest } from "../shared/types";
import { ApiError, getProvider, listProviders, resolveConnection, streamCompletion } from "./providers";
import { ReplyDecoder } from "./reply";

const MAX_BODY_BYTES = 64_000;
const activeRequests = new Map<string, number>();
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export function validateChatRequest(data: unknown): ChatRequest {
  if (!data || typeof data !== "object") throw new ApiError(400, "请求内容不正确。");
  const input = data as Record<string, unknown>;
  if (typeof input.provider !== "string") throw new ApiError(400, "请选择一个模型服务商。");
  const provider = getProvider(input.provider);
  if (typeof input.model !== "string" || !input.model.trim() || input.model.length > 200 || /[\r\n]/.test(input.model)) {
    throw new ApiError(400, "请填写有效的模型名称。");
  }
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 40) {
    throw new ApiError(400, "聊天记录需要包含 1–40 条消息。");
  }
  let total = 0;
  const messages: ChatMessage[] = input.messages.map((message: unknown) => {
    if (!message || typeof message !== "object") throw new ApiError(400, "聊天记录格式不正确。");
    const item = message as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim() || item.content.length > 10_000) {
      throw new ApiError(400, "消息不能为空，且每条不能超过 10000 字。");
    }
    total += item.content.length;
    return { role: item.role, content: item.content };
  });
  if (total > 24_000) throw new ApiError(400, "这段聊天太长了，开一个新对话吧。");
  if (messages[0]?.role !== "user" || messages.at(-1)?.role !== "user" || messages.some((message, index) => message.role === messages[index - 1]?.role)) {
    throw new ApiError(400, "聊天记录应由用户开始、交替发言，并以用户消息结尾。");
  }
  for (const key of ["apiKey", "baseUrl"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || input[key].length > 4096)) {
      throw new ApiError(400, "接口配置格式不正确。");
    }
  }
  return { provider: provider.id, model: input.model.trim(), messages, apiKey: input.apiKey as string | undefined, baseUrl: input.baseUrl as string | undefined };
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const configuredOrigin = process.env.APP_ORIGIN;
  // Pin default hosts as well as Origin, so DNS rebinding cannot expose local keys.
  if (!configuredOrigin && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new ApiError(403, "非本机访问需要在服务端配置 APP_ORIGIN。");
  }
  const allowed = configuredOrigin || url.origin;
  if ((origin && origin !== allowed) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "不允许从其他站点调用此接口。");
  }
}

function chatStream(input: ChatRequest, request: Request): Response {
  const connection = resolveConnection(input.provider, input.apiKey, input.baseUrl);
  // Local, single-user app: bound concurrency per service to avoid accidental spend.
  if ((activeRequests.get(input.provider) ?? 0) >= 3) throw new ApiError(429, "正在处理的请求较多，请稍等一下。");
  activeRequests.set(input.provider, (activeRequests.get(input.provider) ?? 0) + 1);
  const abort = new AbortController();
  let timedOut = false;
  let closed = false;
  const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 90_000);
  const onDisconnect = () => abort.abort();
  request.signal.addEventListener("abort", onDisconnect, { once: true });
  if (request.signal.aborted) abort.abort();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => {
        if (!closed && !request.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!closed && !request.signal.aborted) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
      try {
        const decoder = new ReplyDecoder();
        for await (const delta of streamCompletion({ ...connection, model: input.model, messages: input.messages, system: systemPrompt, signal: abort.signal })) {
          for (const event of decoder.push(delta)) send(event);
        }
        for (const event of decoder.finish()) send(event);
        send({ type: "done" });
      } catch (error) {
        if (!abort.signal.aborted || timedOut) {
          send({ type: "error", message: timedOut ? "模型想得有点久，已超时。请重试或选择更快的模型。" : error instanceof ApiError ? error.message : "这次回复没能完成，请稍后再试。" });
        }
      } finally {
        closed = true;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onDisconnect);
        const remaining = (activeRequests.get(input.provider) ?? 1) - 1;
        if (remaining > 0) activeRequests.set(input.provider, remaining);
        else activeRequests.delete(input.provider);
        try { controller.close(); } catch { /* The browser may already have cancelled. */ }
      }
    },
    cancel() { closed = true; abort.abort(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function handleApiRequest(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const path = new URL(request.url).pathname;
    if (path === "/api/providers") {
      if (request.method !== "GET") return json({ error: "请使用 GET 请求。" }, 405);
      return json({ providers: listProviders() });
    }
    if (path !== "/api/chat") return json({ error: "接口不存在。" }, 404);
    if (request.method !== "POST") return json({ error: "请使用 POST 请求。" }, 405);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "请发送 JSON 格式的请求。");
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new ApiError(413, "请求内容太大了。");
    // Bound the actual bytes, not only Content-Length (which is optional).
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "请求内容不能为空。");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, "请求内容太大了。"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const buffer = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    let data: unknown;
    try { data = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { throw new ApiError(400, "JSON 格式不正确。"); }
    return chatStream(validateChatRequest(data), request);
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "服务暂时遇到问题，请稍后再试。" }, error instanceof ApiError ? error.status : 500);
  }
}
