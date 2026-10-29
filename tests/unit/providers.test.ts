import { afterEach, describe, expect, test } from "bun:test";
import { buildUpstreamRequest, getProvider, listProviders, readSSE, resolveConnection, streamCompletion } from "../../src/server/providers";

const savedEnv = { ...process.env };
afterEach(() => {
  for (const name of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"]) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});
function options() {
  return { provider: getProvider("deepseek"), key: "test-secret", baseUrl: "https://example.com/v1", model: "deepseek-chat", messages: [{ role: "user" as const, content: "你好" }], system: "system", signal: new AbortController().signal };
}
function byteStream(text: string, size = 3) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  } });
}

describe("DeepSeek 适配器", () => {
  test("仅公开 DeepSeek，不包含密钥或地址", () => {
    expect(listProviders().map((item) => item.id)).toEqual(["deepseek"]);
    process.env.DEEPSEEK_API_KEY = "private-secret";
    expect(listProviders()[0]?.configured).toBe(true);
    expect(JSON.stringify(listProviders())).not.toContain("private-secret");
    expect(JSON.stringify(listProviders())).not.toContain("baseUrl");
  });
  test.each(["openai", "anthropic", "gemini", "qwen", "moonshot", "siliconflow", "custom", "unknown"])("拒绝 %s 服务商", (id) => {
    expect(() => getProvider(id)).toThrow("不支持的模型服务商");
  });
  test("构建 DeepSeek 请求", () => {
    const request = buildUpstreamRequest(options());
    expect(request.url).toBe("https://example.com/v1/chat/completions");
    expect((request.init.headers as any).Authorization).toBe("Bearer test-secret");
    expect(JSON.parse(request.init.body as string).messages[0]).toEqual({ role: "system", content: "system" });
    expect(request.init.redirect).toBe("error");
  });
  test("浏览器不能任意修改上游地址", () => {
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    expect(() => resolveConnection("deepseek", "key", "http://169.254.169.254")).toThrow();
    expect(resolveConnection("deepseek", "key", "https://api.deepseek.com/").baseUrl).toBe("https://api.deepseek.com");
  });
  test("拒绝缺少密钥、无效密钥和含凭据的 URL", () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(() => resolveConnection("deepseek")).toThrow();
    expect(() => resolveConnection("deepseek", "key\r\ninjected: true")).toThrow();
    process.env.DEEPSEEK_BASE_URL = "https://user:password@example.com";
    expect(() => resolveConnection("deepseek", "key")).toThrow();
  });
  test("SSE 支持跨字节中文、CRLF、多行、心跳和无末尾空行", async () => {
    const events: string[] = [];
    for await (const event of readSSE(byteStream(': 心跳\r\n\r\ndata: 你好 👋\r\ndata: 第二行\r\n\r\ndata: 最后', 1))) events.push(event);
    expect(events).toEqual(["你好 👋\n第二行", "最后"]);
  });
  test("读取 DeepSeek 上游流且不泄露思维链", async () => {
    const chunk = { choices: [{ delta: { reasoning_content: "秘密思考", content: "你好" } }] };
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(byteStream(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)) });
    try {
      const result: string[] = [];
      for await (const delta of streamCompletion({ ...options(), baseUrl: server.url.href.replace(/\/$/, "") })) result.push(delta);
      expect(result).toEqual(["你好"]);
    } finally { server.stop(true); }
  });
  test.each([401, 403, 404, 429, 503])("HTTP %s 不透传上游敏感响应", async (status) => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("secret diagnostic", { status }) });
    try {
      let caught: Error | undefined;
      try { for await (const _ of streamCompletion({ ...options(), baseUrl: server.url.href.replace(/\/$/, "") })) {} }
      catch (error) { caught = error as Error; }
      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).not.toContain("secret");
    } finally { server.stop(true); }
  });
});
