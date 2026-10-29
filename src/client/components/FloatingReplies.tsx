import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Turn } from "../hooks/useChat";
import { placeReplies, replyLifetime, type ReplyPlacement, type SceneLayout } from "../lib/scene-layout";

function FloatingReply({ text, fullText, complete, placement, retiring, delayed }: {
  text: string;
  fullText: string;
  complete: boolean;
  placement?: ReplyPlacement;
  retiring: boolean;
  delayed: boolean;
}) {
  const position = useRef(placement);
  if (placement) position.current = placement;
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (hidden) return;
    let removal: ReturnType<typeof setTimeout>;
    if (retiring) {
      setLeaving(true);
      removal = setTimeout(() => setHidden(true), 420);
      return () => clearTimeout(removal);
    }
    if (!complete || hovered || focused || !visible) { setLeaving(false); return; }
    const expiry = setTimeout(() => {
      setLeaving(true);
      removal = setTimeout(() => setHidden(true), 1200);
    }, replyLifetime(fullText));
    return () => { clearTimeout(expiry); clearTimeout(removal); };
  }, [complete, fullText, hidden, hovered, focused, retiring, visible]);
  if (hidden || !position.current || !text) return null;
  const { x, y, width, maxHeight } = position.current;
  const style = { "--reply-x": `${x}px`, "--reply-y": `${y}px`, "--reply-width": `${width}px`, "--reply-height": `${maxHeight}px` } as CSSProperties;
  return <p
    className={`floating-reply ${leaving ? "is-leaving" : ""} ${retiring ? "is-retiring" : ""} ${delayed ? "is-delayed" : ""}`}
    style={style}
    tabIndex={0}
    aria-label={fullText}
    data-complete={complete}
    data-paused={hovered || focused || !visible}
    onPointerEnter={() => setHovered(true)}
    onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
  >{text}</p>;
}

export function FloatingReplies({ turns, layout }: { turns: Turn[]; layout: SceneLayout }) {
  const sources = useMemo(() => turns.slice(-3).flatMap((turn) => turn.fullBubbles.map((fullText, index) => ({
    id: `${turn.id}-${index}`, fullText, text: turn.bubbles[index] || "",
    complete: index < turn.fullBubbles.length - 1 || turn.status !== "pending",
  }))).slice(-3), [turns]);
  const placements = useMemo(() => placeReplies(layout, sources.slice(-2).map((source) => ({ id: source.id, text: source.fullText }))), [layout, sources]);
  const first = Math.max(0, sources.length - 2);
  return <div className="reply-field" aria-label="浮现的回答">
    {sources.map((source, index) => <FloatingReply
      key={source.id}
      text={source.text}
      fullText={source.fullText}
      complete={source.complete}
      placement={index >= first ? placements[index - first] : undefined}
      retiring={index < first}
      delayed={index >= 2}
    />)}
  </div>;
}
