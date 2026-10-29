import { useEffect, useRef, useState } from "react";
import type { SceneLayout } from "../lib/scene-layout";
import type { ParticleEngine, ParticleState } from "../particles/animation";
import { createCanvasScene } from "../particles/canvas";
import type { CharacterModel } from "../particles/data";
import type { CharacterPose } from "../particles/poses";
import { createWebGLScene } from "../particles/webgl";

export interface ReviewAPI {
  setPose(pose: CharacterPose): void;
  capture(): { pixels: Uint8Array; width: number; height: number; layout: SceneLayout; error: number };
}
declare global { interface Window { characterReview?: ReviewAPI } }

export function ReviewCanvas({model,base,view,pose,zoom}:{model:CharacterModel;base:HTMLImageElement;view:"native"|"particles";pose:CharacterPose;zoom:boolean}) {
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<ParticleEngine|null>(null),poseRef=useRef(pose),zoomRef=useRef(zoom),resizeRef=useRef<()=>void>(()=>{});
  poseRef.current=pose;zoomRef.current=zoom;
  const [backend,setBackend]=useState<"webgl"|"canvas">("webgl"),[ready,setReady]=useState(false),[error,setError]=useState("");
  useEffect(()=> {
    const element=canvas.current;if(!element)return;
    setReady(false);setError("");
    let layout:SceneLayout;
    const measure=()=> {
      const rect=element.parentElement!.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
      const diameter=zoomRef.current?Math.min(width/0.4,height/0.3)*0.9:Math.min(width*0.95,height*0.96);
      layout={width,height,diameter,faceX:width/2+(zoomRef.current?0.075*diameter*model.width/model.height:0),faceY:height/2+(zoomRef.current?0.045*diameter:0),safeBottom:height,margin:0};
      const state:ParticleState={layout,emotion:"neutral",state:"idle"};
      if(engine.current){engine.current.update(state);engine.current.renderPose(poseRef.current);}
      return state;
    };
    const onLost=(event:Event)=>{event.preventDefault();setBackend("canvas");};
    const onError=()=>{setReady(false);if(backend==="webgl")setBackend("canvas");else setError("预览无法绘制，请刷新页面后重试。");};
    element.addEventListener("webglcontextlost",onLost);
    element.addEventListener("character-render-error",onError);
    try {
      const state=measure();
      engine.current=backend==="webgl"?createWebGLScene(element,state,model,view==="native"?base:undefined):createCanvasScene(element,state,model,view==="native"?base:undefined);
      engine.current.renderPose(poseRef.current);
      window.characterReview={
        setPose(next){poseRef.current=next;engine.current?.renderPose(next);},
        capture(){
          engine.current?.renderPose(poseRef.current);
          const gl=backend==="webgl"?element.getContext("webgl"):null;
          const pixels=new Uint8Array(element.width*element.height*4);
          if(gl)gl.readPixels(0,0,element.width,element.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          else pixels.set(element.getContext("2d")!.getImageData(0,0,element.width,element.height).data);
          return {pixels,width:element.width,height:element.height,layout,error:gl?.getError()||0};
        },
      };
      setReady(true);
    } catch {
      if(backend==="webgl")setBackend("canvas");else setError("预览无法绘制，请刷新页面后重试。");
    }
    resizeRef.current=()=>{measure();};
    const observer=new ResizeObserver(()=>measure());observer.observe(element.parentElement!);
    return ()=> {observer.disconnect();element.removeEventListener("webglcontextlost",onLost);element.removeEventListener("character-render-error",onError);engine.current?.destroy();engine.current=null;delete window.characterReview;};
  },[model,base,view,backend]);
  useEffect(()=>{engine.current?.renderPose(pose);},[pose]);
  useEffect(()=>{resizeRef.current();},[zoom]);
  return <><canvas key={`${view}-${backend}`} ref={canvas} role="img" aria-label={`${view==="native"?"原色":"粒子"}联动预览`} data-ready={ready} data-renderer={backend} data-view={view}/>{error&&<p role="alert" className="review-error">{error}</p>}</>;
}
