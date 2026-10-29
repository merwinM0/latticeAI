import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PROVIDERS } from "../../src/server/providers";
import { createSceneLayout } from "../../src/client/lib/scene-layout";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/providers", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ providers: PROVIDERS.map(({ id, name, description, models }) => ({ id, name, description, models, configured: false })) }),
  }));
});
const events = (text = "收到啦，我们一句一句聊。") => [
  { type: "emotion", emotion: "curious" }, { type: "message", index: 0, text }, { type: "done" },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
async function characterReady(page: Page) {
  await expect(page.locator("canvas")).toHaveAttribute("data-ready", "true");
}
async function send(page: Page, text: string) {
  await characterReady(page);
  await page.getByLabel("给点点发消息").fill(text);
  await page.getByLabel("给点点发消息").press("Enter");
}
async function configure(page: Page) {
  await characterReady(page);
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByRole("button", { name: "连接真实模型" }).click();
  await page.getByRole("button", { name: "DeepSeek", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).fill("test-browser-key");
  await page.getByRole("button", { name: "保存连接" }).click();
}
async function settled(page: Page) { await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0); }

test("初始界面只有粒子脸和输入栏，没有 Logo、介绍或聊天列表", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await characterReady(page);
  await expect(page.locator("canvas")).toHaveAttribute("data-renderer", "webgl");
  await expect(page.locator("canvas")).toHaveAttribute("data-source", "native-mesh");
  expect(Number(await page.locator("canvas").getAttribute("data-particles"))).toBeGreaterThan(40_000);
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("header, nav, footer, .brand, .messages, .floating-reply")).toHaveCount(0);
  await expect(page.getByLabel("给点点发消息")).toBeInViewport();
  await expect(page.getByLabel("给点点发消息")).toHaveAttribute("placeholder", /演示/);
  await page.screenshot({ path: testInfo.outputPath("minimal-home.png") });
  expect(errors).toEqual([]);
});

test("演示回复在旁边浮现，思考、嘴型和情绪状态变化，不调用真实 API", async ({ page }) => {
  let calls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/chat")) calls++; });
  await page.goto("/");
  await send(page, "今天有点累");
  await expect(page.getByRole("img", { name: /粒子表情/ })).toHaveAttribute("aria-label", /正在思考/);
  await expect(page.locator(".floating-reply").first()).toBeVisible();
  await expect(page.locator(".floating-reply").last()).toHaveText("今天最让你觉得累的，是什么？");
  await settled(page);
  await expect(page.getByRole("img", { name: /粒子表情/ })).toHaveAttribute("aria-label", /陪在你这边/);
  expect(calls).toBe(0);
});

test("回复会淡出移除，但上下文和辅助阅读记录仍保留", async ({ page }) => {
  await page.clock.install();
  const sent: any[] = [];
  await page.route("**/api/chat", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: events("我在听。") });
  });
  await page.goto("/");
  await configure(page);
  await send(page, "你好");
  await expect(page.locator(".floating-reply")).toHaveText("我在听。");
  await settled(page);
  await page.mouse.move(0, 0);
  await page.clock.fastForward(6500);
  await expect(page.locator(".floating-reply")).toHaveClass(/is-leaving/);
  await page.clock.fastForward(1500);
  await expect(page.locator(".floating-reply")).toHaveCount(0);
  await expect(page.locator("section[aria-label='当前对话记录']")).toContainText("我在听。");
  await page.clock.resume();
  await send(page, "继续聊");
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"]);
  expect(sent[1].messages[1].content).toContain("我在听。");
});

test("悬停或键盘聚焦时暂停消失计时", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await send(page, "你好");
  await settled(page);
  const reply = page.locator(".floating-reply").first();
  await reply.focus();
  await expect(reply).toHaveAttribute("data-paused", "true");
  await page.clock.fastForward(20_000);
  await expect(reply).toBeVisible();
  await expect(reply).not.toHaveClass(/is-leaving/);
  await page.getByLabel("给点点发消息").focus();
  await page.mouse.move(0, 0);
  await expect(reply).toHaveAttribute("data-paused", "false");
  await page.clock.runFor(50);
  await page.clock.fastForward(20_000);
  await page.clock.fastForward(1500);
  await expect(page.locator(".floating-reply")).toHaveCount(0);
});

