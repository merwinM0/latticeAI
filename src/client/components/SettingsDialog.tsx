import { Check, CheckCheck, ExternalLink, Eye, EyeOff, KeyRound, LockKeyhole, X } from "lucide-react";
import { useState } from "react";
import { useDialog } from "../hooks/useDialog";
import type { ProviderInfo } from "../../shared/types";
import type { ChatSettings } from "../hooks/useChat";

export function SettingsDialog({ settings, providers, providerError, onReload, onSave, onClose, onClear }: {
  settings: ChatSettings;
  providers: ProviderInfo[];
  providerError: string;
  onReload: () => void;
  onSave: (settings: ChatSettings) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const ref = useDialog();
  const [draft, setDraft] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const provider = providers.find((item) => item.id === draft.provider);
  const valid = draft.demo || (Boolean(provider) && draft.model.trim() && (provider?.configured || draft.apiKey.trim()));

  return <dialog ref={ref} className="settings-dialog" aria-labelledby="settings-title" aria-describedby="settings-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <form onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ ...draft, model: draft.model.trim(), apiKey: draft.apiKey.trim() }); }}>
      <div className="dialog-topline"><h2 id="settings-title">连接模型</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭模型设置"><X size={20} aria-hidden="true" /></button></div>
      <p id="settings-description" className="dialog-description">密钥只留在当前页面内存，不写入浏览器存储。</p>
      <div className="mode-switch" aria-label="聊天模式">
        <button type="button" aria-pressed={draft.demo} className={draft.demo ? "is-selected" : ""} onClick={() => setDraft({ ...draft, demo: true })}>演示体验</button>
        <button type="button" aria-pressed={!draft.demo} className={!draft.demo ? "is-selected" : ""} onClick={() => setDraft({ ...draft, demo: false })}>连接真实模型</button>
      </div>
      {draft.demo ? <div className="demo-settings-info"><p>不需要密钥，先体验粒子表情与浮现回答。</p><p className="subtle-note">演示回复为本地预设，不会请求外部 AI 服务。</p></div>
        : <div className="api-settings-fields">
          {providerError && <div className="provider-error" role="alert">{providerError}<button type="button" onClick={onReload}>重新加载</button></div>}
          <fieldset className="provider-fieldset"><legend>模型服务商</legend><div className="provider-grid">{providers.map((item) => <button
            type="button" key={item.id} className={draft.provider === item.id ? "is-selected" : ""} aria-pressed={draft.provider === item.id}
            onClick={() => setDraft({ ...draft, provider: item.id, model: item.models[0] || "", apiKey: item.id === settings.provider ? settings.apiKey : "" })}
          ><span>{item.name}</span>{draft.provider === item.id && <Check size={12} aria-hidden="true" />}</button>)}</div></fieldset>
          <label className="field-label" htmlFor="model-name">模型名称<span>支持手动填写</span></label>
          <input id="model-name" className="text-input model-input" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} list="model-options" placeholder="例如 deepseek-chat" maxLength={200} required autoComplete="off" />
          <datalist id="model-options">{provider?.models.map((model) => <option key={model} value={model} />)}</datalist>
          {provider?.configured && <p className="configured-note"><CheckCheck size={14} aria-hidden="true" />服务端已配置密钥，可直接使用。</p>}
          <label className="field-label" htmlFor="api-key"><span>API Key {provider?.configured && <small>（可选覆盖）</small>}</span><KeyRound size={13} aria-hidden="true" /></label>
          <div className="key-input-wrap"><input id="api-key" className="text-input" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={provider?.configured ? "留空以使用服务端密钥" : "粘贴你的 API Key"} autoComplete="off" spellCheck={false} maxLength={4096} required={!provider?.configured} aria-describedby="key-privacy" /><button type="button" className="icon-button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏密钥" : "显示密钥"}>{showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button></div>
          <p id="key-privacy" className="privacy-note"><LockKeyhole size={12} aria-hidden="true" />仅保存在当前页面内存，刷新即清除，不写入浏览器存储。</p>
          {draft.provider === "custom" && <p className="custom-note">请在服务端 <code>.env</code> 配置 <code>CUSTOM_BASE_URL</code>。支持 Ollama 等 OpenAI 兼容接口。</p>}
          <details className="env-help"><summary>更推荐：在服务端配置密钥 <ExternalLink size={11} aria-hidden="true" /></summary><p>将项目的 <code>.env.example</code> 复制为 <code>.env</code>，填写对应的 <code>API_KEY</code>，重启服务后重新加载页面。各服务商的接口地址也可在这里调整。</p><p>模型名称和可用性以服务商账号为准。接入后按服务商规则计费。</p></details>
        </div>}
      <div className="dialog-footer"><p>更换模式或模型会开启新对话。</p><button type="submit" className="primary-button" disabled={!valid}>{draft.demo ? "开始体验" : "保存连接"}</button></div>
      <button type="button" className="clear-conversation" onClick={onClear}>清空当前对话</button>
    </form>
  </dialog>;
}
