import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { decodeCharacter } from "../../src/client/particles/data";
import { withBlink, type CharacterPose } from "../../src/client/particles/poses";
import { drawRigPose } from "./rig-driver";

const bytes = Uint8Array.from(readFileSync(new URL("../../src/client/particles/generated/character.bin", import.meta.url)));
const model = decodeCharacter(bytes.buffer);
const one = (frame: number) => Array.from({ length: 7 }, (_, index) => index === frame ? 1 : 0);
const rest: CharacterPose = { eyes: one(0), mouth: one(0), brows: one(0) };
const skin = [[345, 661, 460, 669], [593, 645, 713, 653], [479, 635, 582, 642]];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/preview/character?view=particles&zoom=0");
  await expect(page.locator("canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("canvas")).toHaveAttribute("data-renderer", "webgl");
});

test("眨眼中间帧：脸颊与嘴边皮肤逐像素不变，而不是整个眼周贴片替换", async ({ page }, info) => {
  await drawRigPose(page, model, rest, true);
  for (const amount of [0.25, 0.5, 0.75, 1]) {
    const result = await drawRigPose(page, model, withBlink(rest, amount), false, skin);
    expect(result.error).toBe(0);
    expect(result.changed).toBeGreaterThan(50);
    expect(result.protectedChanged).toEqual([0, 0, 0]);
    await page.screenshot({ path: info.outputPath(`blink-${amount}.png`) });
  }
});

test("张嘴中间帧：上下唇连续移动，眼睛和嘴边的固定皮肤不被换色", async ({ page }, info) => {
  await drawRigPose(page, model, rest, true);
  const protectedAreas = [...skin, [306, 502, 478, 674], [579, 489, 750, 657]];
  for (const amount of [0.25, 0.5, 0.75, 1]) {
    const mouth = one(0).map((value, index) => value * (1 - amount) + (index === 2 ? amount : 0));
    const result = await drawRigPose(page, model, { ...rest, mouth }, false, protectedAreas);
    expect(result.error).toBe(0);
    expect(result.changed).toBeGreaterThan(25);
    expect(result.protectedChanged).toEqual([0, 0, 0, 0, 0]);
    await page.screenshot({ path: info.outputPath(`mouth-${amount}.png`) });
  }
});