test("停止、重试、清空对话，主界面不显示历史列表", async ({ page }) => {
  await page.goto("/");
  await send(page, "你好");
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect(page.locator(".scene-feedback")).toContainText("已停止");
  await page.getByRole("button", { name: "再试一次", exact: true }).click();
  await expect(page.locator(".floating-reply").first()).toHaveText("嗨，我是点点。很高兴见到你！");
  await settled(page);
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByRole("button", { name: "清空当前对话" }).click();
  await expect(page.locator(".floating-reply")).toHaveCount(0);
  await expect(page.getByLabel("给点点发消息")).toBeFocused();
});

test("真实模式解析 SSE，密钥仅在内存，刷新清空", async ({ page }) => {
  let sent: any;
  await page.route("**/api/chat", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ contentType: "text/event-stream", body: events() });
  });
  await page.goto("/");
  await configure(page);
  await send(page, "你好，点点");
  await expect(page.locator(".floating-reply")).toHaveText("收到啦，我们一句一句聊。");
  await settled(page);
  expect(sent.apiKey).toBe("test-browser-key");
  expect(sent.messages).toEqual([{ role: "user", content: "你好，点点" }]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("test-browser-key");
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("test-browser-key");
  await expect(page.locator(".reply-field")).not.toContainText('"emotion"');
  await page.reload();
  await expect(page.locator(".floating-reply")).toHaveCount(0);
  await page.getByRole("button", { name: "模型设置" }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
});

test("错误可读，可重新连接与重试", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    if (calls++ === 0) await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "API Key 无效或没有该模型的访问权限。" }) });
    else await route.fulfill({ contentType: "text/event-stream", body: events("这次连接好了。") });
  });
  await page.goto("/");
  await configure(page);
  await send(page, "试试连接");
  await expect(page.getByRole("alert")).toContainText("API Key 无效");
  await page.getByRole("button", { name: "再试一次", exact: true }).click();
  await expect(page.locator(".floating-reply")).toHaveText("这次连接好了。");
  await expect(page.locator("section[aria-label='当前对话记录'] li")).toHaveCount(1);
});

test("连续三条回答不会堆成列表，最早一条先淡出", async ({ page }) => {
  const texts = ["先说第一句。", "再说第二句。", "最后这一句。"];
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "text/event-stream", body: [
    { type: "emotion", emotion: "happy" }, ...texts.map((text, index) => ({ type: "message", index, text })), { type: "done" },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") }));
  await page.goto("/");
  await configure(page);
  await send(page, "聊三句");
  await expect(page.locator(".floating-reply").last()).toHaveText(texts[2]!);
  await settled(page);
  await page.waitForTimeout(700);
  await expect(page.locator(".floating-reply")).toHaveCount(2);
  await expect(page.locator(".reply-field")).not.toContainText(texts[0]!);
  await expect(page.locator("section[aria-label='当前对话记录']")).toContainText(texts[0]!);
});

test("中文输入法不误发送，设置弹窗约束与恢复焦点", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("给点点发消息");
  await input.fill("你好");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0);
  await input.dispatchEvent("compositionend");
  await page.getByRole("button", { name: "模型设置" }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.getByRole("dialog").evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "模型设置" })).toBeFocused();
});

