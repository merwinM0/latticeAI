import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { decodeCharacter } from "../../src/client/particles/data";
import { mixWeights, single } from "../../src/client/particles/poses";
import { drawRigPose } from "./rig-driver";

const bytes=Uint8Array.from(readFileSync(new URL("../../src/client/particles/generated/character.bin",import.meta.url)));
const model=decodeCharacter(bytes.buffer);
const rest={eyes:single("rest"),mouth:single("rest"),brows:single("rest")};

test("原色联动共用绑定，嘴部过渡不改变鼻尖、领口、额头与眼睛",async({page},info)=>{
  await page.emulateMedia({reducedMotion:"reduce"});await page.setViewportSize({width:1000,height:900});
  await page.goto("/preview/character?zoom=0");await expect(page.locator("canvas")).toHaveAttribute("data-ready","true");
  await drawRigPose(page,model,rest,true);
  const protectedAreas=[[484,620,580,641],[476,733,588,756],[470,300,560,400],[306,502,478,650],[579,489,750,634]];
  for(const amount of [0.25,0.5,0.75,1]){
    const result=await drawRigPose(page,model,{...rest,mouth:mixWeights(single("rest"),single("soft"),amount)},false,protectedAreas);
    expect(result.error).toBe(0);expect(result.changed).toBeGreaterThan(25);expect(result.protectedChanged).toEqual([0,0,0,0,0]);
    await page.screenshot({path:info.outputPath(`native-soft-${amount}.png`)});
  }
});

for(const width of [320,768,1440])test(`校对页 ${width}px：键盘进度、原画资源与无障碍检查`,async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:"reduce"});await page.setViewportSize({width,height:900});await page.goto("/preview/character");
  await expect(page.locator("canvas")).toHaveAttribute("data-ready","true");
  await page.getByRole("radio",{name:"轻声说话",exact:true}).check();
  await page.getByRole("slider").focus();await page.getByRole("slider").press("End");
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuetext","100%");
  await page.getByRole("radio",{name:"粒子联动",exact:true}).check();await expect(page.locator("canvas")).toHaveAttribute("data-view","particles");await expect(page.locator("canvas")).toHaveAttribute("data-ready","true");
  await page.getByRole("radio",{name:"补底图",exact:true}).check();await expect(page.getByRole("img",{name:/固定肤色与头发补底图/})).toBeVisible();
  await page.getByText("查看补底与独立原画图层",{exact:true}).click();
  await expect(page.getByRole("link",{name:"打开原始静止参考"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();expect(audit.violations).toEqual([]);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath(`review-${width}.png`),fullPage:true});
});
