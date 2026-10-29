import type { Emotion, FaceState } from "../../shared/types";
import type { SceneLayout } from "../lib/scene-layout";
import { ActionDirector, type SpeechCue } from "./actions";
import type { CharacterPose } from "./poses";

export interface ParticleState { emotion: Emotion; state: FaceState; layout: SceneLayout; speech?: SpeechCue }
export interface ParticleFrame extends ParticleState { time: number; pose: CharacterPose; ratio: number; motion: number }
export interface ParticleEngine {
  update: (state: ParticleState) => void;
  /** Shared by the native-art review tool; null resumes the action director. */
  renderPose: (pose: CharacterPose | null) => void;
  destroy: () => void;
}
export type Painter = (frame: ParticleFrame) => void;
export function animateParticles(canvas: HTMLCanvasElement, initial: ParticleState, paint: Painter, dispose: () => void, fps=40): ParticleEngine {
  let target=initial, manual: CharacterPose|null=null, frameId=0, lastTime: number|null=null, destroyed=false, painted=false;
  const director=new ActionDirector();
  const media=window.matchMedia("(prefers-reduced-motion: reduce)");
  const draw=(now:number,force=false) => {
    if (destroyed) return;
    if (!media.matches && !document.hidden && !manual) frameId=requestAnimationFrame(time=>draw(time));
    if (!force && lastTime !== null && now-lastTime < 1000/fps) return;
    const dt=lastTime === null ? 0 : (now-lastTime)/1000;
    lastTime=now;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const width=Math.round(target.layout.width*ratio),height=Math.round(target.layout.height*ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width=width;canvas.height=height; }
    try {
      paint({...target,time:now/1000,ratio,motion:media.matches?0:1,pose:manual||director.tick(dt,target.emotion,target.state,target.speech,!media.matches)});
      painted=true;
    } catch(error) {
      destroyed=true;release();
      if(!painted)throw error;
      canvas.dispatchEvent(new Event("character-render-error"));
    }
  };
  const restart=()=> { cancelAnimationFrame(frameId);lastTime=null;if (!document.hidden) draw(performance.now(),true); };
  const visibility=()=> { if (document.hidden) cancelAnimationFrame(frameId);else restart(); };
  let released=false;
  const release=()=>{if(released)return;released=true;cancelAnimationFrame(frameId);media.removeEventListener("change",restart);document.removeEventListener("visibilitychange",visibility);dispose();};
  media.addEventListener("change",restart);
  document.addEventListener("visibilitychange",visibility);
  try{restart();}catch(error){release();throw error;}
  return {
    update(state) { target=state;if (media.matches) restart(); },
    renderPose(pose) {
      if(pose?.browLift!==undefined && (!Number.isFinite(pose.browLift)||Math.abs(pose.browLift)>8))throw new Error("Invalid brow control");
      if (pose && [pose.eyes,pose.mouth,pose.brows].some(w=>w.length!==7 || w.some(n=>!Number.isFinite(n)||n<0||n>1) || Math.abs(w.reduce((a,b)=>a+b,0)-1)>0.001)) throw new Error("Invalid mesh pose");
      manual=pose;restart();
    },
    destroy() { destroyed=true;release(); },
  };
}
