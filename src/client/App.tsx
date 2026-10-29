import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderInfo } from "../shared/types";
import { ChatInput } from "./components/ChatInput";
import { FloatingReplies } from "./components/FloatingReplies";
import { ParticleFace } from "./components/ParticleFace";
import { SceneFeedback } from "./components/SceneFeedback";
import { SettingsDialog } from "./components/SettingsDialog";
import { useChat, type ChatSettings } from "./hooks/useChat";
import { useSceneLayout } from "./hooks/useSceneLayout";
import { loadProviders } from "./lib/api";

const STORAGE_KEY = "latticeai.preferences.v1";
const defaults: ChatSettings = { provider: "deepseek", model: "deepseek-chat", demo: true, apiKey: "" };
function readPreferences(): ChatSettings | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (value && value.provider === "deepseek"
      && typeof value.model === "string" && typeof value.demo === "boolean") {
      return { provider: value.provider, model: value.model, demo: value.demo, apiKey: "" };
    }
  } catch { /* Storage can be disabled. */ }
  return null;
}

export function App() {
  const [initial] = useState(() => readPreferences());
  const [settings, setSettings] = useState<ChatSettings>(initial || defaults);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerError, setProviderError] = useState("");
  const [reload, setReload] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const autoSelected = useRef(false);
  const stageRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const layout = useSceneLayout(stageRef, composerRef);
  const chat = useChat(settings);
  const latest = chat.turns.at(-1);
  const speech = useMemo(() => {
    if (chat.faceState !== "speaking" || !latest?.fullBubbles.length) return undefined;
    const index=latest.fullBubbles.length-1;
    return { id: `${latest.id}:${index}`, text: latest.fullBubbles[index]!, visible: Array.from(latest.bubbles[index] || "").length };
  }, [latest, chat.faceState]);

  useEffect(() => {
    const abort = new AbortController();
    setProviderError("");
    loadProviders(abort.signal).then((items) => {
      setProviders(items);
      if (!initial && !autoSelected.current) {
        const configured = items.find((item) => item.configured);
        if (configured) setSettings({ provider: configured.id, model: configured.models[0] || "", demo: false, apiKey: "" });
        autoSelected.current = true;
      }
    }).catch((error) => {
      if (!abort.signal.aborted) setProviderError(error instanceof Error ? error.message : "模型列表加载失败。");
    });
    return () => abort.abort();
  }, [reload, initial]);

  const saveSettings = (next: ChatSettings) => {
    if (next.demo !== settings.demo || next.provider !== settings.provider || next.model !== settings.model) chat.clear();
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: next.provider, model: next.model, demo: next.demo }));
    } catch { /* Never persist the API key; preferences are optional. */ }
    setSettingsOpen(false);
    setFocusToken((value) => value + 1);
  };

  return <main className="particle-stage" ref={stageRef}>
    <h1 className="sr-only">粒子表情对话</h1>
    <ParticleFace emotion={chat.emotion} state={chat.faceState} layout={layout} speech={speech} />
    <FloatingReplies turns={chat.turns} layout={layout} />
    <div className="input-dock" ref={composerRef}>
      <SceneFeedback turn={latest} busy={chat.busy} onRetry={() => { if (latest) void chat.send(latest.user, latest.id); }} onSettings={() => setSettingsOpen(true)} />
      <ChatInput busy={chat.busy} demo={settings.demo} onSend={chat.send} onStop={chat.stop} onSettings={() => setSettingsOpen(true)} focusToken={focusToken} />
    </div>
    <section className="sr-only" aria-label="当前对话记录"><ol>{chat.turns.map((turn) => <li key={turn.id}>
      <p>你：{turn.user}</p>{turn.status !== "pending" && turn.bubbles.map((text, index) => <p key={index}>点点：{text}</p>)}
    </li>)}</ol></section>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{chat.announcement}</div>
    {settingsOpen && <SettingsDialog settings={settings} providers={providers} providerError={providerError} onReload={() => setReload((value) => value + 1)} onSave={saveSettings} onClose={() => setSettingsOpen(false)} onClear={() => {
      chat.clear();
      setSettingsOpen(false);
      setFocusToken((value) => value + 1);
    }} />}
  </main>;
}
