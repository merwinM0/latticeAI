import { memo, useEffect, useRef, useState } from "react";
import { EMOTION_LABELS, type Emotion, type FaceState } from "../../shared/types";
import type { SceneLayout } from "../lib/scene-layout";
import type { SpeechCue } from "../particles/actions";
import type { ParticleEngine, ParticleState } from "../particles/animation";
import { loadCharacter } from "../particles/assets";
import { createCanvasScene } from "../particles/canvas";
import type { CharacterModel } from "../particles/data";
import { createWebGLScene } from "../particles/webgl";

export const ParticleFace = memo(function ParticleFace({ emotion, state, layout, speech }: {
  emotion: Emotion;
  state: FaceState;
  layout: SceneLayout;
  speech?: SpeechCue;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const values = useRef<ParticleState>({ emotion, state, layout, speech });
  values.current = { emotion, state, layout, speech };
  const [model, setModel] = useState<CharacterModel | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);
  const [backend, setBackend] = useState<"webgl" | "canvas">("webgl");
  useEffect(() => {
    let cancelled = false;
    setError("");
    loadCharacter().then((loaded) => { if (!cancelled) setModel(loaded); }).catch(() => {
      if (!cancelled) setError("角色素材加载失败，请重试。");
    });
    return () => { cancelled = true; };
  }, [retry]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model) return;
    setRendered(false);
    const onContextLost = (event: Event) => { event.preventDefault(); setBackend("canvas"); };
    const onRenderError = () => { setRendered(false); if (backend === "webgl") setBackend("canvas"); else setError("角色暂时无法绘制，请重新加载。"); };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("character-render-error", onRenderError);
    try {
      engineRef.current = backend === "webgl" ? createWebGLScene(canvas, values.current, model) : createCanvasScene(canvas, values.current, model);
      setRendered(true);
    } catch {
      if (backend === "webgl") setBackend("canvas");
      else setError("当前浏览器无法显示粒子角色，请换用支持 Canvas 的浏览器。");
    }
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("character-render-error", onRenderError);
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [backend, model, retry]);
  useEffect(() => { engineRef.current?.update({ emotion, state, layout, speech }); }, [emotion, state, layout, speech]);
  return <>
    <canvas
      key={backend}
      ref={canvasRef}
      className="particle-face"
      data-renderer={backend}
      data-source="native-mesh"
      data-ready={rendered}
      data-particles={model?.count || 0}
      role="img"
      aria-label={`粒子表情：${!model ? "正在加载角色" : state === "thinking" ? "正在思考" : EMOTION_LABELS[emotion]}${state === "speaking" ? "，正在说话" : ""}`}
    >{EMOTION_LABELS[emotion]}</canvas>
    {error && <div className="asset-status" role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)}>重新加载角色</button></div>}
  </>;
});
