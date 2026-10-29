import { ArrowUp, Settings2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ChatInput({ busy, demo, onSend, onStop, onSettings, focusToken }: {
  busy: boolean;
  demo: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onSettings: () => void;
  focusToken: number;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [text]);
  useEffect(() => { if (focusToken) inputRef.current?.focus(); }, [focusToken]);
  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text.trim());
    setText("");
    inputRef.current?.focus();
  };
  return <form className="composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <button type="button" className="input-settings" onClick={onSettings} disabled={busy} aria-label="模型设置" title="模型设置"><Settings2 size={17} strokeWidth={1.4} aria-hidden="true" /></button>
    <label htmlFor="chat-message" className="sr-only">给点点发消息</label>
    <textarea
      id="chat-message"
      ref={inputRef}
      value={text}
      onChange={(event) => setText(event.target.value)}
      placeholder={busy ? "…" : demo ? "演示 · 说点什么…" : "说点什么…"}
      rows={1}
      maxLength={4000}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
          event.preventDefault();
          submit();
        }
      }}
      aria-describedby="composer-help"
    />
    {busy ? <button type="button" className="send-button stop-button" onClick={onStop} aria-label="停止回复" title="停止回复"><Square size={12} fill="currentColor" aria-hidden="true" /></button>
      : <button type="submit" className="send-button" disabled={!text.trim()} aria-label="发送消息" title="发送消息"><ArrowUp size={19} strokeWidth={1.5} aria-hidden="true" /></button>}
    <span id="composer-help" className="sr-only">{demo ? "当前为本地预设演示，不会调用真实模型。" : "当前使用所选 AI 模型。"}Enter 发送，Shift + Enter 换行。输入栏左侧可设置模型。</span>
  </form>;
}
