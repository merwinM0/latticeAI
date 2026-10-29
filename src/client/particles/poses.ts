import type { Emotion, FaceState } from "../../shared/types";
import { CHARACTER_FRAMES, REGION } from "./data";

export interface CharacterPose { eyes: number[]; mouth: number[]; brows: number[]; browLift?: number }
export function single(name: (typeof CHARACTER_FRAMES)[number]): number[] {
  return CHARACTER_FRAMES.map(frame => frame === name ? 1 : 0);
}
export function mixWeights(a: readonly number[], b: readonly number[], amount: number): number[] {
  const t = Math.max(0, Math.min(1, amount));
  return a.map((value, i) => value*(1-t)+b[i]!*t);
}
/** Expression targets only. Talking/blinking are local-time composable action clips. */
export function targetPose(emotion: Emotion, state: FaceState, _time = 0, _motion = true): CharacterPose {
  const sad = emotion === "sympathetic" && state !== "thinking";
  return {
    browLift: state === "thinking" || emotion === "thinking" ? 4 : emotion === "curious" ? 2.5 : emotion === "surprised" ? 6 : 0,
    eyes: mixWeights(single("rest"), single("sad"), sad ? 0.35 : 0),
    brows: single(sad ? "sad" : "rest"),
    mouth: sad ? single("sad") : emotion === "surprised" ? mixWeights(single("rest"), single("round"), 0.55)
      : emotion === "excited" ? mixWeights(single("rest"), single("happy"), 0.4) : single("rest"),
  };
}
export function smoothPose(previous: CharacterPose, target: CharacterPose, factor: number): CharacterPose {
  return { eyes: mixWeights(previous.eyes, target.eyes, factor), mouth: mixWeights(previous.mouth, target.mouth, factor), brows: mixWeights(previous.brows, target.brows, factor), browLift: (previous.browLift||0)*(1-factor)+(target.browLift||0)*factor };
}
export function withBlink(pose: CharacterPose, amount: number): CharacterPose {
  return { ...pose, eyes: mixWeights(pose.eyes, single("blink"), amount) };
}
export function regionWeights(pose: CharacterPose, region: number): number[] {
  return region === REGION.mouth ? pose.mouth : region === REGION.leftEye || region === REGION.rightEye ? pose.eyes : pose.brows;
}
