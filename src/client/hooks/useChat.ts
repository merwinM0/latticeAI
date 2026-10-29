import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent, Emotion, FaceState, ProviderId } from "../../shared/types";
import { delay, requestChat } from "../lib/api";
import { createContext } from "../lib/context";
import { runDemo } from "../lib/demo";

export interface ChatSettings {
  provider: ProviderId;
  model: string;
  demo: boolean;
  apiKey: string;
}
export interface Turn {
  id: string;
  user: string;
  bubbles: string[];
  fullBubbles: string[];
  emotion: Emotion;
  status: "pending" | "complete" | "error" | "stopped";
  error?: string;
}

export function useChat(settings: ChatSettings) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [emotion, setEmotion] = useState<Emotion>("happy");
  const [faceState, setFaceState] = useState<FaceState>("idle");
  const [announcement, setAnnouncement] = useState("");
  const controller = useRef<AbortController | null>(null);
  const turnsRef = useRef(turns);
  const mounted = useRef(true);
  turnsRef.current = turns;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const send = useCallback(async (text: string, retryId?: string) => {
    if (controller.current || !text.trim()) return;
    const abort = new AbortController();
    controller.current = abort;
    const signal = abort.signal;
    const previous = retryId ? turnsRef.current.filter((turn) => turn.id !== retryId) : turnsRef.current;
    const id = retryId || crypto.randomUUID();
    const initial: Turn = { id, user: text.trim(), bubbles: [], fullBubbles: [], emotion: "neutral", status: "pending" };
    setTurns([...previous, initial]);
    setBusy(true);
    setFaceState("thinking");
    setAnnouncement("点点正在想怎么回答。");
    const update = (fn: (turn: Turn) => Turn) => {
      if (mounted.current) setTurns((current) => current.map((turn) => turn.id === id ? fn(turn) : turn));
    };
    const queue: string[] = [];
    let pump: Promise<void> | null = null;
    let pumpError: unknown;
    let bubbleIndex = 0;
    let generationDone = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startPump = () => {
      if (pump) return;
      pump = (async () => {
        while (queue.length && !signal.aborted) {
          const message = queue.shift()!;
          const index = bubbleIndex++;
          setFaceState("speaking");
          if (reducedMotion) {
            update((turn) => ({ ...turn, bubbles: [...turn.bubbles, message], fullBubbles: [...turn.fullBubbles, message] }));
          } else {
            update((turn) => ({ ...turn, bubbles: [...turn.bubbles, ""], fullBubbles: [...turn.fullBubbles, message] }));
            const characters = Array.from(message);
            for (let end = 1; end <= characters.length; end += message.length > 500 ? 8 : 1) {
              const visible = characters.slice(0, Math.min(end + (message.length > 500 ? 7 : 0), characters.length)).join("");
              update((turn) => ({ ...turn, bubbles: turn.bubbles.map((bubble, i) => i === index ? visible : bubble) }));
              await delay(message.length > 500 ? 12 : 48, signal);
            }
          }
          setAnnouncement(`点点：${message}`);
          if (queue.length) await delay(180, signal);
        }
        if (!signal.aborted && mounted.current) setFaceState(generationDone ? "idle" : "thinking");
      })().catch((error) => { pumpError = error; }).finally(() => { pump = null; });
    };
    const onEvent = (event: ChatEvent) => {
      if (signal.aborted) return;
      if (event.type === "emotion") {
        setEmotion(event.emotion);
        update((turn) => ({ ...turn, emotion: event.emotion }));
      } else if (event.type === "message") {
        queue.push(event.text);
        startPump();
      } else if (event.type === "done") {
        generationDone = true;
      }
    };
    try {
      if (settings.demo) await runDemo(text, signal, onEvent);
      else await requestChat({ provider: settings.provider, model: settings.model, apiKey: settings.apiKey || undefined, messages: createContext(previous, text) }, signal, onEvent);
      while (pump) await pump;
      if (pumpError) throw pumpError;
      signal.throwIfAborted();
      update((turn) => ({ ...turn, status: "complete" }));
    } catch (error) {
      queue.length = 0;
      // Abort a typewriter still running after an upstream error, before settling UI.
      const stopped = signal.aborted;
      abort.abort();
      if (pump) await pump;
      const message = stopped ? undefined : error instanceof Error ? error.message : "暂时没能收到回复，请再试一次。";
      update((turn) => ({ ...turn, status: stopped ? "stopped" : "error", error: message }));
      if (mounted.current) {
        setEmotion(stopped ? "neutral" : "sympathetic");
        setAnnouncement(stopped ? "已停止回复。" : `回复失败：${message}`);
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (mounted.current) { setBusy(false); setFaceState("idle"); }
    }
  }, [settings]);

  const stop = useCallback(() => controller.current?.abort(), []);
  const clear = useCallback(() => {
    if (controller.current) return;
    setTurns([]);
    turnsRef.current = [];
    setEmotion("happy");
    setAnnouncement("已开始新对话。");
  }, []);

  return { turns, busy, emotion, setEmotion, faceState, announcement, send, stop, clear };
}
