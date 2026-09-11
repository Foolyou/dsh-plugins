import { useEffect, useRef, useState } from 'react';
import { API_PATH, type Action, type AuthState } from './protocol';
let fallbackOwner: string | undefined;
function ownerId() {
  if (!fallbackOwner) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    fallbackOwner = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  try {
    const saved = sessionStorage.getItem('dsh-codex-auth-owner');
    if (saved && /^[a-f0-9-]{36}$/.test(saved)) return saved;
    sessionStorage.setItem('dsh-codex-auth-owner', fallbackOwner);
  } catch { /* In-memory ownership works when storage is disabled. */ }
  return fallbackOwner;
}
export function AuthPanel() {
  const [owner] = useState(ownerId);
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const live = useRef(false);
  const sequence = useRef(0);
  const mutating = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const current = useRef(state); current.current = state;
  const attempt = state?.attempt;
  const running = attempt?.status === 'running';
  const prompt = attempt?.prompt;
  useEffect(() => { setAnswer(''); }, [prompt?.id]);
  async function request(action?: Action) {
    const seq = ++sequence.current;
    try {
      const response = await fetch(API_PATH, { method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-DSH-Auth-Owner': owner, ...(action ? { 'Content-Type': 'application/json' } : {}) },
        ...(action ? { body: JSON.stringify(action) } : {}), signal: abort.current?.signal });
      if (response.status === 401 || response.status === 403) throw new Error('Harness 登录已失效，请重新打开 dsh web 提供的登录网址。');
      if (response.status === 404) throw new Error('授权接口尚未就绪，请检查 Host 是否已启用 authorization 服务和 codex-auth 插件。');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '授权请求失败，请重试。');
      if (live.current && seq === sequence.current) { setState(result); setError(null); }
    } catch (e) {
      if (live.current && seq === sequence.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : '授权请求失败。');
    }
  }
  async function act(action: Action) {
    if (mutating.current) return;
    mutating.current = true; setBusy(true); setConfirmLogout(false);
    try { await request(action); }
    finally { mutating.current = false; if (live.current) setBusy(false); }
  }
  useEffect(() => {
    live.current = true; abort.current = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!mutating.current) await request();
      if (live.current) timer = setTimeout(poll, current.current?.attempt?.status === 'running' ? 750 : 3000);
    };
    void poll();
    return () => { live.current = false; ++sequence.current; abort.current?.abort(); clearTimeout(timer); };
  }, [owner]);
  const status = running ? '正在授权' : state?.credential.present ? '凭据已保存' : '未登录';
  const notices = attempt?.notices ?? [];
  const link = [...notices].reverse().find(n => n.url);
  const code = [...notices].reverse().find(n => n.code)?.code;
  return <section className="dca-panel" aria-label="Codex 授权">
    <div className="dca-eyebrow">OPENAI CODEX</div>
    <h2>连接你的 ChatGPT 账号</h2>
    <p className="dca-description">通过 DSH 原生 OAuth 登录，授权后即可选择 openai-codex 下的模型。凭据由 Harness 保存并自动刷新。</p>
    <div className="dca-card">
      <div className="dca-status"><span className={`dca-dot ${state?.credential.present ? 'dca-connected' : ''}`} /><strong>{state ? status : '正在读取状态…'}</strong>
        <button className="dca-link-button" type="button" disabled={busy} onClick={() => void request()}>刷新状态</button></div>
      {state?.credential.present && <p className="dca-muted">已保存 DSH 独立登录凭据。实际账号权限与可用额度由 OpenAI 决定。</p>}
      {state && !state.available && <p role="status" className="dca-warning">Codex OAuth 服务尚未就绪，请启用 Harness 的 llm-pi-ai 插件。</p>}
      {state?.busyElsewhere && <p role="status" className="dca-warning">另一个页面正在处理授权，请到发起它的页面继续。</p>}
      {!running && <div className="dca-actions">
        <button type="button" className="dca-primary" disabled={!state?.available || busy || state.busyElsewhere} onClick={() => void act({ action: 'start', mode: 'device_code' })}>设备码登录</button>
        <button type="button" disabled={!state?.available || busy || state.busyElsewhere} onClick={() => void act({ action: 'start', mode: 'browser' })}>浏览器登录</button>
        {state?.credential.present && <button type="button" disabled={busy || state.busyElsewhere} onClick={() => setConfirmLogout(true)}>退出登录</button>}
      </div>}
      {confirmLogout && <div className="dca-confirm">
        <p>清除 DSH 保存的 Codex 登录凭据？Codex CLI 的登录态不会改变。</p>
        <div className="dca-actions"><button type="button" onClick={() => void act({ action: 'logout' })}>确认退出</button><button type="button" onClick={() => setConfirmLogout(false)}>返回</button></div>
      </div>}
      {running && <div className="dca-flow" aria-live="polite">
        <h3>{code ? '输入设备码以完成登录' : link ? '在浏览器中完成授权' : '正在准备登录…'}</h3>
        {code && <div className="dca-code" aria-label="设备码">{code}</div>}
        {link?.url && <a className="dca-open" href={link.url} target="_blank" rel="noopener noreferrer">打开 OpenAI 授权页面 ↗</a>}
        {notices.length > 0 && <p className="dca-muted">{notices.at(-1)?.message}</p>}
        {prompt && <form key={prompt.id} onSubmit={event => { event.preventDefault(); if (answer.trim() && attempt) { void act({ action: 'answer', attemptId: attempt.id, promptId: prompt.id, value: answer }); setAnswer(''); } }}>
          <label className="dca-prompt">{prompt.message}
            {prompt.kind === 'select' ? <select value={answer} onChange={e => setAnswer(e.target.value)} required><option value="" disabled>请选择</option>{prompt.options?.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              : <input type={prompt.kind === 'secret' ? 'password' : 'text'} value={answer} onChange={e => setAnswer(e.target.value)} placeholder={prompt.placeholder} autoComplete="off" spellCheck={false} maxLength={8192} />}
          </label><button type="submit" disabled={busy || !answer.trim()}>继续</button>
        </form>}
        <button className="dca-cancel" type="button" disabled={busy} onClick={() => attempt && void act({ action: 'cancel', attemptId: attempt.id })}>取消授权</button>
      </div>}
      {attempt?.status === 'authorized' && <p role="status" className="dca-success">授权完成。回到会话，选择 openai-codex 分组中的模型即可使用。</p>}
      {attempt?.status === 'cancelled' && <p role="status" className="dca-muted">授权已取消或超时，可以重新开始。</p>}
      {(error || attempt?.error) && <p role="alert" className="dca-error">{error || attempt?.error}</p>}
    </div>
    <div className="dca-help"><h3>选择哪种登录方式？</h3>
      <p><strong>设备码登录：</strong>适合 WSL、远程主机及无桌面环境。打开授权网页并输入设备码后，这里会自动完成登录。需在 ChatGPT 安全设置或工作区权限中允许设备码登录。</p>
      <p><strong>浏览器登录：</strong>通过本机回调完成；如果浏览器没有自动返回，可把跳转地址粘贴到上方提示框。</p>
      <p>关闭设置页后授权仍可继续；同一标签页重新打开会恢复进度。16 分钟未完成会自动取消。</p>
    </div>
  </section>;
}
