import type { Emotion, FaceState } from "../../shared/types";
import { mixWeights, single, smoothPose, targetPose, withBlink, type CharacterPose } from "./poses";

export interface SpeechCue { id: string; text: string; visible: number }
interface Key { at: number; amount: number }
export const ACTIONS = {
  blink: { duration: 0.25, keys: [{at:0,amount:0},{at:0.095,amount:1},{at:0.125,amount:1},{at:0.25,amount:0}] },
  soft: { duration: 0.62, frame: "soft", strength: 1, keys: [{at:0,amount:0},{at:0.12,amount:0.8},{at:0.24,amount:1},{at:0.44,amount:0.35},{at:0.62,amount:0}] },
  rounded: { duration: 0.7, frame: "round", strength: 0.4, keys: [{at:0,amount:0},{at:0.17,amount:0.8},{at:0.3,amount:1},{at:0.5,amount:0.35},{at:0.7,amount:0}] },
  emphasis: { duration: 0.74, frame: "open", strength: 0.42, keys: [{at:0,amount:0},{at:0.16,amount:0.85},{at:0.3,amount:1},{at:0.55,amount:0.3},{at:0.74,amount:0}] },
} as const;
export function sampleAction(keys: readonly Key[], time: number): number {
  if (time <= keys[0]!.at) return keys[0]!.amount;
  for (let i=1; i<keys.length; i++) {
    const b=keys[i]!, a=keys[i-1]!;
    if (time <= b.at) { const t=(time-a.at)/(b.at-a.at), eased=t*t*(3-2*t); return a.amount+(b.amount-a.amount)*eased; }
  }
  return keys.at(-1)!.amount;
}

/** Text rhythm, not phoneme/audio lip-sync. Punctuation gates phrases, not each glyph. */
export class ActionDirector {
  private expression = targetPose("neutral", "idle");
  private mouth = single("rest");
  private state: FaceState = "idle";
  private cueId = "";
  private visible = 0;
  private phase = 0;
  private phrase = 0;
  private pause = 0;
  private blinkClock = -1;
  private untilBlink = 3.6;
  private random = 23;
  private nextBlink() { this.random=(this.random*16807)%2147483647; return 3.2+this.random/2147483647*2.5; }
  tick(dt: number, emotion: Emotion, state: FaceState, cue?: SpeechCue, motion=true): CharacterPose {
    const target = targetPose(emotion, state);
    if (!motion) { this.expression=target; this.mouth=target.mouth; return target; }
    dt=Math.max(0,Math.min(dt,0.1));
    this.expression=smoothPose(this.expression,target,1-Math.exp(-dt/0.16));
    const base={...this.expression};
    if (state !== this.state) { this.phase=0; this.pause=0; this.phrase=0; this.state=state; }
    if ((cue?.id||"") !== this.cueId) { this.cueId=cue?.id||""; this.visible=0; this.phase=0; this.phrase=0; this.pause=0; }
    if (cue && cue.visible > this.visible) {
      const added=Array.from(cue.text).slice(this.visible,cue.visible).join("");
      this.visible=cue.visible;
      if (/[。！？.!?…\n]/u.test(added)) { this.pause=0.3; this.phase=0; this.phrase++; }
      else if (/[，、；：,;:]/u.test(added) && this.phase>=0.2) { this.pause=0.18; this.phase=0; this.phrase++; }
    }
    const done=cue && cue.visible >= Array.from(cue.text).length;
    if (state === "speaking" && !done) {
      if (this.pause > 0) this.pause=Math.max(0,this.pause-dt);
      else {
        const name=this.phrase%5===3 ? "rounded" : this.phrase%5===4 ? "emphasis" : "soft";
        const clip=ACTIONS[name];
        const pace=(emotion==="sympathetic"?0.86:emotion==="excited"?1.08:1)*(0.92+(this.phrase%4)*0.06);
        this.phase+=dt*pace;
        if (this.phase > clip.duration) { this.phase-=clip.duration; this.phrase++; }
        const amount=sampleAction(clip.keys,this.phase)*clip.strength;
        // A shallow common rest/soft base keeps lips, cavity and corners coordinated.
        base.mouth=mixWeights(single("rest"),single(clip.frame),amount);
      }
    }
    if (this.blinkClock >= 0) {
      this.blinkClock+=dt;
      if (this.blinkClock >= ACTIONS.blink.duration) { this.blinkClock=-1; this.untilBlink=this.nextBlink(); }
    } else {
      this.untilBlink-=dt;
      if (this.untilBlink <= 0) this.blinkClock=0;
    }
    this.mouth=mixWeights(this.mouth,base.mouth,1-Math.exp(-dt/0.065));
    return withBlink({...base,mouth:this.mouth}, this.blinkClock < 0 ? 0 : sampleAction(ACTIONS.blink.keys,this.blinkClock));
  }
}
