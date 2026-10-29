import { describe, expect, test } from "bun:test";
import { createContext } from "../../src/client/lib/context";
import { validateChatRequest } from "../../src/server/app";

const turn = { user: "你好", bubbles: ["你好呀"], emotion: "happy" as const, status: "complete" };
const request = (messages: ReturnType<typeof createContext>) => ({ provider: "deepseek", model: "deepseek-chat", messages });

describe("聊天上下文", () => {
  test("只保留完整回合，维持 user / assistant 交替", () => {
    const messages = createContext([turn, { ...turn, status: "error" }, { ...turn, status: "stopped" }], "然后呢");
    expect(messages).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: '{"emotion":"happy","messages":["你好呀"]}' },
      { role: "user", content: "然后呢" },
    ]);
    expect(() => validateChatRequest(request(messages))).not.toThrow();
  });
  test("最多保留最近 18 轮，不修改原始聊天记录", () => {
    const turns = Array.from({ length: 30 }, (_, index) => ({ ...turn, user: `${index}` }));
    const messages = createContext(turns, "新消息");
    expect(messages).toHaveLength(37);
    expect(messages[0]?.content).toBe("12");
    expect(turns[0]?.user).toBe("0");
    expect(() => validateChatRequest(request(messages))).not.toThrow();
  });
  test("长回复按实际 JSON 大小裁剪，避免下一条消息超过 API 限制", () => {
    const messages = createContext([turn, { ...turn, bubbles: ["a".repeat(6000), "b".repeat(6000)] }], "继续");
    expect(messages).toEqual([{ role: "user", content: "继续" }]);
    expect(() => validateChatRequest(request(messages))).not.toThrow();
  });
  test("计入 JSON 转义开销，不只计算可见字符", () => {
    const messages = createContext(Array.from({ length: 10 }, () => ({ ...turn, bubbles: ['"\\'.repeat(1500)] })), "继续");
    expect(messages.reduce((size, message) => size + message.content.length, 0)).toBeLessThanOrEqual(18_000);
    expect(() => validateChatRequest(request(messages))).not.toThrow();
  });
});
