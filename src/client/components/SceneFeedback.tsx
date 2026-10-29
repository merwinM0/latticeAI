import { useEffect, useState } from "react";
import type { Turn } from "../hooks/useChat";

export function SceneFeedback({ turn, busy, onRetry, onSettings }: {
  turn?: Turn;
  busy: boolean;
  onRetry: () => void;
  onSettings: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
    if (turn?.status !== "stopped") return;
    const timer = setTimeout(() => setDismissed(true), 8000);
    return () => clearTimeout(timer);
  }, [turn?.id, turn?.status]);
  if (dismissed || !turn || (turn.status !== "error" && turn.status !== "stopped")) return null;
  return <div className="scene-feedback" role={turn.status === "error" ? "alert" : "status"}>
    <p>{turn.status === "error" ? turn.error : "已停止"}</p>
    <div><button onClick={onRetry} disabled={busy}>再试一次</button>{turn.status === "error" && <button onClick={onSettings} disabled={busy}>检查连接</button>}</div>
  </div>;
}
