import { describe, expect, test } from "bun:test";
import { parseReply, ReplyDecoder } from "../../src/server/reply";
import type { AssistantReply, ChatEvent } from "../../src/shared/types";

const reply: AssistantReply = { emotion: "happy", messages: ['别急，"慢慢来"。\n你好 👋 \\ ', "我们一句一句聊。"] };

describe("聊天回复协议", () => {
  test("解析 JSON 并去掉消息首尾空白", () => {
    expect(parseReply(JSON.stringify(reply))).toEqual({ ...reply, messages: reply.messages.map((text) => text.trim()) });
  });
  test("容忍模型多加的 JSON 代码围栏", () => {
    expect(parseReply('```json\n{"emotion":"neutral","messages":["你好"]}\n```').messages).toEqual(["你好"]);
  });
  test.each([
    "普通长段文字", '{"emotion":"angry","messages":["你好"]}', '{"emotion":"happy","messages":[]}',
    '{"emotion":"happy","messages":[""]}', '{"emotion":"happy","messages":[1]}',
    '{"emotion":"happy","messages":["1","2","3","4"]}', 'null',
  ])("拒绝不符合协议的内容：%s", (raw) => expect(() => parseReply(raw)).toThrow());
  test("逐字符流式解析，包括转义引号、反斜杠和 emoji", () => {
    const decoder = new ReplyDecoder();
    const events: ChatEvent[] = [];
    for (const char of JSON.stringify(reply)) events.push(...decoder.push(char));
    events.push(...decoder.finish());
    expect(events).toEqual([
      { type: "emotion", emotion: "happy" },
      ...reply.messages.map((text, index) => ({ type: "message" as const, text: text.trim(), index })),
    ]);
  });
  test("在每一种网络分片位置都不丢失或重复消息", () => {
    const raw = JSON.stringify(reply);
    for (let i = 0; i < raw.length; i++) {
      const decoder = new ReplyDecoder();
      const events = [...decoder.push(raw.slice(0, i)), ...decoder.push(raw.slice(i)), ...decoder.finish()];
      expect(events.filter((event) => event.type === "message")).toHaveLength(2);
      expect(events.filter((event) => event.type === "emotion")).toHaveLength(1);
    }
  });
  test("绝不把尚未闭合的字符串显示为消息", () => {
    const decoder = new ReplyDecoder();
    expect(decoder.push('{"emotion":"thinking","messages":["还没')).toEqual([{ type: "emotion", emotion: "thinking" }]);
    expect(() => decoder.finish()).toThrow();
  });
  test("字段顺序异常时安全地等到完整 JSON 再输出", () => {
    const decoder = new ReplyDecoder();
    expect(decoder.push('{"messages":["你好"],"emotion":"happy"}')).toEqual([]);
    expect(decoder.finish()).toEqual([{ type: "emotion", emotion: "happy" }, { type: "message", text: "你好", index: 0 }]);
  });
  test("限制模型输出大小", () => expect(() => new ReplyDecoder().push("a".repeat(64_001))).toThrow());
});
