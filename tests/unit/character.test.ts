import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHARACTER_FRAMES, MATERIAL, decodeCharacter, sampleParticle } from "../../src/client/particles/data";
import { createParticleAttributes, encodeVertices, resolveMesh, triangleArea } from "../../src/client/particles/rig";
import { mixWeights, single, smoothPose, targetPose, withBlink, type CharacterPose } from "../../src/client/particles/poses";
import { ACTIONS, ActionDirector, sampleAction } from "../../src/client/particles/actions";

const bytes=Uint8Array.from(readFileSync(new URL("../../src/client/particles/generated/character.bin",import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL("../../src/client/particles/generated/character.json",import.meta.url),"utf8"));
const model=decodeCharacter(bytes.buffer);
const rest:CharacterPose={eyes:single("rest"),mouth:single("rest"),brows:single("rest")};
const all=(frame:number):CharacterPose=>{const weights=CHARACTER_FRAMES.map((_,i)=>i===frame?1:0);return {eyes:weights,mouth:weights,brows:weights};};
function descriptorMutation(fn:(d:any)=>void) {
  const size=new DataView(bytes.buffer).getUint32(8,true);
  const d=JSON.parse(new TextDecoder().decode(bytes.subarray(16,16+size)));fn(d);
  const json=new TextEncoder().encode(JSON.stringify(d)),padded=Math.ceil(json.length/4)*4;
  const next=new Uint8Array(16+padded+bytes.length-16-size);next.set(bytes.subarray(0,16));new DataView(next.buffer).setUint32(8,padded,true);
  next.fill(32,16,16+padded);next.set(json,16);next.set(bytes.subarray(16+size),16+padded);return next.buffer;
}
function centroid(material:number,pose:CharacterPose) {
  const vertices=resolveMesh(model,pose),sample=new Float32Array(6);let y=0,count=0;
  for(let i=model.bodyCount;i<model.count;i++)if(model.metadata[i*4+3]===material){sampleParticle(model,i,vertices,sample);y+=sample[1]!;count++;}
  expect(count).toBeGreaterThan(5);return y/count;
}

describe("原画网格绑定：不交换贴片或粒子颜色",()=>{
  test("版本、源图哈希与确定性资源清单一致",()=>{
    expect(manifest.version).toBe(3);expect(model.width).toBe(1240);expect(model.height).toBe(1269);
    expect(model.count).toBeGreaterThan(50_000);expect(model.bodyCount/model.count).toBeGreaterThan(0.9);
    expect(model.vertexCount).toBeGreaterThan(1000);expect(model.triangleCount).toBeGreaterThan(2000);
    expect(model.count).toBe(manifest.count);expect(bytes.length).toBe(manifest.bytes);
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
    expect(new Bun.CryptoHasher("sha256").update(readFileSync(new URL("../../src/images/character.json",import.meta.url))).digest("hex")).toBe(manifest.configSha256);
    for(const [name,hash] of Object.entries(manifest.generators as Record<string,string>))expect(new Bun.CryptoHasher("sha256").update(readFileSync(new URL(`../../scripts/${name}`,import.meta.url))).digest("hex")).toBe(hash);
    for(const [name,hash] of Object.entries(manifest.reviewAssets as Record<string,string>))expect(new Bun.CryptoHasher("sha256").update(readFileSync(new URL(`../../src/client/particles/generated/${name}`,import.meta.url))).digest("hex")).toBe(hash);
    for(const frame of manifest.frames)expect(new Bun.CryptoHasher("sha256").update(readFileSync(new URL(`../../src/images/${frame.file}`,import.meta.url))).digest("hex")).toBe(frame.sha256);
  });
  test("拒绝旧矩形/曲线记录格式、截断文件与无界描述",()=>{
    for(const magic of ["LATIMG01","LATIMG02"]){const old=bytes.slice();old.set(new TextEncoder().encode(magic));expect(()=>decodeCharacter(old.buffer)).toThrow();}
    expect(()=>decodeCharacter(bytes.slice(0,-1).buffer)).toThrow();
    expect(()=>decodeCharacter(descriptorMutation(d=>d.count=1_000_000_000))).toThrow();
    expect(()=>decodeCharacter(descriptorMutation(d=>d.sections.colors.offset=d.sections.positions.offset))).toThrow();
    expect(()=>decodeCharacter(descriptorMutation(d=>d.layers[0].vertexCount+=1))).toThrow();
  });
  test("拒绝非有限顶点及跨部件的三角形绑定",()=>{
    const size=new DataView(bytes.buffer).getUint32(8,true),d=JSON.parse(new TextDecoder().decode(bytes.subarray(16,16+size)));
    const nan=bytes.slice();new DataView(nan.buffer).setFloat32(16+size+d.sections.vertices.offset,NaN,true);expect(()=>decodeCharacter(nan.buffer)).toThrow();
    const bad=bytes.slice();new DataView(bad.buffer).setUint16(16+size+d.sections.bindings.offset+model.bodyCount*6,65535,true);expect(()=>decodeCharacter(bad.buffer)).toThrow();
  });
  test("每颗运动粒子永久绑定本部件三角形，重心坐标归一",()=>{
    for(let i=model.bodyCount;i<model.count;i++){
      const layer=model.layers[model.layerIds[i]!-1]!,t=model.bindings[i*3]!;
      expect(t>=layer.triangleStart&&t<layer.triangleStart+layer.triangleCount).toBe(true);
      expect(model.bindings[i*3+1]!+model.bindings[i*3+2]!).toBeLessThanOrEqual(65535);
      expect(model.metadata[i*4]).toBe(layer.region);
    }
  });
  test("源姿态通过真实三角形重建原坐标，而非最近目标像素重分配",()=>{
    const frames=CHARACTER_FRAMES.map((_,i)=>resolveMesh(model,all(i))),sample=new Float32Array(6);let error=0;
    for(let i=model.bodyCount;i<model.count;i++){
      const layer=model.layers[model.layerIds[i]!-1]!;sampleParticle(model,i,frames[layer.sourceFrame]!,sample);
      error=Math.max(error,Math.abs(sample[0]!-model.positions[i*2]!/65535)*model.width,Math.abs(sample[1]!-model.positions[i*2+1]!/65535)*model.height);
    }
    expect(error).toBeLessThan(0.08);
  });
  test("所有姿态和中间帧中，主体的位置与所有粒子的 RGBA 不变",()=>{
    const sourceColors=model.colors.slice(),sourcePositions=model.positions.slice();
    const reference=resolveMesh(model,rest),sample=new Float32Array(6),initial=new Float32Array(6);
    for(const frame of [1,2,4,6])for(const amount of [0.25,0.5,0.75,1]){
      const pose=smoothPose(rest,all(frame),amount),vertices=resolveMesh(model,pose);
      for(let i=0;i<model.count;i+=17){sampleParticle(model,i,vertices,sample);sampleParticle(model,i,reference,initial);expect([...sample.slice(2)]).toEqual([...initial.slice(2)]);if(i<model.bodyCount)expect([...sample.slice(0,2)]).toEqual([...initial.slice(0,2)]);}
    }
    expect(model.colors).toEqual(sourceColors);expect(model.positions).toEqual(sourcePositions);
  });
  test("虹膜/眼白保持原位，眼睑网格实际移动且闭合窗口面积为零",()=>{
    const base=resolveMesh(model,rest),closed=resolveMesh(model,withBlink(rest,1));let moving=0;
    for(const layer of model.layers){
      const a=layer.vertexStart*2,b=(layer.vertexStart+layer.vertexCount)*2;
      if(layer.role.startsWith("eye-"))expect(closed.slice(a,b)).toEqual(base.slice(a,b));
      if(layer.name.endsWith("-lash"))for(let i=a;i<b;i++)if(Math.abs(base[i]!-closed[i]!)>1e-5)moving++;
      if(layer.role==="window-left"||layer.role==="window-right")for(let t=layer.triangleStart;t<layer.triangleStart+layer.triangleCount;t++)expect(Math.abs(triangleArea(closed,model.triangles,t))).toBeLessThan(1e-10);
    }
    expect(moving).toBeGreaterThan(100);
    expect(model.layers.filter(l=>l.name.endsWith("-lash")).every(l=>l.deformation==="lid-cage")).toBe(true);
  });
  test("关键帧和 25/50/75% 插值中三角网格不翻折",()=>{
    let minimum=Infinity;
    for(let f=0;f<7;f++)for(const a of [0,0.25,0.5,0.75,1]){
      const vertices=resolveMesh(model,smoothPose(rest,all(f),a));
      for(let t=0;t<model.triangleCount;t++)minimum=Math.min(minimum,triangleArea(vertices,model.triangles,t));
    }
    expect(minimum).toBeGreaterThanOrEqual(-1e-10);
  });
  test("抬眉只移动原画眉毛网格，身体、眼球和笔触线宽不变",()=>{
    const base=resolveMesh(model,rest),lifted=resolveMesh(model,{...rest,browLift:4});
    for(const layer of model.layers)for(let i=layer.vertexStart;i<layer.vertexStart+layer.vertexCount;i++){
      expect(lifted[i*2]).toBe(base[i*2]);
      if(layer.region>=4)expect((base[i*2+1]!-lifted[i*2+1]!)*model.height).toBeCloseTo(4,3);
      else expect(lifted[i*2+1]).toBe(base[i*2+1]);
    }
  });
  test("闭嘴口腔收拢为零面积，上下唇分别联动而不是显隐换图",()=>{
    const quiet={...rest,mouth:single("soft")};
    expect(centroid(MATERIAL.upperLip,quiet)).toBeLessThan(centroid(MATERIAL.upperLip,rest)-2/model.height);
    expect(centroid(MATERIAL.lowerLip,quiet)).toBeGreaterThan(centroid(MATERIAL.lowerLip,rest)+2/model.height);
    const window=model.layers.find(l=>l.role==="window-mouth")!,vertices=resolveMesh(model,rest);
    for(let t=window.triangleStart;t<window.triangleStart+window.triangleCount;t++)expect(Math.abs(triangleArea(vertices,model.triangles,t))).toBeLessThan(1e-10);
  });
  test("嘴部范围不吸入鼻尖和领口；软声中间帧不长出跨脸细线",()=>{
    const sample=new Float32Array(6);
    for(const amount of [0,0.25,0.5,0.75,1]){
      const vertices=resolveMesh(model,{...rest,mouth:mixWeights(single("rest"),single("soft"),amount)});
      for(let i=model.bodyCount;i<model.count;i++)if(model.metadata[i*4]===3){sampleParticle(model,i,vertices,sample);expect(sample[0]!*model.width).toBeGreaterThan(477);expect(sample[0]!*model.width).toBeLessThan(583);expect(sample[1]!*model.height).toBeGreaterThan(640);expect(sample[1]!*model.height).toBeLessThan(713);}
    }
  });
  test("口腔使用轻声原画做共同粒度基准，蓝噪声采样不排列成压缩条码",()=>{
    const inside=model.layers.find(l=>l.role==="mouth")!;expect(inside.sourceFrame).toBe(1);
    const points:number[][]=[];
    for(let i=model.bodyCount;i<model.count;i++)if(model.layerIds[i]===inside.id){expect(model.metadata[i*4+2]).toBe(128);points.push([model.positions[i*2]!/65535*model.width,model.positions[i*2+1]!/65535*model.height]);}
    expect(points.length).toBeGreaterThan(20);expect(points.length).toBeLessThan(200);
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)expect(Math.hypot(points[i]![0]!-points[j]![0]!,points[i]![1]!-points[j]![1]!)).toBeGreaterThan(2.8);
  });
  test("原画 alpha 蒙版是不规则部件，不是整个矩形换色",()=>{
    for(const layer of model.layers.filter(l=>l.role==="paint")){
      const {x,y,width,height}=layer.atlas;let count=0;
      for(let yy=y;yy<y+height;yy++)for(let xx=x;xx<x+width;xx++)if(model.atlas[(yy*model.atlasWidth+xx)*4+3]!>32)count++;
      expect(count).toBeGreaterThan(5);expect(count/(width*height)).toBeLessThan(0.8);
    }
    expect(model.metadata.some((v,i)=>i%4===3&&v===MATERIAL.lowerLid)).toBe(false);
  });
  test("GPU 使用同样的顶点、重心权重与有界 16 位位置纹理",()=>{
    const attrs=createParticleAttributes(model),vertices=resolveMesh(model,{...rest,mouth:single("soft")}),packed=new Uint8Array(Math.ceil(model.vertexCount/128)*128*4);encodeVertices(vertices,packed);
    for(let i=0;i<model.vertexCount;i++){
      expect(Math.abs((packed[i*4]!*256+packed[i*4+1]!)/65535-vertices[i*2]!)*model.width).toBeLessThan(0.02);
      expect(Math.abs((packed[i*4+2]!*256+packed[i*4+3]!)/65535-vertices[i*2+1]!)*model.height).toBeLessThan(0.02);
    }
    for(let i=model.bodyCount;i<model.count;i++){expect(attrs.areas[i]).toBeGreaterThan(0);expect(attrs.bary[i*3]!+attrs.bary[i*3+1]!+attrs.bary[i*3+2]!).toBeCloseTo(1,5);}
  });
});

