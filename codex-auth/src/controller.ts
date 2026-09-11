import { randomUUID } from 'node:crypto';
import { CREDENTIAL_KEY, type Action, type AttemptStatus, type AuthState, type Notice, type Prompt } from './protocol';

// Structural view of the native DSH authorization and credential services.
export type NativePrompt = Omit<Prompt, 'id'> & { signal?: AbortSignal };
export interface NativeServices {
  authorization: {
    describe(key: string): { methods: readonly { id: string }[]; inFlight: boolean } | undefined;
    begin(request: { key: string; method: string; signal: AbortSignal; interaction: {
      notify(notice: Notice): void; prompt(prompt: NativePrompt): Promise<string>;
    } }): Promise<{ status: 'authorized' | 'cancelled' }>;
  };
  credentials: {
    readRecord(key: string): Promise<unknown>;
    deleteRecord(key: string): Promise<void>;
  };
}
export class ActionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
interface Attempt {
  id: string; owner: string; status: AttemptStatus; notices: Notice[];
  prompt: Prompt | null; error: string | null; abort: AbortController;
  answer?: (value: string) => void; done: Promise<void>; timer?: ReturnType<typeof setTimeout>;
}
const messageFor = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ALREADY_IN_FLIGHT') return '已有授权正在进行，请稍后重试。';
  if (code === 'NO_FLOW') return 'Codex 授权服务尚未就绪。';
  // Upstream token-exchange errors may contain token response bodies. Never
  // return/log arbitrary exception messages from those flows to the client.
  return '授权未完成。请重试；设备码登录需先在 ChatGPT 安全设置或工作区权限中启用。也可改用浏览器登录。';
};
function publicNotice(notice: Notice): Notice {
  let url: string | undefined;
  try {
    const parsed = new URL(notice.url ?? '');
    if (parsed.protocol === 'https:' && ['auth.openai.com', 'chatgpt.com'].includes(parsed.hostname)) url = parsed.href;
  } catch { /* Plain progress notices have no URL. */ }
  return { message: notice.message.slice(0, 2000), ...(url ? { url } : {}), ...(notice.code ? { code: notice.code.slice(0, 100) } : {}) };
}
export class AuthController {
  private attempt?: Attempt;
  private disposed = false;
  private deleting = false;
  constructor(private services: NativeServices, private timeoutMs = 16 * 60_000) {}
  async state(owner: string): Promise<AuthState> {
    const entry = this.services.authorization.describe(CREDENTIAL_KEY);
    const record = await this.services.credentials.readRecord(CREDENTIAL_KEY);
    const payload = record && typeof record === 'object' && 'kind' in record && record.kind === 'grant' && 'payload' in record
      ? record.payload : undefined;
    const oauth = payload && typeof payload === 'object' && 'type' in payload && payload.type === 'oauth' ? payload : undefined;
    const expires = oauth && 'expires' in oauth ? oauth.expires : undefined;
    const mine = this.attempt?.owner === owner ? this.attempt : undefined;
    return {
      available: entry?.methods.some(m => m.id === 'oauth') ?? false,
      credential: { present: !!oauth, ...(typeof expires === 'number' && Number.isFinite(expires) ? { expiresAt: expires } : {}) },
      busyElsewhere: this.deleting || (!!entry?.inFlight && mine?.status !== 'running') || (!!this.attempt && this.attempt.status === 'running' && !mine),
      attempt: mine ? { id: mine.id, status: mine.status, notices: [...mine.notices], prompt: mine.prompt, error: mine.error } : null,
    };
  }
  async act(owner: string, action: Action): Promise<AuthState> {
    if (this.disposed) throw new ActionError(503, '插件正在重新加载，请稍后重试。');
    if (this.deleting) throw new ActionError(409, '正在退出登录，请稍候。');
    if (action.action === 'start') {
      if (this.attempt?.status === 'running' || this.services.authorization.describe(CREDENTIAL_KEY)?.inFlight) throw new ActionError(409, '已有授权正在进行，请在发起它的页面继续。');
      if (!this.services.authorization.describe(CREDENTIAL_KEY)?.methods.some(m => m.id === 'oauth')) throw new ActionError(503, '未找到 Codex OAuth 服务，请启用 llm-pi-ai。');
      this.start(owner, action.mode);
    } else if (action.action === 'logout') {
      if (this.attempt?.status === 'running' || this.services.authorization.describe(CREDENTIAL_KEY)?.inFlight) throw new ActionError(409, '请先取消正在进行的授权。');
      this.deleting = true;
      try { await this.services.credentials.deleteRecord(CREDENTIAL_KEY); this.attempt = undefined; }
      finally { this.deleting = false; }
    } else {
      const attempt = this.attempt;
      if (!attempt || attempt.owner !== owner || attempt.id !== action.attemptId || attempt.status !== 'running') throw new ActionError(409, '授权已结束或不属于此页面，请刷新状态。');
      if (action.action === 'cancel') { attempt.abort.abort(); await attempt.done; }
      else {
        if (!attempt.prompt || attempt.prompt.id !== action.promptId || !attempt.answer) throw new ActionError(409, '此问题已失效，请使用最新提示。');
        if (attempt.prompt.kind === 'select' && !attempt.prompt.options?.some(o => o.id === action.value)) throw new ActionError(400, '请选择列表中的选项。');
        const answer = attempt.answer; attempt.answer = undefined; attempt.prompt = null;
        answer(action.value);
      }
    }
    return this.state(owner);
  }
  private start(owner: string, mode: 'browser' | 'device_code') {
    const attempt: Attempt = { id: randomUUID(), owner, status: 'running', notices: [], prompt: null, error: null, abort: new AbortController(), done: Promise.resolve() };
    this.attempt = attempt;
    let modeChosen = false;
    attempt.timer = setTimeout(() => attempt.abort.abort(), this.timeoutMs);
    attempt.timer.unref();
    attempt.done = Promise.resolve().then(() => this.services.authorization.begin({
      key: CREDENTIAL_KEY, method: 'oauth', signal: attempt.abort.signal,
      interaction: {
        notify: notice => { if (!attempt.abort.signal.aborted && attempt.status === 'running') attempt.notices = [...attempt.notices.slice(-11), publicNotice(notice)]; },
        prompt: prompt => {
          if (attempt.abort.signal.aborted || prompt.signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
          // Use the requested native mode only if the native prompt offers it;
          // future/other questions remain visible, rather than guessing answers.
          if (!modeChosen && prompt.kind === 'select' && prompt.options?.some(o => o.id === mode)) { modeChosen = true; return Promise.resolve(mode); }
          if (attempt.prompt) return Promise.reject(new Error('Concurrent authorization prompts are unsupported'));
          return new Promise<string>((resolve, reject) => {
            const id = randomUUID();
            const cleanup = () => {
              attempt.abort.signal.removeEventListener('abort', cancel);
              prompt.signal?.removeEventListener('abort', cancel);
              if (attempt.prompt?.id === id) { attempt.prompt = null; attempt.answer = undefined; }
            };
            const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
            attempt.prompt = { id, kind: prompt.kind, message: prompt.message,
              ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}), ...(prompt.options ? { options: prompt.options } : {}) };
            attempt.answer = value => { cleanup(); resolve(value); };
            attempt.abort.signal.addEventListener('abort', cancel, { once: true });
            prompt.signal?.addEventListener('abort', cancel, { once: true });
          });
        },
      },
    })).then(outcome => { attempt.status = outcome.status; }, error => {
      attempt.status = attempt.abort.signal.aborted ? 'cancelled' : 'failed';
      if (attempt.status === 'failed') attempt.error = messageFor(error);
    }).finally(() => {
      clearTimeout(attempt.timer); attempt.abort.abort(); attempt.prompt = null; attempt.answer = undefined;
      // OAuth state parameters and device codes have no use once settled.
      attempt.notices = [];
    });
  }
  async dispose() {
    this.disposed = true;
    this.attempt?.abort.abort();
    await this.attempt?.done;
    this.attempt = undefined;
  }
}
