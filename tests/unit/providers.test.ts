import { afterEach, describe, expect, test } from "bun:test";
import { buildUpstreamRequest, getProvider, listProviders, readSSE, resolveConnection, streamCompletion } from "../../src/server/providers";
import type { ProviderId } from "../../src/shared/types";

const savedEnv = { ...process.env };
afterEach(() => {
  for (const name of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "CUSTOM_API_KEY", "CUSTOM_BASE_URL"]) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

function options(id: ProviderId) {
  return { provider: getProvider(id), key: "test-secret", baseUrl: "https://example.com/v1", model: "test-model", messages: [{ role: "user" as const, content: "你好" }], system: "system", signal: new AbortController().signal };
}
function byteStream(text: string, size = 3) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  } });
}

describe("模型适配器", () => {
  test("包含所有常用服务商，公开列表不包含密钥或地址", () => {
    expect(listProviders().map((item) => item.id)).toEqual(["deepseek", "openai", "anthropic", "gemini", "qwen", "moonshot", "siliconflow", "custom"]);
    process.env.DEEPSEEK_API_KEY = "private-secret";
    expect(listProviders()[0]?.configured).toBe(true);
    expect(JSON.stringify(listProviders())).not.toContain("private-secret");
    expect(JSON.stringify(listProviders())).not.toContain("baseUrl");
  });
  test.each(["deepseek", "openai", "qwen", "moonshot", "siliconflow", "custom"] as ProviderId[])("%s 使用 OpenAI 兼容接口", (id) => {
    const request = buildUpstreamRequest(options(id));
    expect(request.url).toBe("https://example.com/v1/chat/completions");
    expect((request.init.headers as any).Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(request.init.body as string).messages[0]).toEqual({ role: "system", content: "system" });
    expect(request.init.redirect).toBe("error");
  });
  test("Claude 使用独立 system、版本头和 messages 接口", () => {
    const request = buildUpstreamRequest(options("anthropic"));
    expect(request.url).toEndWith("/messages");
    expect((request.init.headers as any)["x-api-key"]).toBe("test-secret");
    expect((request.init.headers as any)["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(request.init.body as string).system).toBe("system");
  });
  test("Gemini 不在 URL 中暴露密钥，并转换 assistant 角色", () => {
    const input = options("gemini");
    input.messages.push({ role: "assistant" as any, content: "回答" });
    const request = buildUpstreamRequest(input);
    expect(request.url).toEndWith("/models/test-model:streamGenerateContent?alt=sse");
    expect(request.url).not.toContain("test-secret");
    expect((request.init.headers as any)["x-goog-api-key"]).toBe("test-secret");
    expect(JSON.parse(request.init.body as string).contents[1].role).toBe("model");
  });
  test("浏览器不能任意修改上游地址", () => {
    process.env.CUSTOM_BASE_URL = "http://127.0.0.1:11434/v1";
    expect(() => resolveConnection("custom", "key", "http://169.254.169.254")).toThrow();
    expect(resolveConnection("custom", "key", "http://127.0.0.1:11434/v1/").baseUrl).toBe("http://127.0.0.1:11434/v1");
  });
  test("缺少密钥、地址或含凭据的 URL 时拒绝请求", () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.CUSTOM_BASE_URL;
    expect(() => resolveConnection("deepseek")).toThrow();
    expect(() => resolveConnection("custom", "key")).toThrow();
    process.env.CUSTOM_BASE_URL = "https://user:password@example.com";
    expect(() => resolveConnection("custom", "key")).toThrow();
    expect(() => resolveConnection("deepseek", "key\r\ninjected: true")).toThrow();
  });
  test("SSE 支持跨字节中文、CRLF、多行、心跳和无末尾空行", async () => {
    const events: string[] = [];
    for await (const event of readSSE(byteStream(': 心跳\r\n\r\ndata: 你好 👋\r\ndata: 第二行\r\n\r\ndata: 最后', 1))) events.push(event);
    expect(events).toEqual(["你好 👋\n第二行", "最后"]);
  });
  test.each([
    ["deepseek", { choices: [{ delta: { content: "你好" } }] }],
    ["anthropic", { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } }],
    ["gemini", { candidates: [{ content: { parts: [{ thought: true, text: "秘密思考" }, { text: "你好" }] } }] }],
  ] as const)("%s 端到端读取上游流且不泄露思维链", async (id, chunk) => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(byteStream(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`), { headers: { "Content-Type": "text/event-stream" } }) });
    try {
      const result: string[] = [];
      for await (const delta of streamCompletion({ ...options(id), baseUrl: server.url.href.replace(/\/$/, "") })) result.push(delta);
      expect(result).toEqual(["你好"]);
    } finally { server.stop(true); }
  });
  test.each([401, 403, 404, 429, 503])("HTTP %s 返回友好错误，不透传上游敏感响应", async (status) => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("secret diagnostic", { status }) });
    try {
      let caught: Error | undefined;
      try { for await (const _ of streamCompletion({ ...options("deepseek"), baseUrl: server.url.href.replace(/\/$/, "") })) {} }
      catch (error) { caught = error as Error; }
      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).not.toContain("secret");
    } finally { server.stop(true); }
  });
});