for (const [width, height] of [[320, 640], [390, 844], [390, 500], [768, 768], [1024, 900], [1440, 1000]]) {
  test(`响应式 ${width}×${height}：同屏、浮现不遮五官、无障碍检查`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto("/");
    await expect(page.getByLabel("给点点发消息")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    await send(page, "你好");
    await settled(page);
    await page.waitForTimeout(1000);
    const top = await page.locator(".input-dock").evaluate((element) => element.getBoundingClientRect().top);
    const layout = createSceneLayout(width!, height!, top);
    const radius = layout.diameter * 0.54 + 16;
    const rectangles = await page.locator(".floating-reply").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom };
    }));
    for (const rect of rectangles) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width!);
      expect(rect.bottom).toBeLessThan(top);
      expect(rect.right <= layout.faceX - radius || rect.x >= layout.faceX + radius || rect.bottom <= layout.faceY - radius || rect.y >= layout.faceY + radius).toBe(true);
    }
    if (rectangles.length === 2) {
      const [a, b] = rectangles;
      expect(a!.right <= b!.x || b!.right <= a!.x || a!.bottom <= b!.y || b!.bottom <= a!.y).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`particles-${width}-${height}.png`) });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  });
}

test("WebGL 不可用时自动降级到 Canvas 粒子，仍可聊天", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: any[]) {
      if (kind === "webgl" || kind === "webgl2") return null;
      return (original as Function).apply(this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveAttribute("data-renderer", "canvas");
  await send(page, "你好");
  await expect(page.locator(".floating-reply").first()).toBeVisible();
});

test("GPU 上下文丢失也会降级，不出现空白主界面", async ({ page }) => {
  await page.goto("/");
  await characterReady(page);
  await expect(page.locator("canvas")).toHaveAttribute("data-renderer", "webgl");
  await page.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).getContext("webgl")!.getExtension("WEBGL_lose_context")!.loseContext());
  await expect(page.locator("canvas")).toHaveAttribute("data-renderer", "canvas");
  await expect(page.getByLabel("给点点发消息")).toBeInViewport();
});

test("减少动态效果时停止粒子动画，回答仍显示并能消失", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await characterReady(page);
  await page.waitForTimeout(300);
  const before = await page.locator("canvas").screenshot();
  await page.waitForTimeout(180);
  const after = await page.locator("canvas").screenshot();
  expect(before.equals(after)).toBe(true);
  await send(page, "我终于成功了");
  await expect(page.locator(".floating-reply").last()).toHaveText("给今天的自己留一点庆祝时间吧。");
});

test("说话改变实际粒子像素，主界面不下载整张表情 PNG", async ({ page }) => {
  const pictures:string[]=[];
  page.on("request",request=>{if(/\.png(?:\?|$)/u.test(request.url()))pictures.push(request.url());});
  await page.route("**/api/chat", (route) => route.fulfill({ contentType: "text/event-stream", body: events("这是一段用于检查粒子说话口型的稍长回复。".repeat(7)) }));
  await page.goto("/");
  await configure(page);
  await send(page, "检查口型");
  await expect(page.getByRole("img", { name: /粒子表情/ })).toHaveAttribute("aria-label", /正在说话/);
  const before = await page.locator("canvas").screenshot();
  await page.waitForTimeout(190);
  const after = await page.locator("canvas").screenshot();
  expect(before.equals(after)).toBe(false);
  expect(pictures).toEqual([]);
  await expect(page.locator("img")).toHaveCount(0);
});

test("角色素材加载失败可重试，不静默退回旧的公式笑脸", async ({ page }) => {
  await page.route("**/*.bin", (route) => route.fulfill({ status: 503, headers: { "Cache-Control": "no-store" }, body: "unavailable" }));
  await page.goto("/");
  await expect(page.locator(".asset-status")).toContainText("角色素材加载失败");
  await expect(page.locator("canvas")).toHaveAttribute("data-ready", "false");
  await page.unroute("**/*.bin");
  await page.getByRole("button", { name: "重新加载角色" }).click();
  await characterReady(page);
  await expect(page.locator(".asset-status")).toHaveCount(0);
});

test("暗色模型设置通过自动无障碍规则检查", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByRole("button", { name: "连接真实模型" }).click();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
});
