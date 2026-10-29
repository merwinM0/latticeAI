import { describe, expect, test } from "bun:test";
import { createSceneLayout, placeReplies, replyLifetime } from "../../src/client/lib/scene-layout";

const views = [[320, 640], [390, 844], [390, 500], [768, 768], [1024, 900], [1440, 1000], [2560, 1440]] as const;

describe("粒子场景与浮现回答", () => {
  test("同一条回答打字时位置不抖动，不同 ID 会改变位置", () => {
    const layout = createSceneLayout(1440, 1000);
    const source = [{ id: "turn-one", text: "慢慢聊。" }];
    expect(placeReplies(layout, source)).toEqual(placeReplies(layout, source));
    expect(placeReplies(layout, [{ ...source[0]!, id: "turn-two" }])).not.toEqual(placeReplies(layout, source));
  });
  for (const [width, height] of views) {
    test(`${width}×${height}：位置在视口和输入栏之上，不遮挡表情`, () => {
      const layout = createSceneLayout(width, height, height - 88);
      const radius = layout.diameter * 0.54 + 16;
      for (let round = 0; round < 30; round++) {
        const replies = [{ id: `${round}-a`, text: "这是一条很短的回复。" }, { id: `${round}-b`, text: "不用急，我在听你说。" }];
        const placements = placeReplies(layout, replies);
        for (const placement of placements) {
          expect(placement.x).toBeGreaterThanOrEqual(layout.margin);
          expect(placement.x + placement.width).toBeLessThanOrEqual(width - layout.margin + 0.1);
          expect(placement.y).toBeGreaterThanOrEqual(layout.margin);
          expect(placement.y + 38).toBeLessThanOrEqual(layout.safeBottom + 0.1);
          const above = placement.y + 38 <= layout.faceY - radius;
          const below = placement.y >= layout.faceY + radius;
          const left = placement.x + placement.width <= layout.faceX - radius;
          const right = placement.x >= layout.faceX + radius;
          expect(above || below || left || right).toBe(true);
        }
      }
    });
  }
  test("平板短视口为上下两条回复保留空间，不把文字挤在同一区域", () => {
    const layout = createSceneLayout(768, 768, 664);
    for (let seed = 0; seed < 30; seed++) {
      const [a, b] = placeReplies(layout, [
        { id: `${seed}-first`, text: "这是第一条需要一点空间来阅读的回答。" },
        { id: `${seed}-second`, text: "这是第二条同样需要两行显示的回答。" },
      ]);
      expect(a!.y + 68 <= b!.y || b!.y + 68 <= a!.y).toBe(true);
    }
  });
  test("长文本保留更久，超长回答限制最大停留时间", () => {
    expect(replyLifetime("你好")).toBe(6000);
    expect(replyLifetime("字".repeat(100))).toBeGreaterThan(replyLifetime("你好"));
    expect(replyLifetime("字".repeat(8000))).toBe(45_000);
  });
});
