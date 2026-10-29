import { useEffect, useState, type RefObject } from "react";
import { createSceneLayout } from "../lib/scene-layout";

export function useSceneLayout(stage: RefObject<HTMLElement | null>, composer: RefObject<HTMLElement | null>) {
  const [layout, setLayout] = useState(() => createSceneLayout(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const measure = () => {
      const bounds = stage.current?.getBoundingClientRect();
      const input = composer.current?.getBoundingClientRect();
      if (!bounds || !input) return;
      const next = createSceneLayout(bounds.width, bounds.height, input.top - bounds.top);
      setLayout((previous) => previous.width === next.width && previous.height === next.height && previous.safeBottom === next.safeBottom ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    if (stage.current) observer.observe(stage.current);
    if (composer.current) observer.observe(composer.current);
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, [stage, composer]);
  return layout;
}
