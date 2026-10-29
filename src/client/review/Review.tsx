import { useEffect, useMemo, useRef, useState } from "react";
import cleanUrl from "../particles/generated/clean-base.png" with {type:"file"};
import atlasUrl from "../particles/generated/art-atlas.png" with {type:"file"};
import referenceUrl from "../../images/6_大肥鱼的温柔微笑.png" with {type:"file"};
import { ACTIONS, sampleAction } from "../particles/actions";
import { loadCharacter } from "../particles/assets";
import type { CharacterModel } from "../particles/data";
import { mixWeights, single, withBlink, type CharacterPose } from "../particles/poses";
import { ReviewCanvas } from "./ReviewCanvas";

type View="base"|"native"|"particles";
export function Review() {
  const query=new URLSearchParams(location.search);
  const [view,setView]=useState<View>(query.get("view")==="particles"?"particles":"native");
  const [zoom,setZoom]=useState(query.get("zoom")!=="0"),[action,setAction]=useState<"blink"|"soft">("blink"),[progress,setProgress]=useState(0),[playing,setPlaying]=useState(false);
  const [loaded,setLoaded]=useState<{model:CharacterModel;base:HTMLImageElement}|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const progressRef=useRef(progress);progressRef.current=progress;
  useEffect(()=> {
    let cancelled=false;setError("");
    const image=new Image();image.src=cleanUrl;
    Promise.all([loadCharacter(),image.decode()]).then(([model])=>{if(!cancelled)setLoaded({model,base:image});}).catch(()=>{if(!cancelled)setError("角色校对素材加载失败，请重试。");});
    return()=>{cancelled=true;};
  },[retry]);
  useEffect(()=> {
    if(!playing)return;
    const start=performance.now()-progressRef.current*ACTIONS[action].duration*1000;
    let id=0;
    const tick=(now:number)=> {const next=Math.min(1,(now-start)/(ACTIONS[action].duration*1000));setProgress(next);if(next>=1)setPlaying(false);else id=requestAnimationFrame(tick);};
    id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
  },[playing,action]);
  const pose=useMemo<CharacterPose>(()=> {
    const rest={eyes:single("rest"),mouth:single("rest"),brows:single("rest")};
    const clip=ACTIONS[action],amount=sampleAction(clip.keys,progress*clip.duration);
    return action==="blink"?withBlink(rest,amount):{...rest,mouth:mixWeights(single("rest"),single("soft"),amount)};
  },[action,progress]);
  return <main className="review-page">
    <header className="review-header"><div><p className="review-eyebrow">原画分层 → 联动 → 粒子</p><h1>角色动作校对</h1></div><a href="/">回到对话</a></header>
    <fieldset className="review-modes"><legend>检查阶段</legend>{([["base","补底图"],["native","原色联动"],["particles","粒子联动"]] as const).map(([value,label])=><label key={value}><input type="radio" name="view" value={value} checked={view===value} onChange={()=>{setPlaying(false);setView(value);}}/>{label}</label>)}</fieldset>
    <div className="review-stage" aria-busy={!loaded&&!error}>
      {error?<div className="review-status" role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>重新加载</button></div>:!loaded?<p className="review-status" role="status">正在加载原色图层与网格…</p>:view==="base"?<img className="review-base" src={cleanUrl} alt="去除原五官后，固定肤色与头发补底图"/>:<ReviewCanvas model={loaded.model} base={loaded.base} view={view} pose={pose} zoom={zoom}/>}
    </div>
    <div className="review-controls">
      <fieldset disabled={view==="base"||!loaded}><legend>动作</legend>{([["blink","眨眼"],["soft","轻声说话"]] as const).map(([value,label])=><label key={value}><input type="radio" name="action" checked={action===value} onChange={()=>{setPlaying(false);setAction(value);setProgress(0);}}/>{label}</label>)}</fieldset>
      <button disabled={view==="base"||!loaded} onClick={()=>{if(progress>=1)setProgress(0);setPlaying(value=>!value);}}>{playing?"暂停":"播放一次"}</button>
      <label className="review-zoom"><input type="checkbox" checked={zoom} disabled={view==="base"} onChange={event=>setZoom(event.target.checked)}/>放大五官</label>
      <label className="review-progress" htmlFor="progress">动作进度 <output htmlFor="progress" aria-live="off">{Math.round(progress*100)}%</output><input id="progress" type="range" aria-valuetext={`${Math.round(progress*100)}%`} min="0" max="1" step="0.005" value={progress} disabled={view==="base"||!loaded} onChange={event=>{setPlaying(false);setProgress(Number(event.target.value));}}/></label>
    </div>
    <p className="review-note">原色与粒子共用同一套三角网格；拖动进度检查中间帧。说话仅模拟文字节奏，不是语音对口型。</p>
    <details className="review-assets"><summary>查看补底与独立原画图层</summary><p><a href={referenceUrl} target="_blank" rel="noreferrer">打开原始静止参考</a> · <a href={cleanUrl} target="_blank" rel="noreferrer">打开完整补底图</a> · <a href={atlasUrl} target="_blank" rel="noreferrer">打开透明原画部件图集</a></p><img src={atlasUrl} alt="眼部、睫毛、眉毛、上下唇及口腔的原色透明部件图集"/><ul>{loaded?.model.layers.filter(layer=>!layer.role.startsWith("window")).map(layer=><li key={layer.id}>{layer.name} · {layer.vertexCount} 顶点</li>)}</ul></details>
  </main>;
}