describe("短语动作调度，不按逐字循环张嘴",()=>{
  test("动作关键点连续，眨眼有完整闭合且首尾回到原姿态",()=>{
    expect(sampleAction(ACTIONS.blink.keys,0)).toBe(0);expect(sampleAction(ACTIONS.blink.keys,0.11)).toBe(1);expect(sampleAction(ACTIONS.blink.keys,0.25)).toBe(0);
    expect(sampleAction(ACTIONS.soft.keys,0)).toBe(0);expect(sampleAction(ACTIONS.soft.keys,ACTIONS.soft.duration)).toBe(0);
  });
  test("说话使用局部时间，停止后平滑收口",()=>{
    const director=new ActionDirector();let maximum=0;
    for(let i=0;i<45;i++)maximum=Math.max(maximum,director.tick(0.02,"neutral","speaking").mouth[1]!);
    expect(maximum).toBeGreaterThan(0.5);
    let pose=rest;for(let i=0;i<30;i++)pose=director.tick(0.02,"neutral","idle");
    expect(pose.mouth[0]).toBeGreaterThan(0.99);
  });
  test("标点后留出停顿，短语中不因每个可见字重启动作",()=>{
    const director=new ActionDirector(),text="先慢慢说，我在认真听。";
    let pose=rest;
    for(let i=0;i<15;i++)pose=director.tick(0.02,"neutral","speaking",{id:"a",text,visible:Math.min(4,1+Math.floor(i/4))});
    expect(pose.mouth[1]).toBeGreaterThan(0.5);
    for(let i=0;i<9;i++)pose=director.tick(0.02,"neutral","speaking",{id:"a",text,visible:5});
    expect(pose.mouth[0]).toBeGreaterThan(0.8);
  });
  test("眨眼独立于说话，减少动态效果不运行动作循环",()=>{
    const director=new ActionDirector();let blink=0;
    for(let i=0;i<400;i++)blink=Math.max(blink,director.tick(0.02,"neutral","idle").eyes[6]!);
    expect(blink).toBeGreaterThan(0.99);
    for(let i=0;i<100;i++)expect(director.tick(0.1,"neutral","speaking",undefined,false)).toEqual(targetPose("neutral","speaking"));
  });
});
